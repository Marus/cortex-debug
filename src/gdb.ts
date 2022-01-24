import {
    DebugSession, InitializedEvent, TerminatedEvent,
    ContinuedEvent, OutputEvent, Thread, ThreadEvent,
    StackFrame, Scope, Source, Handles, Event
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { MI2 } from './backend/mi2/mi2';
import { extractBits, hexFormat } from './frontend/utils';
import { Variable, VariableObject, MIError, OurDataBreakpoint, OurInstructionBreakpoint, OurSourceBreakpoint } from './backend/backend';
import {
    TelemetryEvent, ConfigurationArguments, StoppedEvent, GDBServerController,
    createPortName, GenericCustomEvent, quoteShellCmdLine, toStringDecHexOctBin, ADAPTER_DEBUG_MODE
} from './common';
import { GDBServer, ServerConsoleLog } from './backend/server';
import { MINode } from './backend/mi_parse';
import { expandValue, isExpandable } from './backend/gdb_expansion';
import { GdbDisassembler } from './backend/disasm';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as hasbin from 'hasbin';
import * as crypto from 'crypto';

import { setTimeout } from 'timers';
import { EventEmitter } from 'events';

import { JLinkServerController } from './jlink';
import { OpenOCDServerController } from './openocd';
import { STUtilServerController } from './stutil';
import { STLinkServerController } from './stlink';
import { PyOCDServerController } from './pyocd';
import { BMPServerController } from './bmp';
import { PEServerController } from './pemicro';
import { QEMUServerController } from './qemu';
import { ExternalServerController } from './external';
import { SymbolTable } from './backend/symbols';
import { SymbolInformation, SymbolScope } from './symbols';
import { TcpPortScanner } from './tcpportscanner';

const SERVER_TYPE_MAP = {
    jlink: JLinkServerController,
    openocd: OpenOCDServerController,
    stutil: STUtilServerController,
    stlink: STLinkServerController,
    pyocd: PyOCDServerController,
    pe: PEServerController,
    bmp: BMPServerController,
    qemu: QEMUServerController,
    external: ExternalServerController
};

// Type of session start. Also used in display of call-stack window
enum SessionMode {
    LAUNCH = 'entry',
    ATTACH = 'attach',
    RESTART = 'restart',
    RESET = 'reset'
}

class ExtendedVariable {
    constructor(public name, public options) {
    }
}

const GLOBAL_HANDLE_ID      = 0x0000FE;
const STACK_HANDLES_START   = 0x000100;
const STACK_HANDLES_FINISH  = 0x00FFFF;
const STATIC_HANDLES_START  = 0x010000;
const STATIC_HANDLES_FINISH = 0x01FFFF;
const REG_HANDLE_START      = 0x020000;
const REG_HANDLE_FINISH     = 0x02FFFF;
const VAR_HANDLES_START     = 0x030000;

const COMMAND_MAP = (c) => c.startsWith('-') ? c.substring(1) : `interpreter-exec console "${c.replace(/"/g, '\\"')}"`;

let dbgResumeStopCounter = 0;
class CustomStoppedEvent extends Event implements DebugProtocol.Event {
    public readonly body: {
        reason: string,
        threadID: number
    };
    public readonly event: string;

    constructor(reason: string, threadID: number) {
        super('custom-stop', { reason: reason, threadID: threadID });
        console.log(`${dbgResumeStopCounter} **** Stopped reason:${reason} thread:${threadID}`);
        dbgResumeStopCounter++;
    }
}

class CustomContinuedEvent extends Event implements DebugProtocol.Event {
    public readonly body: {
        threadID: number;
        allThreads: boolean;
    };
    public readonly event: string;

    constructor(threadID: number, allThreads: boolean = true) {
        super('custom-continued', { threadID: threadID, allThreads: allThreads });
        console.log(`${dbgResumeStopCounter} **** Running thread:${threadID}`);
        dbgResumeStopCounter++;
    }
}

const traceThreads = false;

export class GDBDebugSession extends DebugSession {
    private server: GDBServer;
    private args: ConfigurationArguments;
    private ports: { [name: string]: number };
    private serverController: GDBServerController;
    public symbolTable: SymbolTable;

    protected variableHandles = new Handles<string | VariableObject | ExtendedVariable>(VAR_HANDLES_START);
    protected variableHandlesReverse: { [id: string]: number } = {};
    protected quit: boolean;
    protected attached: boolean;
    protected trimCWD: string;
    protected switchCWD: string;
    protected started: boolean;
    protected debugReady: boolean;
    public miDebugger: MI2;
    protected forceDisassembly: boolean = false;
    protected activeEditorPath: string = null;
    protected disassember: GdbDisassembler;
    // currentThreadId is the currently selected thread or where execution has stopped. It not very
    // meaningful since the current thread id in gdb can change in many ways (when you use a --thread
    // option on certain commands) 
    protected currentThreadId: number = 0;
    protected activeThreadIds = new Set<number>();      // Used for consistency check

    /**
     * If we are requested a major switch like restart/disconnect/detach we may have to interrupt the
     * the target to make it happen. That interrupt can cause a chain reaction of events, responses
     * and requests -- considerable gdb chatter -- that affects what we are trying to do. We still rely
     * on our event 'generic-stopped' but not send events to clients like VSCode or our own frontend.
     * We should always keep our own state valid though
     */
    protected disableSendStoppedEvents = false;

    private stopped: boolean = false;
    private stoppedReason: string = '';
    private continuing: boolean = false;

    // stoppedThreadId represents where execution stopped because of a pause, exception, step or breakpoint
    // Generally continuing execution can only work from that thread for embedded processors. It is bit
    // different from 'currentThreadId'. This is also the last thread-id used to notify VSCode about
    // the current thread so the call-stack will initially point to this thread. Maybe currentThreadId
    // can be made stricter and we can remove this variable
    private stoppedThreadId: number = 0;
    private stoppedEventPending = false;

    protected functionBreakpoints = [];
    protected breakpointMap: Map<string, OurSourceBreakpoint[]> = new Map();
    protected instrBreakpointMap: Map<number, OurInstructionBreakpoint> = new Map();
    protected dataBreakpointMap: Map<number, OurDataBreakpoint> = new Map();
    protected fileExistsCache: Map<string, boolean> = new Map();

    private currentFile: string;
    protected onConfigDone: EventEmitter = new EventEmitter();
    protected configDone: boolean;

    protected suppressRadixMsgs = false;

    public constructor(debuggerLinesStartAt1: boolean, isServer: boolean = false, threadID: number = 1) {
        super(debuggerLinesStartAt1, isServer);
    }

    // tslint:disable-next-line: max-line-length
    public sendErrorResponsePub(response: DebugProtocol.Response, codeOrMessage: number | DebugProtocol.Message, format?: string, variables?: any, dest?: any): void {
        this.sendErrorResponse(response, codeOrMessage, format, variables, dest);
    }

    protected initDebugger() {
        this.miDebugger.on('launcherror', this.launchError.bind(this));
        this.miDebugger.on('quit', this.quitEvent.bind(this));
        this.miDebugger.on('exited-normally', this.quitEvent.bind(this));
        this.miDebugger.on('stopped', this.stopEvent.bind(this));
        this.miDebugger.on('msg', this.handleMsg.bind(this));
        this.miDebugger.on('breakpoint', this.handleBreakpoint.bind(this));
        this.miDebugger.on('watchpoint', this.handleWatchpoint.bind(this, 'hit'));
        this.miDebugger.on('watchpoint-scope', this.handleWatchpoint.bind(this, 'scope'));
        this.miDebugger.on('step-end', this.handleBreak.bind(this));
        this.miDebugger.on('step-out-end', this.handleBreak.bind(this));
        this.miDebugger.on('signal-stop', this.handlePause.bind(this));
        this.miDebugger.on('running', this.handleRunning.bind(this));
        this.miDebugger.on('continue-failed', this.handleContinueFailed.bind(this));
        this.miDebugger.on('thread-created', this.handleThreadCreated.bind(this));
        this.miDebugger.on('thread-exited', this.handleThreadExited.bind(this));
        this.miDebugger.on('thread-selected', this.handleThreadSelected.bind(this));
        this.miDebugger.on('thread-group-exited', this.handleThreadGroupExited.bind(this));
        this.sendEvent(new InitializedEvent());
    }

    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
        response.body.supportsHitConditionalBreakpoints = true;
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsConditionalBreakpoints = true;
        response.body.supportsFunctionBreakpoints = true;
        response.body.supportsEvaluateForHovers = true;
        response.body.supportsSetVariable = true;
        response.body.supportsRestartRequest = true;
        response.body.supportsGotoTargetsRequest = true;
        response.body.supportSuspendDebuggee = true;
        response.body.supportTerminateDebuggee = true;
        response.body.supportsDataBreakpoints = true;
        response.body.supportsDisassembleRequest = true;
        response.body.supportsSteppingGranularity = true;
        response.body.supportsInstructionBreakpoints = true;
        this.sendResponse(response);
    }

    private launchAttachInit(args: ConfigurationArguments) {
        this.args = this.normalizeArguments(args);
        this.breakpointMap = new Map();
        this.dataBreakpointMap = new Map();
        this.fileExistsCache = new Map();
    }

    private dbgSymbolTable: SymbolTable = null;
    private async loadSymbols() {
        // this.dbgSymbolStuff(args, '/Users/hdm/Downloads/XXX-01.elf', 'main', null);
        // this.dbgSymbolStuff(args, '/Users/hdm/Downloads/bme680-driver-design_585.out', 'setup_bme680', './src/bme680_test_app.c');
        // this.dbgSymbolStuff(args, '/Users/hdm/Downloads/test.out', 'BSP_Delay', 'C:/Development/GitRepos/Firmware/phoenix/STM32F4/usb_bsp.c');
        if (this.args.showDevDebugOutput) {
            this.handleMsg('log', `Reading symbols from '${this.args.executable}'\n`);
        }
        this.symbolTable = new SymbolTable(
            this.miDebugger,
            this.args.toolchainPath,
            this.args.toolchainPrefix,
            this.args.objdumpPath,
            this.args.executable);
        await this.symbolTable.loadSymbols();

        if (this.args.rttConfig.enabled && (this.args.rttConfig.address === 'auto')) {
            const symName = '_SEGGER_RTT';
            const rttSym = this.symbolTable.getGlobalOrStaticVarByName(symName);
            if (!rttSym) {
                this.args.rttConfig.enabled = false;
                this.handleMsg('stderr', `Could not find symbol '${symName}' in executable. ` +
                    'Make sure you complile/link with debug ON or you can specify your own RTT address\n');
            } else {
                const searchStr = this.args.rttConfig.searchId || 'SEGGER RTT';
                this.args.rttConfig.address = '0x' + rttSym.address.toString(16);
                this.args.rttConfig.searchSize = Math.max(this.args.rttConfig.searchSize || 0, searchStr.length);
                this.args.rttConfig.searchId = searchStr;
                this.args.rttConfig.clearSearch = (this.args.rttConfig.clearSearch === undefined) ? true : this.args.rttConfig.clearSearch;
            }
        }

        // this.symbolTable.printToFile(args.executable + '.cd-dump');
        if (this.args.showDevDebugOutput) {
            this.handleMsg('log', 'Finished reading symbols\n');
        }
    }

    private async dbgSymbolStuff(args: ConfigurationArguments, elfFile: string, func: string, file: string) {
        if (os.userInfo().username === 'hdm') {
            this.handleMsg('log', `Reading symbols from ${elfFile}\n`);
            const toolchainPath = true ? '/Applications/ARM/bin' : args.toolchainPath;
            const tmpSymbols = new SymbolTable(this.miDebugger, toolchainPath, args.toolchainPrefix, args.objdumpPath, elfFile);
            this.dbgSymbolTable = tmpSymbols;
            await tmpSymbols.loadSymbols(true, '/Users/hdm/Downloads/objdump.txt');
            tmpSymbols.printToFile(elfFile + '.cd-dump');
            let sym = tmpSymbols.getFunctionByName(func, file);
            console.log(sym);
            sym = tmpSymbols.getFunctionByName('memset');
            console.log(sym);
            this.handleMsg('log', 'Finished Reading symbols\n');
            const functionSymbols = tmpSymbols.getFunctionSymbols();
            const functions = functionSymbols.filter((s) => s.name === func);
            console.log(functions);
        }
    }

    protected launchRequest(response: DebugProtocol.LaunchResponse, args: ConfigurationArguments): void {
        this.launchAttachInit(args);
        this.processLaunchAttachRequest(response, false);
    }

    protected attachRequest(response: DebugProtocol.AttachResponse, args: ConfigurationArguments): void {
        this.launchAttachInit(args);
        this.processLaunchAttachRequest(response, true);
    }

    private normalizeArguments(args: ConfigurationArguments): ConfigurationArguments {
        args.graphConfig = args.graphConfig || [];

        if (args.executable && !path.isAbsolute(args.executable)) {
            args.executable = path.normalize(path.join(args.cwd, args.executable));
        }

        if (args.svdFile && !path.isAbsolute(args.svdFile)) {
            args.svdFile = path.normalize(path.join(args.cwd, args.svdFile));
        }

        if (args.swoConfig && args.swoConfig.decoders) {
            args.swoConfig.decoders = args.swoConfig.decoders.map((dec) => {
                if (dec.type === 'advanced' && dec.decoder && !path.isAbsolute(dec.decoder)) {
                    dec.decoder = path.normalize(path.join(args.cwd, dec.decoder));
                }
                return dec;
            });
        }

        if (args.rttConfig && args.rttConfig.decoders) {
            args.rttConfig.decoders = args.rttConfig.decoders.map((dec: any) => {
                if (dec.type === 'advanced' && dec.decoder && !path.isAbsolute(dec.decoder)) {
                    dec.decoder = path.normalize(path.join(args.cwd, dec.decoder));
                }
                return dec;
            });
        }

        return args;
    }

    private getTCPPorts(useParent): Thenable<void> {
        return new Promise((resolve, reject) => {
            let startPort = 50000;
            if (useParent) {
                this.ports = this.args.pvtPorts = this.args.pvtParent.pvtPorts;
                this.serverController.setPorts(this.ports);
                if (this.args.showDevDebugOutput) {
                    this.handleMsg('log', JSON.stringify({configFromParent: this.args.pvtMyConfigFromParent}, undefined, 4) + '\n');
                }
                return resolve();
            } else if (this.args.pvtParent?.pvtPorts) {
                // Avoid parents ports and give a gap of 10
                for (const p of Object.values(this.args.pvtParent.pvtPorts)) {
                    startPort = Math.max(startPort, p + 10);
                }
            }
            const totalPortsNeeded = this.calculatePortsNeeded();
            const portFinderOpts = { min: startPort, max: 52000, retrieve: totalPortsNeeded, consecutive: true };
            TcpPortScanner.findFreePorts(portFinderOpts, GDBServer.LOCALHOST).then((ports) => {
                this.createPortsMap(ports);
                this.serverController.setPorts(this.ports);
                resolve();
            }, (e) => {
                reject(e);
            });
        });
    }

    private async processLaunchAttachRequest(response: DebugProtocol.LaunchResponse, attach: boolean) {
        if (!fs.existsSync(this.args.executable)) {
            this.sendErrorResponse(
                response,
                103,
                `Unable to find executable file at ${this.args.executable}.`
            );
            return;
        }

        const ControllerClass = SERVER_TYPE_MAP[this.args.servertype];
        this.serverController = new ControllerClass();
        this.serverController.setArguments(this.args);
        this.serverController.on('event', this.serverControllerEvent.bind(this));

        this.quit = false;
        this.attached = false;
        this.started = false;
        this.debugReady = false;
        this.stopped = false;
        this.continuing = false;
        this.activeThreadIds.clear();
        this.disassember = new GdbDisassembler(this, this.args);
        // dbgResumeStopCounter = 0;

        if (!await this.startGdb(response)) {
            return;
        }

        const usingParentServer = this.args.pvtMyConfigFromParent && !this.args.pvtMyConfigFromParent.detached;
        this.getTCPPorts(usingParentServer).then(() => {
            const executable = usingParentServer ? null : this.serverController.serverExecutable();
            const args = usingParentServer ? [] : this.serverController.serverArguments();

            if (executable) {
                const dbgMsg = 'Launching gdb-server: ' + quoteShellCmdLine([executable, ...args]) + '\n';
                this.handleMsg('log', dbgMsg);
                this.handleMsg('log', `Please check TERMINAL tab (gdb-server) for output from ${executable}` + '\n');
            }

            const consolePort = (this.args as any).gdbServerConsolePort;
            const gdbPort = this.ports[createPortName(this.args.targetProcessor)];
            let initMatch = null;
            if (!usingParentServer) {
                this.serverController.initMatch();
                if (this.args.overrideGDBServerStartedRegex) {
                    initMatch = new RegExp(this.args.overrideGDBServerStartedRegex, 'i');
                }

                if (consolePort === undefined) {
                    this.sendErrorResponse(
                        response,
                        107,
                        'GDB Server Console tcp port is undefined.'
                    );
                    return;
                }
            }
            this.server = new GDBServer(this.args.cwd, executable, args, initMatch, gdbPort, consolePort);
            this.server.on('quit', () => {
                if (this.started) {
                    this.quitEvent();
                }
                else {
                    this.sendErrorResponse(
                        response,
                        103,
                        `${this.serverController.name} GDB Server Quit Unexpectedly. See gdb-server output for more details.`
                    );
                }
            });
            this.server.on('launcherror', (err) => {
                this.sendErrorResponse(response, 103, `Failed to launch ${this.serverController.name} GDB Server: ${err.toString()}`);
            });

            let timeout = setTimeout(() => {
                this.server.exit();
                this.sendEvent(new TelemetryEvent(
                    'Error',
                    'Launching Server',
                    `Failed to launch ${this.serverController.name} GDB Server: Timeout.`
                ));
                this.sendErrorResponse(response, 103, `Failed to launch ${this.serverController.name} GDB Server: Timeout.`);
            }, GDBServer.SERVER_TIMEOUT);

            this.serverController.serverLaunchStarted();
            this.server.init().then(async (started) => {
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                }

                await this.serverController.serverLaunchCompleted();
                this.sendEvent(new GenericCustomEvent('post-start-server', this.args));

                const commands = [
                    `interpreter-exec console "source ${this.args.extensionPath}/support/gdbsupport.init"`,
                    `interpreter-exec console "source ${this.args.extensionPath}/support/gdb-swo.init"`
                ];

                if (!this.args.variableUseNaturalFormat) {
                    commands.push(...this.formatRadixGdbCommand());
                }

                try {
                    commands.push(...this.serverController.initCommands());

                    if (attach) {
                        commands.push(...this.args.preAttachCommands.map(COMMAND_MAP));
                        const attachCommands = this.args.overrideAttachCommands != null ?
                            this.args.overrideAttachCommands.map(COMMAND_MAP) : this.serverController.attachCommands();
                        commands.push(...attachCommands);
                        commands.push(...this.args.postAttachCommands.map(COMMAND_MAP));
                    }
                    else {
                        commands.push(...this.args.preLaunchCommands.map(COMMAND_MAP));
                        const launchCommands = this.args.overrideLaunchCommands != null ?
                            this.args.overrideLaunchCommands.map(COMMAND_MAP) : this.serverController.launchCommands();
                        commands.push(...launchCommands);
                        commands.push(...this.args.postLaunchCommands.map(COMMAND_MAP));
                    }
                }
                catch (err) {
                    const msg = err.toString() + '\n' + err.stack.toString();
                    this.sendEvent(new TelemetryEvent('Error', 'Launching GDB', `Failed to generate gdb commands: ${msg}`));
                    this.sendErrorResponse(response, 104, `Failed to generate gdb commands: ${msg}`);
                    return;
                }

                this.serverController.debuggerLaunchStarted();
                this.miDebugger.once('debug-ready', () => {
                    this.debugReady = true;
                    this.attached = attach;
                });

                this.disableSendStoppedEvents = (!attach && (this.args.runToEntryPoint || this.args.noDebug)) ? true : false;
                // For now, we unconditionally suppress events because we will recover after we run the post start commands
                this.disableSendStoppedEvents = true;
                this.miDebugger.connect(commands).then(() => {
                    this.started = true;
                    this.serverController.debuggerLaunchCompleted();
                    this.sendEvent(new GenericCustomEvent('post-start-gdb', this.args));

                    this.sendResponse(response);
                    this.finishStartSequence(attach ? SessionMode.ATTACH : SessionMode.LAUNCH);
                }, (err) => {
                    this.sendErrorResponse(response, 103, `Failed to launch GDB: ${err.toString()}`);
                    this.sendEvent(new TelemetryEvent('Error', 'Launching GDB', err.toString()));
                    this.miDebugger.stop();     // This should also kill the server if there is one
                    this.server.exit();
                });

            }, (error) => {
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                }
                this.sendEvent(new TelemetryEvent(
                    'Error',
                    'Launching Server',
                    `Failed to launch ${this.serverController.name} GDB Server: ${error.toString()}`
                ));
                this.sendErrorResponse(response, 103, `Failed to launch ${this.serverController.name} GDB Server: ${error.toString()}`);
                this.server.exit();
            });

        }, (err) => {
            this.sendEvent(new TelemetryEvent('Error', 'Launching Server', `Failed to find open ports: ${err.toString()}`));
            this.sendErrorResponse(response, 103, `Failed to find open ports: ${err.toString()}`);
        });
    }

    private notifyStopped(doCustom = true) {
        this.sendEvent(new StoppedEvent(this.stoppedReason, this.currentThreadId, true));
        if (doCustom) {
            this.sendEvent(new CustomStoppedEvent(this.stoppedReason, this.currentThreadId));
        }
    }

    private startComplete(mode: SessionMode, fakeStop = true) {
        this.disableSendStoppedEvents = false;
        this.pendingBkptResponse = false;
        this.continuing = false;
        this.stopped = this.miDebugger.status !== 'running';        // Set to real status
        if (fakeStop && !this.args.noDebug && this.stopped) {
            this.stoppedReason = mode;
            this.stoppedThreadId = this.currentThreadId;
            // We have to fake a continue and then stop, since we may already be in stopped mode in VSCode's view
            this.sendEvent(new ContinuedEvent(this.currentThreadId, true));
            this.notifyStopped();
        }
    }

    private runPostCommands(mode: SessionMode) {
        if (this.configDone) {
            this.runPostStartSessionCommands(mode);
        } else {
            this.onConfigDone.once('done', () => {      // Only applies to 'LAUNCH'/'ATTACH'
                this.runPostStartSessionCommands(mode);
            });
        }
    }

    private async finishStartSequence(mode: SessionMode) {
        try {
            if ((mode === SessionMode.ATTACH) || (mode === SessionMode.LAUNCH)) {
                const commands = this.serverController.swoAndRTTCommands();
                for (const cmd of commands) {
                    await this.miDebugger.sendCommand(cmd);
                }
            }
        }
        catch (e) {
            const msg = `SWO/RTT Initializaiton failed: ${e}`;
            this.handleMsg('stderr', msg);
            this.sendEvent(new GenericCustomEvent('popup', {type: 'error', message: msg}));
        }
        if (!this.args.noDebug && (mode !== SessionMode.ATTACH) && this.args.runToEntryPoint) {
            this.miDebugger.sendCommand(`break-insert -t --function ${this.args.runToEntryPoint}`).then(() => {
                let timeout = setTimeout(() => {
                    this.handleMsg('stderr', `Run to '${this.args.runToEntryPoint}' timed out. Trying to pause program\n`);
                    this.miDebugger.interrupt();
                    timeout = null;
                }, 5000);

                this.miDebugger.once('generic-stopped', () => {
                    if (timeout) {
                        clearTimeout(timeout);
                    }
                    this.startComplete(mode);
                    // We don't run post-commands. If user wants, they can add the temp. bpt to their post commands
                    // This is intentional
                });

                // To avoid race conditions between finishing configuration, we should stay
                // in stopped mode. Or, we end up clobbering the stopped event that might come
                // during setting of any additional breakpoints. Note that configDone may already
                // have happened if there were no user breakpoints.
                if (this.configDone) {
                    this.sendContinue();
                } else {
                    this.onConfigDone.once('done', () => {      // Only applies to 'LAUNCH'
                        this.sendContinue();
                    });
                }
            }, (err) => {
                // If failed to set the temporary breakpoint (e.g. function does not exist)
                // complete the launch as if the breakpoint had not being defined
                this.handleMsg('log', `launch.json: Unable to set temporary breakpoint "runToEntryPoint":"${this.args.runToEntryPoint}".` +
                    'Function may not exist or out of breakpoints? ' + err.toString() + '\n');
                if (mode === SessionMode.LAUNCH) {
                    this.args.runToEntryPoint = '';     // Don't try again. It will likely to fail
                }
                this.startComplete(mode);
            });
        } else {
            this.runPostCommands(mode);
            this.startComplete(mode, (mode === SessionMode.ATTACH) || this.args.breakAfterReset);
        }
    }

    private async startGdb(response: DebugProtocol.LaunchResponse): Promise<boolean> {
        let gdbExePath = os.platform() !== 'win32' ? `${this.args.toolchainPrefix}-gdb` : `${this.args.toolchainPrefix}-gdb.exe`;
        if (this.args.toolchainPath) {
            gdbExePath = path.normalize(path.join(this.args.toolchainPath, gdbExePath));
        }
        if (this.args.gdbPath) {
            gdbExePath = this.args.gdbPath;
        }

        // Check to see if gdb exists.
        if (path.isAbsolute(gdbExePath)) {
            if (fs.existsSync(gdbExePath) === false) {
                this.sendErrorResponse(
                    response,
                    103,
                    `GDB executable "${gdbExePath}" was not found.\n` +
                    'Please configure "cortex-debug.armToolchainPath" or "cortex-debug.gdbPath" correctly.'
                );
                return false;
            }
        }
        else {
            if (!hasbin.sync(gdbExePath.replace('.exe', ''))) {
                this.sendErrorResponse(
                    response,
                    103,
                    `GDB executable "${gdbExePath}" was not found.\n` +
                    'Please configure "cortex-debug.armToolchainPath" or "cortex-debug.gdbPath"  correctly.'
                );
                return false;
            }
        }

        let gdbargs = ['-q', '--interpreter=mi2'];
        gdbargs = gdbargs.concat(this.args.debuggerArgs || []);
        const dbgMsg = 'Launching GDB: ' + quoteShellCmdLine([gdbExePath, ...gdbargs, this.args.executable]) + '\n';
        this.handleMsg('log', dbgMsg);
        if (!this.args.showDevDebugOutput) {
            this.handleMsg('log', 'Set "showDevDebugOutput": true in your "launch.json" to see verbose GDB transactions ' +
                'here. Helpful to debug issues or report problems\n');
            if (this.args.chainedConfigurations && this.args.chainedConfigurations.enabled) {
                const str = JSON.stringify({chainedConfigurations: this.args.chainedConfigurations}, null, 4);
                this.handleMsg('log', str + '\n');
            }
        }

        this.miDebugger = new MI2(gdbExePath, gdbargs);
        this.miDebugger.debugOutput = this.args.showDevDebugOutput as ADAPTER_DEBUG_MODE;
        this.initDebugger();
        await this.miDebugger.start(this.args.cwd, this.args.executable, [
            'interpreter-exec console "set print demangle on"',
            'interpreter-exec console "set print asm-demangle on"'
        ]);
        this.loadSymbols();
        return true;
    }

    private async sendContinue(wait: boolean = false) {
        this.continuing = true;
        try {
            if (wait) {
                await this.miDebugger.sendCommand('exec-continue');
            } else {
                this.miDebugger.sendCommand('exec-continue').then((done) => {
                    // Nothing to do
                }, (e) => {
                    throw e;
                });
            }
        }
        catch (e) {
            this.continuing = false;
            console.error('Not expecting continue to fail. ' + e);
        }
    }

    // When we have a multi-core device, we have to allocate as many ports as needed
    // for each core. As of now, we can only debug one core at a time but we have to know
    // which one. This is true of OpenOCD and pyocd but for now, we apply the policy for all
    // This was only needed because gdb-servers allow a port setting, but then they increment
    // for additional cores.
    private calculatePortsNeeded() {
        const portsNeeded = this.serverController.portsNeeded.length;
        const numProcs = Math.max(this.args.numberOfProcessors || 1, 1);
        let targProc = this.args.targetProcessor || 0;
        if ((targProc < 0) || (targProc >= numProcs)) {
            targProc = (targProc < 0) ? 0 : (numProcs - 1);
            this.handleMsg('log', `launch.json: 'targetProcessor' must be >= 0 && < 'numberOfProcessors'. Setting it to ${targProc}` + '\n');
            targProc = numProcs - 1;
        }
        const totalPortsNeeded = portsNeeded * numProcs;
        this.args.numberOfProcessors = numProcs;
        this.args.targetProcessor = targProc;
        return totalPortsNeeded;
    }

    private createPortsMap(ports: number[]) {
        const numProcs = this.args.numberOfProcessors;
        this.ports = {};
        let idx = 0;
        // Ports are allocated so that all ports of same type come consecutively, then next and
        // so on. This is the method used by most gdb-servers.
        for (const pName of this.serverController.portsNeeded) {
            for (let proc = 0; proc < numProcs; proc++) {
                const nm = createPortName(proc, pName);
                this.ports[nm] = ports[idx++];
            }
        }
        this.args.pvtPorts = this.ports;
    }

    protected isMIStatusStopped(): boolean {
        // We get the status from the MI because we may not have recieved the event yet
        return (this.miDebugger.status !== 'running');
    }

    // Runs a set of commands after a quiet time and is no other gdb transactions are happening
    protected runPostStartSessionCommands(mode: SessionMode, interval: number = 100): void {
        let commands: string[] = [];
        let shouldContinue = false;
        switch (mode) {
            case SessionMode.RESTART:
                commands = this.args.postRestartSessionCommands || [];
                break;
            case SessionMode.RESET:
                commands = this.args.postRestartSessionCommands || [];
                break;
            default:
                commands = this.args.postStartSessionCommands || [];
                break;
        }

        if ((mode !== SessionMode.ATTACH) && this.args.noDebug) {
            shouldContinue = true;
        } else if (!this.args.breakAfterReset && (mode !== SessionMode.ATTACH) && (commands.length === 0)) {
            shouldContinue = true;
        }

        if ((commands.length > 0) || shouldContinue) {
            commands = commands.map(COMMAND_MAP);
            // We want to let things quiet down before we run the next set of commands. Note that while
            // we are running this command sequence, some results can cause other gdb commands to be generated if
            // running state changes. Can't help it for now
            let curToken = this.miDebugger.getCurrentToken();
            let nTries = 1;
            const to = setInterval(async () => {
                const nxtToken = this.miDebugger.getCurrentToken();
                if ((nTries > 20) || (curToken === nxtToken)) {
                    clearInterval(to);
                    this.miDebugger.postStart(commands).then(() => {
                        if (shouldContinue && this.isMIStatusStopped()) {
                            this.sendContinue();
                        }
                    }, (e) => {
                        const msg = `Error running post start/restart/reset commands ${e}`;
                        this.sendEvent(new GenericCustomEvent('popup', {type: 'error', message: msg}));
                        if (shouldContinue && this.isMIStatusStopped()) {
                            this.sendContinue();
                        }
                    });
                } else {
                    curToken = nxtToken;
                    nTries++;
                }
            }, interval);
        }
    }

    protected customRequest(command: string, response: DebugProtocol.Response, args: any): void {
        if (this.serverController.customRequest(command, response, args)) {
            this.sendResponse(response);
            return;
        }

        const isBusy = !this.stopped || this.continuing || (this.miDebugger.status === 'running');
        switch (command) {
            case 'set-force-disassembly':
                response.body = { success: true };
                this.forceDisassembly = args.force;
                if (this.stopped) {
                    this.activeEditorPath = null;
                    this.sendEvent(new ContinuedEvent(this.currentThreadId, true));
                    this.sendEvent(new StoppedEvent(this.stoppedReason, this.currentThreadId, true));
                }
                this.sendResponse(response);
                break;
            case 'load-function-symbols':
                response.body = { functionSymbols: this.symbolTable.getFunctionSymbols() };
                this.sendResponse(response);
                break;
            case 'set-active-editor':
                if (args.path !== this.activeEditorPath) {
                    this.activeEditorPath = args.path;
                    // if (this.stopped) {
                    //     this.sendEvent(new StoppedEvent(this.stoppedReason, this.currentThreadId, true));
                    // }
                }
                response.body = {};
                this.sendResponse(response);
                break;
            case 'get-arguments':
                response.body = this.args;
                this.sendResponse(response);
                break;
            case 'read-memory':
                if (isBusy) { return; }
                this.readMemoryRequestCustom(response, args['address'], args['length']);
                break;
            case 'write-memory':
                if (isBusy) { return; }
                this.writeMemoryRequestCustom(response, args['address'], args['data']);
                break;
            case 'set-var-format':
                this.args.variableUseNaturalFormat = (args && args.hex) ? false : true;
                this.setGdbOutputRadix();
                break;
            case 'read-registers':
                if (isBusy) { return; }
                this.args.registerUseNaturalFormat = (args && args.hex) ? false : true;
                this.readRegistersRequest(response);
                break;
            case 'read-register-list':
                this.readRegisterListRequest(response);
                break;
            case 'disassemble':
                this.disassember.customDisassembleRequest(response, args);
                break;
            case 'execute-command':
                let cmd = args['command'] as string;
                if (cmd.startsWith('-')) { cmd = cmd.substring(1); }
                else { cmd = `interpreter-exec console "${cmd}"`; }
                this.miDebugger.sendCommand(cmd).then((node) => {
                    response.body = node.resultRecords;
                    this.sendResponse(response);
                }, (error) => {
                    response.body = error;
                    this.sendErrorResponse(response, 110, 'Unable to execute command');
                });
                break;
            case 'reset-device':
                this.resetDevice(response, args);
                break;
            case 'set-stop-debugging-type':
                this.disconnectRequest2(response, args);
                break;
            case 'notified-children-to-terminate':  // We never get this request
                this.emit('children-terminating');
                this.sendResponse(response);
                break;
            default:
                response.body = { error: 'Invalid command.' };
                this.sendResponse(response);
                break;
        }
    }

    protected setGdbOutputRadix() {
        for (const cmd of this.formatRadixGdbCommand()) {
            this.miDebugger.sendCommand(cmd);
        }
        if (this.stopped) {
            // We area already stopped but this fakes a stop again which refreshes all debugger windows
            // We don't have a way to only referesh portions. It is all or nothing, there is a bit
            // of screen flashing and causes changes in GUI contexts (stack for instance)
            this.sendEvent(new StoppedEvent(this.stoppedReason, this.currentThreadId, true));
        }
    }

    private formatRadixGdbCommand(forced: string | null = null): string[] {
        // radix setting affects future inerpretations of values, so format it unambigiously with hex values
        const radix = forced || (this.args.variableUseNaturalFormat ? '0xa' : '0x10');
        // If we set just the output radix, it will affect setting values. Always leave input radix in decimal
        // Also, don't understand why setting the output-radix modifies the input radix as well
        const cmds = [
            `interpreter-exec console "set output-radix ${radix}"`,
            'interpreter-exec console "set input-radix 0xa"'
        ];
        return cmds;
    }

    protected disassembleRequest(
        response: DebugProtocol.DisassembleResponse,
        args: DebugProtocol.DisassembleArguments,
        request?: DebugProtocol.Request): void {
        this.disassember.disassembleProtocolRequest(response, args, request);
    }

    protected readMemoryRequestCustom(response: DebugProtocol.Response, startAddress: string, length: number) {
        this.miDebugger.sendCommand(`data-read-memory-bytes "${startAddress}" ${length}`).then((node) => {
            const startAddress = node.resultRecords.results[0][1][0][0][1];
            const endAddress = node.resultRecords.results[0][1][0][2][1];
            const data = node.resultRecords.results[0][1][0][3][1];
            const bytes = data.match(/[0-9a-f]{2}/g).map((b) => parseInt(b, 16));
            response.body = {
                startAddress: startAddress,
                endAddress: endAddress,
                bytes: bytes
            };
            this.sendResponse(response);
        }, (error) => {
            response.body = { error: error };
            this.sendErrorResponse(response, 114, `Read memory error: ${error.toString()}`);
            this.sendEvent(new TelemetryEvent('Error', 'Reading Memory', `${startAddress}-${length.toString(16)}`));
        });
    }

    protected writeMemoryRequestCustom(response: DebugProtocol.Response, startAddress: number, data: string) {
        const address = hexFormat(startAddress, 8);
        this.miDebugger.sendCommand(`data-write-memory-bytes ${address} ${data}`).then((node) => {
            this.sendResponse(response);
        }, (error) => {
            response.body = { error: error };
            this.sendErrorResponse(response, 114, `Write memory error: ${error.toString()}`);
            this.sendEvent(new TelemetryEvent('Error', 'Writing Memory', `${startAddress.toString(16)}-${data.length.toString(16)}`));
        });
    }

    protected readRegistersRequest(response: DebugProtocol.Response) {
        try {
            if (!this.args.variableUseNaturalFormat) {
                // requesting a radix on the register-values does not work unless the output radix is
                // decimal. bug in gdb I think. We temporarily force to decimal and then restore later
                this.suppressRadixMsgs = true;
                for (const cmd of this.formatRadixGdbCommand('0xa')) {
                    this.miDebugger.sendCommand(cmd);
                }
            }

            const fmt = this.args.registerUseNaturalFormat ? 'N' : 'x';
            this.miDebugger.sendCommand(`data-list-register-values ${fmt}`).then((node) => {
                if (node.resultRecords.resultClass === 'done') {
                    const rv = node.resultRecords.results[0][1];
                    response.body = rv.map((n) => {
                        const val = {};
                        n.forEach((x) => {
                            val[x[0]] = x[1];
                        });
                        return val;
                    });
                }
                else {
                    response.body = {
                        error: 'Unable to parse response'
                    };
                }
                this.sendResponse(response);
            }, (error) => {
                response.body = { error: error };
                this.sendErrorResponse(response, 115, `Unable to read registers: ${error.toString()}`);
                this.sendEvent(new TelemetryEvent('Error', 'Reading Registers', ''));
            });

            if (!this.args.variableUseNaturalFormat) {
                const cmds = this.formatRadixGdbCommand();
                for (let ix = 0; ix < cmds.length; ix++) {
                    this.miDebugger.sendCommand(cmds[ix]).then((_) => {
                        if (ix === (cmds.length - 1)) {   // Last one
                            this.suppressRadixMsgs = false;
                        }
                    }, (_) => {
                        if (ix === (cmds.length - 1)) {   // Last one
                            this.suppressRadixMsgs = false;
                        }
                    });
                }
            }
        }
        catch {
            this.suppressRadixMsgs = false;
        }
    }

    protected readRegisterListRequest(response: DebugProtocol.Response) {
        this.miDebugger.sendCommand('data-list-register-names').then((node) => {
            if (node.resultRecords.resultClass === 'done') {
                let registerNames;
                node.resultRecords.results.forEach((rr) => {
                    if (rr[0] === 'register-names') {
                        registerNames = rr[1];
                    }
                });
                response.body = registerNames;
            }
            else {
                response.body = { error: node.resultRecords.results };
            }
            this.sendResponse(response);
        }, (error) => {
            response.body = { error: error };
            this.sendErrorResponse(response, 116, `Unable to read register list: ${error.toString()}`);
            this.sendEvent(new TelemetryEvent('Error', 'Reading Register List', ''));
        });
    }

    private waitForServerExitAndRespond(response: DebugProtocol.DisconnectResponse) {
        if (!this.server.isExternal()) {
            let nTimes = 60;
            let to = setInterval(() => {
                if ((nTimes === 0) || this.quit) {
                    // We waited long enough so try to nuke the server and send VSCode a response
                    // This is a really bad situation to be in, but not sure what else to do.
                    clearInterval(to);
                    to = null;
                    this.server.exit();
                    ServerConsoleLog('disconnectRequest sendResponse 3', this.miDebugger?.pid);
                    this.sendResponse(response);
                } else {
                    nTimes--;
                }
            }, 10);
            this.server.once('exit', () => {
                if (to) {
                    clearInterval(to);
                    to = null;
                    ServerConsoleLog('disconnectRequest sendResponse 2', this.miDebugger?.pid);
                    this.sendResponse(response);
                }
            });
            // Note: If gdb exits first, then we kill the server anyways
        } else {
            this.miDebugger.once('quit', () => {
                ServerConsoleLog('disconnectRequest sendResponse 1', this.miDebugger?.pid);
                this.sendResponse(response);
            });
        }
    }

    protected isDisconnecting = false;
    protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
        if (this.isDisconnecting) {
            // One of the ways Tthis happens when we have the following
            // * we are a child session of someone else
            // * the parent has already asked us to quit and in the process, we sent a TerminatedEvent to VSCode
            // * VSCode in turn asks to disconnect. all is good
            this.sendResponse(response);
            return;
        }
        if (this.args.chainedConfigurations && this.args.chainedConfigurations.enabled) {
            ServerConsoleLog('Begin disconnectRequest children', this.miDebugger?.pid);
            this.sendEvent(new GenericCustomEvent('session-terminating', args));
            let timeout = setTimeout(() => {
                if (timeout) {
                    ServerConsoleLog('Timed out waiting for children to exit', this.miDebugger?.pid);
                    timeout = null;
                    this.disconnectRequest2(response, args);
                }
            }, 1000);
            this.on('children-terminating', () => {
                if (timeout) {
                    timeout = null;
                    clearTimeout(timeout);
                    this.disconnectRequest2(response, args);
                }
            });
        } else {
            this.disconnectRequest2(response, args);
        }
    }

    protected async tryDeleteBreakpoints(): Promise<boolean> {
        try {
            await this.miDebugger.sendCommand('break-delete');
            return true;
        }
        catch (e) {
            this.handleMsg('log', `Could not delete all breakpoints. ${e}\n`);
            return false;
        }
    }

    protected async disconnectRequest2(
        response: DebugProtocol.DisconnectResponse | DebugProtocol.Response,
        args: DebugProtocol.DisconnectArguments): Promise<void> {
        this.isDisconnecting = true;
        ServerConsoleLog('Begin disconnectRequest', this.miDebugger?.pid);
        let bkptsDeleted = false;
        const doDisconnectProcessing = () => {
            if (!bkptsDeleted) {
                this.tryDeleteBreakpoints();
            }
            this.disableSendStoppedEvents = false;
            this.attached = false;
            this.waitForServerExitAndRespond(response);     // Will wait asynchronously until the following actions are done
            if (args.terminateDebuggee || args.suspendDebuggee) {
                // There is no such thing as terminate for us. Hopefully, the gdb-server will
                // do the right thing and remain in halted state
                this.miDebugger.stop();
            } else {
                // If the gdb-server behaves like gdb (and us) expects it do, then the program
                // should continue
                this.miDebugger.detach();
            }
        };

        this.disableSendStoppedEvents = true;
        if (this.miDebugger) {
            if (this.stopped) {
                bkptsDeleted = true;
                this.tryDeleteBreakpoints();
            }
            let deferred = false;
            if (args.terminateDebuggee || args.suspendDebuggee) {
                if (!this.stopped) {
                    deferred = true;
                    // Many ways things can fail. See issue #561
                    // exec-interrupt can fail because gdb is wedged and does not respond with proper status ever
                    // use a timeout and try to end session anyways.
                    let to = setTimeout(() => {
                        if (to) {
                            to = null;
                            this.handleMsg('log', 'GDB never responded to an interrupt request. Trying to end session anyways\n');
                            doDisconnectProcessing();
                        }
                    }, 250);
                    this.miDebugger.once('generic-stopped', () => {
                        if (to) {
                            clearTimeout(to);
                            to = null;
                            doDisconnectProcessing();
                        }
                    });
                    try {
                        await this.miDebugger.sendCommand('exec-interrupt');
                    }
                    catch (e) {
                        // The timeout will take care of it...
                        this.handleMsg('log', `Could not interrupt program. Trying to end session anyways ${e}\n`);
                    }
                }
            } else if (this.stopped) {
                this.sendContinue(true);
            }
            if (!deferred) {
                doDisconnectProcessing();
            }
        }
    }

    //
    // I don't think we are following the protocol here. but the protocol doesn't make sense. I got a
    // clarification that for an attach session, restart means detach and re-attach. Doesn't make
    // any sense for embedded?
    //
    // https://github.com/microsoft/debug-adapter-protocol/issues/73
    //
    protected restartRequest(response: DebugProtocol.RestartResponse, args: DebugProtocol.RestartArguments | any): void {
        const mode: SessionMode = (args === 'reset') ? SessionMode.RESET : SessionMode.RESTART;
        const restartProcessing = () => {
            const commands = [];
            this.args.pvtRestartOrReset = true;
            this.disableSendStoppedEvents = false;
            this.continuing = false;

            commands.push(...this.args.preRestartCommands.map(COMMAND_MAP));
            const restartCommands = this.args.overrideRestartCommands != null ?
                this.args.overrideRestartCommands.map(COMMAND_MAP) : this.serverController.restartCommands();
            commands.push(...restartCommands);
            commands.push(...this.args.postRestartCommands.map(COMMAND_MAP));

            this.miDebugger.restart(commands).then((done) => {
                if (this.args.chainedConfigurations && this.args.chainedConfigurations.enabled) {
                    ServerConsoleLog(`Begin ${mode} children`, this.miDebugger?.pid);
                    this.sendEvent(new GenericCustomEvent(`session-${mode}`, args));
                }
    
                this.sendResponse(response);
                this.finishStartSequence(mode);
            }, (msg) => {
                this.sendErrorResponse(response, 6, `Could not restart/reset: ${msg}`);
            });
        };

        this.disableSendStoppedEvents = true;
        if (this.stopped) {
            restartProcessing();
        }
        else {
            this.miDebugger.once('generic-stopped', restartProcessing);
            this.miDebugger.sendCommand('exec-interrupt');
        }
    }

    protected getResetCommands(): string[] {
        if (this.args.overrideRestartCommands != null) {
            return this.args.overrideRestartCommands.map(COMMAND_MAP);
        }
        return this.serverController.restartCommands();
    }

    protected resetDevice(response: DebugProtocol.Response, args: any): void {
        this.restartRequest(response, args);
    }

    protected timeStart = Date.now();
    protected wrapTimeStamp(str: string): string {
        if (this.args.showDevDebugOutput && this.args.showDevDebugTimestamps) {
            const elapsed = Date.now() - this.timeStart;
            let elapsedStr = elapsed.toString();
            while (elapsedStr.length < 10) { elapsedStr = '0' + elapsedStr; }
            return elapsedStr + ': ' + str;
        } else {
            return str;
        }
    }

    private serverControllerEvent(event: DebugProtocol.Event) {
        this.sendEvent(event);
    }

    public handleMsg(type: string, msg: string) {
        if (this.suppressRadixMsgs && (type === 'console') && /radix/.test(msg)) {
            // Filter out unneccessary radix change messages
            return;
        }
        if (type === 'target') { type = 'stdout'; }
        if (type === 'log') { type = 'stderr'; }
        this.sendEvent(new OutputEvent(this.wrapTimeStamp(msg), type));
    }

    protected handleRunning(info: MINode) {
        this.stopped = false;
        this.continuing = false;
        this.sendEvent(new ContinuedEvent(this.currentThreadId, true));
        this.sendEvent(new CustomContinuedEvent(this.currentThreadId, true));
    }

    protected handleContinueFailed(info: MINode) {
        // Should we call exec-interrupt here? See #561
        // Once we get this, from here on, nothing really works with gdb.
        const msg = 'Error: A serious error occured with gdb, unable to continue or interrupt We may not be able to recover ' +
           'from this point. You can try continuing or ending sesson. Must address root cause though';
        this.sendEvent(new GenericCustomEvent('popup', {type: 'error', message: msg}));
        this.handleMsg('stderr', msg + '\n');
        this.continuing = false;
        this.stopped = true;
        this.stoppedReason = 'continue failed';
        this.notifyStoppedConditional();
    }

    protected findPausedThread(info: MINode) {
        if (info.outOfBandRecord && info.outOfBandRecord[0] && info.outOfBandRecord[0].output) {
            for (const item of info.outOfBandRecord[0].output) {
                if (item[0] === 'thread-id') {
                    this.currentThreadId = parseInt(item[1]);
                    this.stoppedThreadId = this.currentThreadId;
                    if (traceThreads) {
                        this.handleMsg('stdout', `**** Paused Thread: ${this.stoppedThreadId}\n`);
                    }
                    return;
                }
            }
        }
        if (traceThreads) {
            this.handleMsg('stdout', `**** Paused Thread: not found. Using ID ${this.stoppedThreadId}. Not good\n`);
        }
    }

    protected handleBreakpoint(info: MINode) {
        this.continuing = false;
        this.stopped = true;
        this.stoppedReason = 'breakpoint';
        this.findPausedThread(info);
        this.notifyStoppedConditional();
    }

    private notifyStoppedConditional() {
        if (!this.disableSendStoppedEvents) {
            this.notifyStopped();
        } else {
            this.stoppedEventPending = true;
        }
    }

    protected handleWatchpoint(type: string, info: MINode) {
        this.continuing = false;
        this.stopped = true;
        this.stoppedReason = (type === 'hit') ? 'data breakpoint' : 'watchpoint-scope-end';
        this.findPausedThread(info);
        this.notifyStoppedConditional();

        // console.log(info);
        if (type !== 'hit') {
            if (info.outOfBandRecord && info.outOfBandRecord[0] && info.outOfBandRecord[0].output) {
                for (const item of info.outOfBandRecord[0].output) {
                    if (item[0].endsWith('wpnum')) {
                        const id = parseInt(item[1]);
                        if (!this.dataBreakpointMap.get(id)) {
                            break;  // Not a watchpoint we set
                        }
                        const ev: DebugProtocol.BreakpointEvent = {
                            body: {
                                reason: 'removed',
                                breakpoint: {
                                    id: id,
                                    verified: false
                                }
                            },
                            type: 'event',
                            event: 'breakpoint',
                            seq: 0
                        };
                        this.dataBreakpointMap.delete(id);
                        this.sendEvent(ev);
                        break;
                    }
                }
            }
        }
    }

    protected handleBreak(info: MINode) {
        this.continuing = false;
        this.stopped = true;
        this.stoppedReason = 'step';
        this.findPausedThread(info);
        this.notifyStoppedConditional();
    }

    public sendEvent(event: DebugProtocol.Event): void {
        super.sendEvent(event);
        if (traceThreads && (event instanceof StoppedEvent || event instanceof ContinuedEvent)) {
            this.handleMsg('log', '**** Event: ' + JSON.stringify(event) + '\n');
        }
    }

    protected handlePause(info: MINode) {
        this.continuing = false;
        this.stopped = true;
        this.stoppedReason = 'user request';
        this.findPausedThread(info);
        this.notifyStoppedConditional();
    }

    protected handleThreadCreated(info: { threadId: number, threadGroupId: string }) {
        if (!this.activeThreadIds.has(info.threadId)) {
            if (traceThreads) {
                this.handleMsg('log', `**** Thread created ${info.threadId}\n`);
            }
            this.activeThreadIds.add(info.threadId);
            this.sendEvent(new ThreadEvent('started', info.threadId));
        } else {
            this.handleMsg('log', `Thread Error: GDB trying to create thread '${info.threadId}' that already exists`);
        }
    }

    protected handleThreadExited(info: { threadId: number, threadGroupId: string }) {
        if (traceThreads) {
            this.handleMsg('log', `**** Thread exited ${info.threadId}\n`);
        }
        if (this.activeThreadIds.has(info.threadId)) {
            this.activeThreadIds.delete(info.threadId);
        } else {
            this.handleMsg('log', `Thread Error: GDB trying to delete thread '${info.threadId}' that does not exist.\n`);
        }
        if (this.currentThreadId === info.threadId) {
            this.currentThreadId = 0;
        }
        if (this.stoppedThreadId === info.threadId) {
            this.stoppedThreadId = 0;
        }
        this.sendEvent(new ThreadEvent('exited', info.threadId));
    }

    protected handleThreadSelected(info: { threadId: number }) {
        if (traceThreads) {
            this.handleMsg('log', `**** Thread selected ${info.threadId}\n`);
        }
        if (!this.activeThreadIds.has(info.threadId)) {
            // We are seeing this happen. Not sure why and and can this event be relied upon?
            this.handleMsg('log', `Thread Error: GDB trying to select thread '${info.threadId}' that does not exist. No harm done\n`);
        } else {
            this.currentThreadId = info.threadId;
        }
    }

    protected handleThreadGroupExited(info: { threadGroupId: string }) {
        if (traceThreads) {
            this.handleMsg('log', `**** Thread group exited ${info.threadGroupId}\n`);
        }
        // When a thread group exits for whaever reason (especially for a re-start) cleanup
        // and notify VSCode or it will be in a bad state. This can be distinct from a quitEvent
        // A crash, hd/tcp disconnect in the gdb-server can also cause this event.
        this.currentThreadId = 0;
        for (const thId of this.activeThreadIds.values()) {
            this.sendEvent(new ThreadEvent('exited', thId));
        }
        this.activeThreadIds.clear();
        // this.sendEvent(new TerminatedEvent());
    }

    protected stopEvent(info: MINode, reason: string = 'exception') {
        if (!this.quit) {
            this.continuing = false;
            this.stopped = true;
            this.stoppedReason = reason;
            this.findPausedThread(info);
            if ((reason === 'entry') && this.args.noDebug) {
                // Do not notify the front-end if no-debug is active and it is the entry point. Or else, pass it on
            } else {
                this.notifyStoppedConditional();
            }
        }
    }

    protected quitEvent() {
        if (traceThreads) {
            this.handleMsg('log', '**** quit event\n');
        }
        if (this.server && this.server.isProcessRunning()) {
            // A gdb quit may be happening with VSCode asking us to finish or a crash or user doing something
            ServerConsoleLog('quitEvent: Killing server', this.miDebugger?.pid);
            this.server.exit();
        }
        this.quit = true;
        setTimeout(() => {
            // In case GDB quit because of normal processing, let that process finish. Wait for,\
            // a disconnect reponse to be sent before we send a TerminatedEvent();. Note that we could
            // also be here because the server crashed/quit on us before gdb-did
            ServerConsoleLog('quitEvent: sending VSCode TerminatedEvent', this.miDebugger?.pid);
            this.sendEvent(new TerminatedEvent());
        }, 10);
    }

    protected launchError(err: any) {
        this.handleMsg('stderr', 'Could not start debugger process, does the program exist in filesystem?\n');
        this.handleMsg('stderr', err.toString() + '\n');
        this.quitEvent();
    }

    // returns [threadId, frameId]
    protected static decodeReference(varRef: number): number[] {
        return [(varRef & 0xFF00) >>> 8, varRef & 0xFF];
    }

    protected static encodeReference(threadId: number, frameId: number): number {
        return ((threadId << 8) | (frameId & 0xFF)) & 0xFFFF;
    }

    protected async setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments): Promise<void> {
        try {
            let name = args.name;
            let threadId = -1;
            let frameId = -1;
            const varRef = args.variablesReference;
            const isReg = (varRef >= REG_HANDLE_START && varRef < REG_HANDLE_FINISH);
            const globOrStatic = !isReg && this.getFloatingVariable(varRef, name);
            if (isReg) {
                const varObj = await this.miDebugger.varCreate(varRef, '$' + name, '-', '*');
                name = varObj.name;
                [threadId, frameId] = GDBDebugSession.decodeReference(varRef);
            } else if (globOrStatic) {
                name = globOrStatic.name;
            } else if (varRef >= VAR_HANDLES_START) {
                const parent = this.variableHandles.get(args.variablesReference) as VariableObject;
                const fullName = parent.children[name];
                name = fullName ? fullName : `${parent.name}.${name}`;
            } else if (varRef >= STACK_HANDLES_START && varRef < STACK_HANDLES_FINISH) {
                const tryName = this.createStackVarName(name, varRef);
                if (this.variableHandlesReverse.hasOwnProperty(tryName)) {
                    name = tryName;
                }
                [threadId, frameId] = GDBDebugSession.decodeReference(varRef);
            }
            const res = await this.miDebugger.varAssign(name, args.value, threadId, frameId);
            // TODO: Need to check for errors
            response.body = {
                value: res.result('value')
            };
            this.sendResponse(response);
        }
        catch (err) {
            this.sendErrorResponse(response, 11, `Could not set variable: ${err}`);
        }
    }

    protected setFunctionBreakPointsRequest(
        response: DebugProtocol.SetFunctionBreakpointsResponse,
        args: DebugProtocol.SetFunctionBreakpointsArguments
    ): void {
        if ((args.breakpoints.length === 0) && (this.functionBreakpoints.length === 0)) {
            this.sendResponse(response);
            return;
        }
        const createBreakpoints = async (shouldContinue) => {
            this.disableSendStoppedEvents = false;
            await this.miDebugger.removeBreakpoints(this.functionBreakpoints);
            this.functionBreakpoints = [];

            const all = new Array<Promise<OurSourceBreakpoint | MIError>>();
            args.breakpoints.forEach((brk) => {
                const arg: OurSourceBreakpoint = {
                    ...brk,
                    raw: brk.name,
                    file: undefined,
                    line: undefined
                };
                all.push(this.miDebugger.addBreakPoint(arg).catch((err: MIError) => err));
            });

            try {
                const breakpoints = await Promise.all(all);
                const finalBrks: DebugProtocol.Breakpoint[] = breakpoints.map(
                    (brkp) => {
                        if (brkp instanceof MIError) {
                            /* Failed breakpoints should be reported with
                             * verified: false, so they can be greyed out
                             * in the UI.
                             */
                            return {
                                verified: false,
                                message: brkp.message
                            };
                        }

                        this.functionBreakpoints.push(brkp.number);

                        return {
                            source: {
                                path: brkp.file,
                                name: brkp.raw
                            },
                            line: brkp.line,
                            instructionReference: brkp.address,
                            id: brkp.number,
                            verified: true
                        } as DebugProtocol.Breakpoint;
                    }
                );

                response.body = {
                    breakpoints: finalBrks
                };
                this.sendResponse(response);
            }
            catch (msg) {
                this.sendErrorResponse(response, 10, msg.toString());
            }
            if (shouldContinue) {
                this.sendContinue(true);
            }
        };

        const process = async () => {
            if (this.miDebugger.status !== 'running') {         // May not even have started just yet
                await createBreakpoints(false);
            }
            else {
                this.disableSendStoppedEvents = true;
                this.miDebugger.once('generic-stopped', () => { createBreakpoints(true); });
                this.miDebugger.sendCommand('exec-interrupt');
            }
        };

        if (this.debugReady) { process(); }
        else { this.miDebugger.once('debug-ready', process); }
    }

    protected pendingBkptResponse = false;
    protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments) {
        if ((args.breakpoints.length === 0) && (this.breakpointMap.size === 0)) {
            this.sendResponse(response);
            return;
        }
        const createBreakpoints = async (shouldContinue) => {
            const currentBreakpoints = (this.breakpointMap.get(args.source.path) || []).map((bp) => bp.number);

            try {
                this.disableSendStoppedEvents = false;
                await this.miDebugger.removeBreakpoints(currentBreakpoints);
                this.breakpointMap.set(args.source.path, []);

                const all: Array<Promise<OurSourceBreakpoint | MIError>> = [];
                const sourcepath = decodeURIComponent(args.source.path);

                if (sourcepath.startsWith('disassembly:/')) {
                    let sidx = 13;
                    if (sourcepath.startsWith('disassembly:///')) { sidx = 15; }
                    const path = sourcepath.substring(sidx, sourcepath.length - 6); // Account for protocol and extension
                    const parts = path.split(':::');
                    let func: string;
                    let file: string;

                    if (parts.length === 2) {
                        func = parts[1];
                        file = parts[0];
                    }
                    else {
                        func = parts[0];
                    }

                    const symbol: SymbolInformation = await this.disassember.getDisassemblyForFunction(func, file);

                    if (symbol) {
                        args.breakpoints.forEach((brk) => {
                            if (brk.line <= symbol.instructions.length) {
                                const line = symbol.instructions[brk.line - 1];
                                const arg: OurSourceBreakpoint = {
                                    ...brk,
                                    file: args.source.path,
                                    raw: line.address
                                };
                                all.push(this.miDebugger.addBreakPoint(arg).catch((err: MIError) => err));
                            } else {
                                all.push(
                                    Promise.resolve(
                                        new MIError(
                                            `${func} only contains ${symbol.instructions.length} instructions`,
                                            'Set breakpoint'
                                        )
                                    )
                                );
                            }
                        });
                    }
                }
                else {
                    args.breakpoints.forEach((brk) => {
                        const arg: OurSourceBreakpoint = {
                            ...brk,
                            file: args.source.path
                        };
                        all.push(this.miDebugger.addBreakPoint(arg).catch((err: MIError) => err));
                    });
                }

                const brkpoints = await Promise.all(all);

                response.body = {
                    breakpoints: brkpoints.map((bp) => {
                        if (bp instanceof MIError) {
                            /* Failed breakpoints should be reported with
                             * verified: false, so they can be greyed out
                             * in the UI. The attached message will be
                             * presented as a tooltip.
                             */
                            return {
                                verified: false,
                                message: bp.message
                            } as DebugProtocol.Breakpoint;
                        }

                        return {
                            line: bp.line,
                            id: bp.number,
                            instructionReference: bp.address,
                            verified: true
                        };
                    })
                };

                this.breakpointMap.set(args.source.path, brkpoints.filter((bp) => !(bp instanceof MIError)) as OurSourceBreakpoint[]);
                this.sendResponse(response);
                this.pendingBkptResponse = false;
            }
            catch (msg) {
                this.sendErrorResponse(response, 9, msg.toString());
                this.pendingBkptResponse = false;
            }

            if (shouldContinue) {
                this.sendContinue(true);
            }
        };

        const process = async () => {
            if (this.miDebugger.status !== 'running') {         // May not even have started just yet
                await createBreakpoints(false);
            }
            else {
                this.disableSendStoppedEvents = true;
                this.miDebugger.once('generic-stopped', () => { createBreakpoints(true); });
                this.miDebugger.sendCommand('exec-interrupt');
            }
        };

        // Following will look crazy. VSCode will make this request before we have even finished
        // the last one and without any user interaction either. To reproduce the problem,
        // see https://github.com/Marus/cortex-debug/issues/525
        // It happens with duplicate breakpoints created by the user and one of them is deleted
        // VSCode will delete the first one and then delete the other one too but in a separate
        // call
        let intervalTime = 0;
        const to = setInterval(() => {
            if (!this.pendingBkptResponse) {
                clearInterval(to);
                this.pendingBkptResponse = true;
                if (this.debugReady) { process(); }
                else { this.miDebugger.once('debug-ready', process); }
            }
            intervalTime = 5;
        }, intervalTime);
    }

    protected setInstructionBreakpointsRequest(
        response: DebugProtocol.SetInstructionBreakpointsResponse,
        args: DebugProtocol.SetInstructionBreakpointsArguments, request?: DebugProtocol.Request): void {
        if ((args.breakpoints.length === 0) && (this.instrBreakpointMap.size === 0)) {
            this.sendResponse(response);
            return;
        }
        const createBreakpoints = async (shouldContinue) => {
            const currentBreakpoints = Array.from(this.instrBreakpointMap.keys());
            this.instrBreakpointMap.clear();

            try {
                this.disableSendStoppedEvents = false;
                await this.miDebugger.removeBreakpoints(currentBreakpoints);

                const all: Array<Promise<OurInstructionBreakpoint | MIError>> = [];
                args.breakpoints.forEach((brk) => {
                    const addr = parseInt(brk.instructionReference) + brk.offset || 0;
                    const bpt: OurInstructionBreakpoint = { ...brk, number: -1, address: addr };
                    all.push(this.miDebugger.addInstrBreakPoint(bpt).catch((err: MIError) => err));
                });

                const brkpoints = await Promise.all(all);

                response.body = {
                    breakpoints: brkpoints.map((bp) => {
                        if (bp instanceof MIError) {
                            return {
                                verified: false,
                                message: bp.message
                            } as DebugProtocol.Breakpoint;
                        }

                        this.instrBreakpointMap.set(bp.number, bp);
                        return {
                            id: bp.number,
                            verified: true
                        };
                    })
                };

                this.sendResponse(response);
                this.pendingBkptResponse = false;
            }
            catch (msg) {
                this.sendErrorResponse(response, 9, msg.toString());
                this.pendingBkptResponse = false;
            }

            if (shouldContinue) {
                this.sendContinue(true);
            }
        };

        const process = async () => {
            if (this.miDebugger.status !== 'running') {         // May not even have started just yet
                await createBreakpoints(false);
            }
            else {
                this.disableSendStoppedEvents = true;
                this.miDebugger.once('generic-stopped', () => { createBreakpoints(true); });
                this.miDebugger.sendCommand('exec-interrupt');
            }
        };

        if (this.debugReady) { process(); }
        else { this.miDebugger.once('debug-ready', process); }
    }

    protected isVarRefGlobalOrStatic(varRef: number, id: any) {
        if (varRef === GLOBAL_HANDLE_ID) {
            return true;
        }
        if ((varRef >= STATIC_HANDLES_START) && (varRef <= STACK_HANDLES_FINISH)) {
            return true;
        }
        if (id instanceof VariableObject) {
            const pRef = (id as VariableObject).parent;
            const parent = this.variableHandles.get(pRef);
            return this.isVarRefGlobalOrStatic(pRef, parent);
        }
        if (id instanceof ExtendedVariable) {
            return false;
        }

        console.log(`isVarRefGlobalOrStatic: What is this? varRef = ${varRef}`);
        console.log(id);
        return false;
    }

    protected dataBreakpointInfoRequest(response: DebugProtocol.DataBreakpointInfoResponse, args: DebugProtocol.DataBreakpointInfoArguments): void {
        response.body = {
            dataId: null,
            description: 'cannot break on data access',
            accessTypes: undefined,
            canPersist: false
        };

        const ref = args.variablesReference;
        if ((ref !== undefined) && args.name && !((ref >= REG_HANDLE_START) && (ref <= REG_HANDLE_FINISH))) {
            const id = this.variableHandles.get(args.variablesReference);
            response.body.canPersist = this.isVarRefGlobalOrStatic(args.variablesReference, id);
            const parentObj = (id as VariableObject);
            const fullName = (parentObj ? (parentObj.fullExp || parentObj.exp) + '.' : '') + args.name;
            response.body.dataId = fullName;
            response.body.description = fullName;       // What is displayed in the Breakpoints window
            response.body.accessTypes = ['read', 'write', 'readWrite'];
        }

        this.sendResponse(response);
    }

    protected setDataBreakpointsRequest(response: DebugProtocol.SetDataBreakpointsResponse, args: DebugProtocol.SetDataBreakpointsArguments): void {
        if ((args.breakpoints.length === 0) && (this.dataBreakpointMap.size === 0)) {
            this.sendResponse(response);
            return;
        }
        const createBreakpoints = async (shouldContinue) => {
            const currentBreakpoints = Array.from(this.dataBreakpointMap.keys());
            this.dataBreakpointMap.clear();

            try {
                this.disableSendStoppedEvents = false;
                await this.miDebugger.removeBreakpoints(currentBreakpoints);

                const all: Array<Promise<OurDataBreakpoint | MIError>> = [];

                args.breakpoints.forEach((brk) => {
                    const bkp: OurDataBreakpoint = { ...brk };
                    all.push(this.miDebugger.addDataBreakPoint(bkp).catch((err: MIError) => err));
                });

                const brkpoints = await Promise.all(all);

                response.body = {
                    breakpoints: brkpoints.map((bp) => {
                        if (bp instanceof MIError) {
                            /* Failed breakpoints should be reported with
                             * verified: false, so they can be greyed out
                             * in the UI. The attached message will be
                             * presented as a tooltip.
                             */
                            return {
                                verified: false,
                                message: bp.message
                            } as DebugProtocol.Breakpoint;
                        }

                        this.dataBreakpointMap.set(bp.number, bp);
                        return {
                            id: bp.number,
                            verified: true
                        };
                    })
                };

                this.sendResponse(response);
            }
            catch (msg) {
                this.sendErrorResponse(response, 9, msg.toString());
            }

            if (shouldContinue) {
                this.sendContinue(true);
            }
        };

        const process = async () => {
            if (this.miDebugger.status !== 'running') {         // May not even have started just yet
                await createBreakpoints(false);
            }
            else {
                this.disableSendStoppedEvents = true;
                this.miDebugger.once('generic-stopped', () => { createBreakpoints(true); });
                this.miDebugger.sendCommand('exec-interrupt');
            }
        };

        if (this.debugReady) { process(); }
        else { this.miDebugger.once('debug-ready', process); }
    }

    protected async threadsRequest(response: DebugProtocol.ThreadsResponse): Promise<void> {
        if (!this.isMIStatusStopped() || !this.stopped || this.disableSendStoppedEvents || this.continuing) {
            response.body = { threads: [] };
            this.sendResponse(response);
            return Promise.resolve();
        }
        try {
            const threadIdNode = await this.miDebugger.sendCommand('thread-list-ids');
            const threadIds: number[] = threadIdNode.result('thread-ids').map((ti) => parseInt(ti[1]));
            const currentThread = threadIdNode.result('current-thread-id');

            if (!threadIds || (threadIds.length === 0)) {
                // Yes, this does happen at the very beginning of an RTOS session
                response.body = { threads: [] };
                this.sendResponse(response);
                return Promise.resolve();
            }

            for (const thId of threadIds) {
                // Make sure VSCode knows about all the threads. GDB may still be in the process of notifying
                // new threads while we already have a thread-list. Technically, this should never happen
                if (!this.activeThreadIds.has(thId)) {
                    this.handleThreadCreated({ threadId: thId, threadGroupId: 'i1' });
                }
            }

            if (!currentThread) {
                this.currentThreadId = threadIds.findIndex((x) => {
                    return x === this.stoppedThreadId;
                }) >= 0 ? this.stoppedThreadId : threadIds[0];
                if (traceThreads) {
                    this.handleMsg('log', `**** thread-list-ids: no current thread, setting to ${this.currentThreadId}\n`);
                }
                if (threadIds.length > 1) {    // No confusion when there is only one thread
                    // thread-select doesn't actually work on most embedded gdb-servers. But we will at least
                    // be in sync with gdb for querying local variables, etc. Things may rectify themselves like
                    // they do with OpenOCD bit later. In general, this only happens with buggy gdb-servers
                    await this.miDebugger.sendCommand(`thread-select ${this.currentThreadId}`);
                }
            }
            else {
                this.currentThreadId = parseInt(currentThread);
                if (traceThreads) {
                    this.handleMsg('log', `**** thread-list-ids: current thread = ${this.currentThreadId}\n`);
                }
            }

            // We have to send this event or else VSCode may have the last/wrong/no thread selected
            // because when we stopped, we may not have had a valid thread (gdb-server issues). Needed even
            // where there is is just one thread to make sure call-stack window has proper focus and
            // selection for the debug buttons to have proper state. Esp. matters on restart with runToMain = false
            // and on an attach
            if (this.stoppedEventPending || (this.currentThreadId !== this.stoppedThreadId)) {
                this.stoppedEventPending = false;
                this.stoppedThreadId = this.currentThreadId;
                this.notifyStopped();
            }

            const nodes = await Promise.all(threadIds.map((id) => this.miDebugger.sendCommand(`thread-info ${id}`)));

            const threads = nodes.map((node: MINode) => {
                let th = node.result('threads');
                if (th.length === 1) {
                    th = th[0];
                    const id = parseInt(MINode.valueOf(th, 'id'));
                    const tid = MINode.valueOf(th, 'target-id');
                    const details = MINode.valueOf(th, 'details');
                    let name = MINode.valueOf(th, 'name');

                    if (name && details && (name !== details)) {
                        // Try to emulate how gdb shows thread info. Nice for servers like pyocd.
                        name += ` (${details})`;
                    } else {
                        name = name || details || tid;
                    }

                    return new Thread(id, name);
                }
                else {
                    return null;
                }
            }).filter((t) => t !== null);

            response.body = {
                threads: threads
            };
            this.sendResponse(response);
        }
        catch (e) {
            if (this.isMIStatusStopped()) {     // Between the time we asked for a info, a continue occured
                this.sendErrorResponse(response, 1, `Unable to get thread information: ${e}`);
            }
        }
    }

    protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): Promise<void> {
        if (!this.isMIStatusStopped() || !this.stopped || this.disableSendStoppedEvents || this.continuing) {
            response.body = {
                stackFrames: [],
                totalFrames: 0
            };
            this.sendResponse(response);
            return Promise.resolve();
        }
        try {
            const maxDepth = await this.miDebugger.getStackDepth(args.threadId);
            const highFrame = Math.min(maxDepth, args.startFrame + args.levels) - 1;
            const stack = await this.miDebugger.getStack(args.threadId, args.startFrame, highFrame);
            const ret: StackFrame[] = [];
            for (const element of stack) {
                const stackId = GDBDebugSession.encodeReference(args.threadId, element.level);
                const file = element.file;
                let disassemble = this.forceDisassembly || !file;
                if (!disassemble) { disassemble = !this.checkFileExists(file); }
                if (!disassemble && this.activeEditorPath && this.activeEditorPath.startsWith('disassembly:///')) {
                    const symbolInfo = this.symbolTable.getFunctionByName(element.function, element.fileName);
                    let url: string;
                    if (symbolInfo) {
                        if (symbolInfo.file && (symbolInfo.scope !== SymbolScope.Global)) {
                            url = `disassembly:///${symbolInfo.file}:::${symbolInfo.name}.cdasm`;
                        }
                        else {
                            url = `disassembly:///${symbolInfo.name}.cdasm`;
                        }
                        if (url === this.activeEditorPath) { disassemble = true; }
                    }
                }

                try {
                    if (disassemble) {
                        const symbolInfo = await this.disassember.getDisassemblyForFunction(element.function, element.fileName);
                        let line = -1;
                        symbolInfo.instructions.forEach((inst, idx) => {
                            if (inst.address === element.address) { line = idx + 1; }
                        });

                        if (line !== -1) {
                            let fname: string;
                            if (symbolInfo.file && (symbolInfo.scope !== SymbolScope.Global)) {
                                fname = `${symbolInfo.file}:::${symbolInfo.name}.cdasm`;
                            }
                            else {
                                fname = `${symbolInfo.name}.cdasm`;
                            }

                            const url = 'disassembly:///' + fname;
                            ret.push(new StackFrame(stackId, `${element.function}@${element.address}`, new Source(fname, url), line, 0));
                        }
                        else {
                            ret.push(new StackFrame(stackId, element.function + '@' + element.address, null, element.line, 0));
                        }
                    }
                    else {
                        const sf = new StackFrame(stackId, element.function + '@' + element.address, new Source(element.fileName, file), element.line, 0);
                        sf.instructionPointerReference = element.address;
                        ret.push(sf);
                    }
                }
                catch (e) {
                    const sf = new StackFrame(stackId, element.function + '@' + element.address, null, element.line, 0);
                    sf.instructionPointerReference = element.address;
                    ret.push(sf);
                }
            }

            response.body = {
                stackFrames: ret,
                totalFrames: maxDepth
            };
            this.sendResponse(response);
        }
        catch (err) {
            if (this.isMIStatusStopped()) {     // Between the time we asked for a info, a continue occured
                this.sendErrorResponse(response, 12, `Failed to get Stack Trace: ${err.toString()}`);
            }
        }
    }

    protected configurationDoneRequest(
        response: DebugProtocol.ConfigurationDoneResponse,
        args: DebugProtocol.ConfigurationDoneArguments
    ): void {
        this.sendResponse(response);
        this.configDone = true;
        this.onConfigDone.emit('done');
    }

    protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
        const scopes = new Array<Scope>();
        scopes.push(new Scope('Local', parseInt(args.frameId as any), false));
        scopes.push(new Scope('Global', GLOBAL_HANDLE_ID, false));

        const staticId = STATIC_HANDLES_START + parseInt(args.frameId as any);
        scopes.push(new Scope('Static', staticId, false));
        this.floatingVariableMap[staticId] = {};         // Clear any previously stored stuff for this scope

        scopes.push(new Scope('Registers', REG_HANDLE_START + parseInt(args.frameId as any)));

        response.body = {
            scopes: scopes
        };
        this.sendResponse(response);
    }

    private registerMap = new Map<string, number>();
    private registerMapReverse = new Map<number, string>();
    private async registersRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): Promise<void> {
        const registers: DebugProtocol.Variable[] = [];
        try {
            if (this.registerMap.size === 0) {
                const node = await this.miDebugger.sendCommand('data-list-register-names');
                if (node.resultRecords.resultClass === 'done') {
                    node.resultRecords.results.forEach((rr) => {
                        if (rr[0] === 'register-names') {
                            const registerNames = rr[1];
                            let idx = 0;
                            for (const reg of registerNames) {
                                if (reg !== '') {
                                    this.registerMap.set(reg, idx);
                                    this.registerMapReverse.set(idx, reg);
                                }
                                idx++;
                            }
                        }
                    });
                }
            }
        }
        catch (error) {
            this.sendErrorResponse(response, 116, `Unable to read register list: ${error.toString()}`);
            this.sendEvent(new TelemetryEvent('Error', 'Reading Register List', ''));
            return;
        }

        try {
            const [threadId, frameId] = GDBDebugSession.decodeReference(args.variablesReference);
            const fmt = this.args.variableUseNaturalFormat ? 'N' : 'x';
            // --thread --frame does not work properly
            this.miDebugger.sendCommand(`thread-select ${threadId}`);
            this.miDebugger.sendCommand(`stack-select-frame ${frameId}`);
            const node = await this.miDebugger.sendCommand(`data-list-register-values ${fmt}`);
            if (node.resultRecords.resultClass === 'done') {
                const rv = node.resultRecords.results[0][1];
                for (const n of rv) {
                    const id = parseInt(n[0][1]);
                    const reg = this.registerMapReverse.get(id);
                    if (reg) {
                        const val = n[1][1];
                        const res: DebugProtocol.Variable = {
                            name: reg,
                            evaluateName: '$' + reg,
                            value: val,
                            variablesReference: 0
                        };
                        if (!/^[sd][0-9]/i.test(reg) && ((/^0x[0-9a-f]+/i.test(val)) || /^[-]?[0-9]+/.test(val))) {
                            // No hints for floating point stuff
                            const intval = parseInt(val.toLowerCase());
                            res.type = `Register: $${reg} Thread#${threadId}, Frame#${frameId}\n` + toStringDecHexOctBin(intval);
                            const field = (nm: string, offset: number, width: number): string => {
                                const v = extractBits(intval, offset, width);
                                return `\n    ${nm}: ${v.toString()}`;
                            };
                            // TODO: someday, fake these registers as a struct to VSCode
                            if (reg.toLowerCase() === 'xpsr') {
                                res.type += field('Negative Flag (N)', 31, 1);
                                res.type += field('Zero Flag (Z)', 30, 1);
                                res.type += field('Carry or borrow flag (C)', 29, 1);
                                res.type += field('Overflow Flag (V)', 28, 1);
                                res.type += field('Saturation Flag (Q)', 27, 1);
                                res.type += field('GE', 16, 4);
                                res.type += field('Interrupt Number', 0, 8);
                                res.type += field('ICI/IT', 25, 2);
                                res.type += field('ICI/IT', 10, 6);
                                res.type += field('Thumb State (T)', 24, 1);
                            } else if (reg.toLowerCase() === 'control') {
                                res.type += field('FPCA', 2, 1);
                                res.type += field('SPSEL', 1, 1);
                                res.type += field('nPRIV', 0, 1);
                            }
                        }
                        registers.push(res);
                    }
                }
            } else {
                throw new Error('Unable to parse response for reg. values');
            }
        }
        catch (error) {
            this.sendErrorResponse(response, 115, `Unable to read registers: ${error.toString()}`);
            this.sendEvent(new TelemetryEvent('Error', 'Reading Registers', ''));
            return;
        }
        response.body = { variables: registers };
        this.sendResponse(response);
    }

    private async globalVariablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): Promise<void> {
        const symbolInfo: SymbolInformation[] = this.symbolTable.getGlobalVariables();

        const globals: DebugProtocol.Variable[] = [];
        try {
            for (const symbol of symbolInfo) {
                const varObjName = `global_var_${symbol.name}`;
                let varObj: VariableObject;
                try {
                    const changes = await this.miDebugger.varUpdate(varObjName, -1, -1);
                    const changelist = changes.result('changelist');
                    changelist.forEach((change) => {
                        const name = MINode.valueOf(change, 'name');
                        const vId = this.variableHandlesReverse[name];
                        const v = this.variableHandles.get(vId) as any;
                        v.applyChanges(change);
                    });
                    const varId = this.variableHandlesReverse[varObjName];
                    varObj = this.variableHandles.get(varId) as any;
                }
                catch (err) {
                    try {
                        if (err instanceof MIError && err.message === 'Variable object not found') {
                            varObj = await this.miDebugger.varCreate(args.variablesReference, symbol.name, varObjName);
                            const varId = this.findOrCreateVariable(varObj);
                            varObj.exp = symbol.name;
                            varObj.id = varId;
                        } else {
                            throw err;
                        }
                    }
                    catch (err) {
                        if (this.args.showDevDebugOutput) {
                            this.handleMsg('stderr', `Could not create global variable ${symbol.name}\n`);
                            this.handleMsg('stderr', `Error: ${err}\n`);
                        }
                        varObj = null;
                    }
                }

                if (varObj) {
                    this.putFloatingVariable(args.variablesReference, symbol.name, varObj);
                    globals.push(varObj.toProtocolVariable());
                }
            }

            response.body = { variables: globals };
            this.sendResponse(response);
        }
        catch (err) {
            this.sendErrorResponse(response, 1, `Could not get global variable information: ${err}`);
        }
    }

    private createStaticVarName(fHash: string, name: string): string {
        const varObjName = `static_var_${name}_${fHash}`;
        return varObjName;
    }

    /*
    // floatingVariableMap is meant for things that are not relevant to the current thread/frame.
    // It is organized by ths scope reference and then a map is held for each simple name.
    // Technically, we can put even non global/static variable here, but cleanup can be an issue.
    //
    // See also scopesRequest().
    //
    // Note that this becomes important in implementing set-variable where not much info is available
    */
    private floatingVariableMap: { [scopeId: number]: { [name: string]: VariableObject } } = {};

    private putFloatingVariable(scopeId: number, name: string, varObj: VariableObject): void {
        const scopeMap = this.floatingVariableMap[scopeId] || {};
        scopeMap[name] = varObj;
        this.floatingVariableMap[scopeId] = scopeMap;
    }

    private getFloatingVariable(scopeId: number, name: string): VariableObject {
        const scopeMap = this.floatingVariableMap[scopeId];
        const ret = scopeMap ? scopeMap[name] : null;
        return ret;
    }

    private async staticVariablesRequest(
        threadId: number,
        frameId: number,
        response: DebugProtocol.VariablesResponse,
        args: DebugProtocol.VariablesArguments
    ): Promise<void> {
        const statics: DebugProtocol.Variable[] = [];

        try {
            const frame = await this.miDebugger.getFrame(threadId, frameId);
            let file = frame.file; // Prefer full path name first
            let staticSymbols = this.symbolTable.getStaticVariables(file);
            if (!staticSymbols || (staticSymbols.length === 0)) {
                file = frame.fileName;
                staticSymbols = this.symbolTable.getStaticVariables(file);
            }

            const hasher = crypto.createHash('sha256');
            hasher.update(file);
            const fHash = hasher.digest('hex');

            for (const symbol of staticSymbols) {
                const varObjName = this.createStaticVarName(fHash, symbol.name);
                let varObj: VariableObject;
                try {
                    const changes = await this.miDebugger.varUpdate(varObjName, -1, -1);
                    const changelist = changes.result('changelist');
                    changelist.forEach((change) => {
                        const name = MINode.valueOf(change, 'name');
                        const vId = this.variableHandlesReverse[name];
                        const v = this.variableHandles.get(vId) as any;
                        v.applyChanges(change);
                    });
                    const varId = this.variableHandlesReverse[varObjName];
                    varObj = this.variableHandles.get(varId) as any;
                }
                catch (err) {
                    try {
                        // Not all static variables found via objdump can be found with gdb. Happens
                        // with function/block scoped static variables (objdump uses one name and gdb uses another)
                        // Try to report what we can. Others show up under the Locals section hopefully.
                        if (err instanceof MIError && err.message === 'Variable object not found') {
                            varObj = await this.miDebugger.varCreate(args.variablesReference, symbol.name, varObjName);
                            const varId = this.findOrCreateVariable(varObj);
                            varObj.exp = symbol.name;
                            varObj.id = varId;
                        } else {
                            throw err;
                        }
                    }
                    catch (err) {
                        if (this.args.showDevDebugOutput) {
                            this.handleMsg('stderr', `Could not create static variable ${file}:${symbol.name}\n`);
                            this.handleMsg('stderr', `Error: ${err}\n`);
                        }
                        varObj = null;
                    }
                }

                if (varObj) {
                    this.putFloatingVariable(args.variablesReference, symbol.name, varObj);
                    statics.push(varObj.toProtocolVariable());
                }
            }

            response.body = { variables: statics };
            this.sendResponse(response);
        }
        catch (err) {
            this.sendErrorResponse(response, 1, `Could not get static variable information: ${err}`);
        }
    }

    private createVariable(arg, options?): number {
        if (options) {
            return this.variableHandles.create(new ExtendedVariable(arg, options));
        }
        else {
            return this.variableHandles.create(arg);
        }
    }

    private findOrCreateVariable(varObj: VariableObject): number {
        let id: number;
        if (this.variableHandlesReverse.hasOwnProperty(varObj.name)) {
            id = this.variableHandlesReverse[varObj.name];
        }
        else {
            id = this.createVariable(varObj);
            this.variableHandlesReverse[varObj.name] = id;
        }
        return varObj.isCompound() ? id : 0;
    }

    protected createStackVarName(name: string, varRef: number) {
        return `var_${name}_${varRef}`;
    }

    private async stackVariablesRequest(
        response: DebugProtocol.VariablesResponse,
        args: DebugProtocol.VariablesArguments
    ): Promise<void> {
        if (!this.isMIStatusStopped() || !this.stopped || this.disableSendStoppedEvents || this.continuing) {
            response.body = { variables: [] };
            this.sendResponse(response);
            return Promise.resolve();
        }
        const [threadId, frameId] = GDBDebugSession.decodeReference(args.variablesReference);
        const variables: DebugProtocol.Variable[] = [];
        let stack: Variable[];
        try {
            stack = await this.miDebugger.getStackVariables(threadId, frameId);
            for (const variable of stack) {
                try {
                    const varObjName = this.createStackVarName(variable.name, args.variablesReference);
                    let varObj: VariableObject;
                    try {
                        const changes = await this.miDebugger.varUpdate(varObjName, threadId, frameId);
                        const changelist = changes.result('changelist');
                        changelist.forEach((change) => {
                            const name = MINode.valueOf(change, 'name');
                            const vId = this.variableHandlesReverse[name];
                            const v = this.variableHandles.get(vId) as any;
                            v.applyChanges(change);
                        });
                        const varId = this.variableHandlesReverse[varObjName];
                        varObj = this.variableHandles.get(varId) as any;
                    }
                    catch (err) {
                        if (err instanceof MIError && err.message === 'Variable object not found') {
                            // Create variable in current frame/thread context. Matters when we have to set the variable */
                            varObj = await this.miDebugger.varCreate(args.variablesReference, variable.name, varObjName, '*');
                            const varId = this.findOrCreateVariable(varObj);
                            varObj.exp = variable.name;
                            varObj.id = varId;
                        }
                        else {
                            throw err;
                        }
                    }
                    variables.push(varObj.toProtocolVariable());
                }
                catch (err) {
                    variables.push({
                        name: variable.name,
                        value: `<${err}>`,
                        variablesReference: 0
                    });
                }
            }
            response.body = {
                variables: variables
            };
            this.sendResponse(response);
        }
        catch (err) {
            if (this.isMIStatusStopped()) {     // Between the time we asked for a info, a continue occured
                this.sendErrorResponse(response, 1, `Could not get stack variables: ${err}`);
            }
        }
    }

    private async variableMembersRequest(id: string, response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): Promise<void> {
        // Variable members
        let variable;
        try {
            variable = await this.miDebugger.evalExpression(JSON.stringify(id), -1, -1);
            try {
                let expanded = expandValue(this.createVariable.bind(this), variable.result('value'), id, variable);
                if (!expanded) {
                    this.sendErrorResponse(response, 2, 'Could not expand variable');
                }
                else {
                    if (typeof expanded[0] === 'string') {
                        expanded = [
                            {
                                name: '<value>',
                                value: prettyStringArray(expanded),
                                variablesReference: 0
                            }
                        ];
                    }
                    response.body = {
                        variables: expanded
                    };
                    this.sendResponse(response);
                }
            }
            catch (e) {
                this.sendErrorResponse(response, 2, `Could not expand variable: ${e}`);
            }
        }
        catch (err) {
            this.sendErrorResponse(response, 1, `Could not expand variable: ${err}`);
        }
    }

    protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): Promise<void> {
        if (!this.isMIStatusStopped() || !this.stopped || this.disableSendStoppedEvents || this.continuing) {
            response.body = { variables: [] };
            this.sendResponse(response);
            return Promise.resolve();
        }
        let id: number | string | VariableObject | ExtendedVariable;

        /*
        // How to deal with multiple anonymous unions/structs in the same scope. gdb uses the same display name for
        // all of them. VSCode requires that all children have unique display names. So, we make them unique. The next
        // issue is should we use the programming model which essentially flattens the union/struct or the natural one.
        // We have three objectives we have to satisfy
        //
        // 1. Does it display correctly?
        // 2. Can I do 'Add to Watch' or 'Copy as Expression' in the Variables Window?
        // 3. Can I set a value on a field?
        //
        // We meet all three objectives, whether we flatten or not. I believe the natural model is better
        // because it is closely aligned with the source code. Visual Studio and Eclipse use the flattened model.
        // So, we have a config option to let the user decide. Not many people uae multiple anonymous stuff but
        // Zephyr OS does and since it is legal C, we have to try our best to support it.
        //
        // Note: VSCode has a bug where if a union member is modified by the user, it does not refresh the Variables window
        // but it will re-evaluate everything in the Watch window. Basically, it has no concept of a union and there is no
        // way I know of to force a refresh
        */
        if (args.variablesReference === GLOBAL_HANDLE_ID) {
            return this.globalVariablesRequest(response, args);
        } else if (args.variablesReference >= STATIC_HANDLES_START && args.variablesReference <= STATIC_HANDLES_FINISH) {
            const [threadId, frameId] = GDBDebugSession.decodeReference(args.variablesReference);
            return this.staticVariablesRequest(threadId, frameId, response, args);
        } else if (args.variablesReference >= STACK_HANDLES_START && args.variablesReference < STACK_HANDLES_FINISH) {
            return this.stackVariablesRequest(response, args);
        } else if (args.variablesReference >= REG_HANDLE_START && args.variablesReference < REG_HANDLE_FINISH) {
            return this.registersRequest(response, args);
        } else {
            id = this.variableHandles.get(args.variablesReference);

            if (typeof id === 'string') {
                return this.variableMembersRequest(id, response, args);
            }
            else if (typeof id === 'object') {
                if (id instanceof VariableObject) {
                    const pvar = id as VariableObject;

                    // Variable members
                    let children: VariableObject[];
                    const childMap: { [name: string]: number } = {};
                    try {
                        children = await this.miDebugger.varListChildren(args.variablesReference, id.name, this.args.flattenAnonymous);
                        const vars = children.map((child) => {
                            const varId = this.findOrCreateVariable(child);
                            child.id = varId;
                            if (/^\d+$/.test(child.exp)) {
                                child.fullExp = `${pvar.fullExp || pvar.exp}[${child.exp}]`;
                            }
                            else {
                                let suffix = '.' + child.exp;                   // A normal suffix
                                if (child.exp.startsWith('<anonymous')) {       // We can have duplicates!!
                                    const prev = childMap[child.exp];
                                    if (prev) {
                                        childMap[child.exp] = prev + 1;
                                        child.exp += '#' + prev.toString(10);
                                    }
                                    childMap[child.exp] = 1;
                                    suffix = '';    // Anonymous ones don't have a suffix. Have to use parent name
                                } else {
                                    // The full-name is not always derivable from the parent and child info. Esp. children
                                    // of anonymous stuff. Might as well store all of them or set-value will not work.
                                    pvar.children[child.exp] = child.name;
                                }
                                child.fullExp = `${pvar.fullExp || pvar.exp}${suffix}`;
                            }
                            return child.toProtocolVariable();
                        });

                        response.body = {
                            variables: vars
                        };
                        this.sendResponse(response);
                    }
                    catch (err) {
                        this.sendErrorResponse(response, 1, `Could not expand variable: ${err}`);
                    }
                }
                else if (id instanceof ExtendedVariable) {
                    const variables: DebugProtocol.Variable[] = [];

                    const varReq = id;
                    if (varReq.options.arg) {
                        const strArr = [];
                        let argsPart = true;
                        let arrIndex = 0;
                        const submit = () => {
                            response.body = {
                                variables: strArr
                            };
                            this.sendResponse(response);
                        };
                        const addOne = async () => {
                            const variable = await this.miDebugger.evalExpression(JSON.stringify(`${varReq.name}+${arrIndex})`), -1, -1);
                            try {
                                const expanded = expandValue(this.createVariable.bind(this), variable.result('value'), varReq.name, variable);
                                if (!expanded) {
                                    this.sendErrorResponse(response, 15, 'Could not expand variable');
                                }
                                else {
                                    if (typeof expanded === 'string') {
                                        if (expanded === '<nullptr>') {
                                            if (argsPart) { argsPart = false; }
                                            else { return submit(); }
                                        }
                                        else if (expanded[0] !== '"') {
                                            strArr.push({
                                                name: '[err]',
                                                value: expanded,
                                                variablesReference: 0
                                            });
                                            return submit();
                                        }
                                        strArr.push({
                                            name: `[${(arrIndex++)}]`,
                                            value: expanded,
                                            variablesReference: 0
                                        });
                                        addOne();
                                    }
                                    else {
                                        strArr.push({
                                            name: '[err]',
                                            value: expanded,
                                            variablesReference: 0
                                        });
                                        submit();
                                    }
                                }
                            }
                            catch (e) {
                                this.sendErrorResponse(response, 14, `Could not expand variable: ${e}`);
                            }
                        };
                        addOne();
                    }
                    else {
                        this.sendErrorResponse(response, 13, `Unimplemented variable request options: ${JSON.stringify(varReq.options)}`);
                    }
                }
                else {
                    response.body = {
                        variables: id
                    };
                    this.sendResponse(response);
                }
            }
            else {
                response.body = {
                    variables: []
                };
                this.sendResponse(response);
            }
        }
    }

    protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments): void {
        this.miDebugger.interrupt().then((done) => {
            this.sendResponse(response);
        }, (msg) => {
            this.sendErrorResponse(response, 3, `Could not pause: ${msg}`);
        });
    }

    protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
        this.miDebugger.continue(args.threadId).then((done) => {
            response.body = { allThreadsContinued: true };
            this.sendResponse(response);
        }, (msg) => {
            this.sendErrorResponse(response, 2, `Could not continue: ${msg}`);
        });
    }

    protected async stepInRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): Promise<void> {
        try {
            let assemblyMode = args.granularity === 'instruction';
            if (!assemblyMode) {
                // Following will be depracated
                assemblyMode = this.forceDisassembly;
                if (!assemblyMode) {
                    const frame = await this.miDebugger.getFrame(args.threadId, 0);
                    assemblyMode = !this.checkFileExists(frame.file);

                    if (this.activeEditorPath && this.activeEditorPath.startsWith('disassembly:///')) {
                        const symbolInfo = this.symbolTable.getFunctionByName(frame.function, frame.fileName);
                        if (symbolInfo) {
                            let url: string;
                            if (symbolInfo.file && (symbolInfo.scope !== SymbolScope.Global)) {
                                url = `disassembly:///${symbolInfo.file}:::${symbolInfo.name}.cdasm`;
                            }
                            else {
                                url = `disassembly:///${symbolInfo.name}.cdasm`;
                            }
                            if (url === this.activeEditorPath) { assemblyMode = true; }
                        }
                    }
                }
            }

            const done = await this.miDebugger.step(args.threadId, assemblyMode);
            this.sendResponse(response);
        }
        catch (msg) {
            this.sendErrorResponse(response, 6, `Could not step over: ${msg}`);
        }
    }

    protected stepOutRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
        this.miDebugger.stepOut(args.threadId).then((done) => {
            this.sendResponse(response);
        }, (msg) => {
            this.sendErrorResponse(response, 5, `Could not step out: ${msg}`);
        });
    }

    protected async nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): Promise<void> {
        try {
            let assemblyMode = args.granularity === 'instruction';
            if (!assemblyMode) {
                // Following will be depracated
                assemblyMode = this.forceDisassembly;
                if (!assemblyMode) {
                    const frame = await this.miDebugger.getFrame(args.threadId, 0);
                    assemblyMode = !this.checkFileExists(frame.file);

                    if (this.activeEditorPath && this.activeEditorPath.startsWith('disassembly:///')) {
                        const symbolInfo = this.symbolTable.getFunctionByName(frame.function, frame.fileName);
                        if (symbolInfo) {
                            let url: string;
                            if (symbolInfo.file && (symbolInfo.scope !== SymbolScope.Global)) {
                                url = `disassembly:///${symbolInfo.file}:::${symbolInfo.name}.cdasm`;
                            }
                            else {
                                url = `disassembly:///${symbolInfo.name}.cdasm`;
                            }
                            if (url === this.activeEditorPath) { assemblyMode = true; }
                        }
                    }
                }
            }

            const done = await this.miDebugger.next(args.threadId, assemblyMode);
            this.sendResponse(response);
        }
        catch (msg) {
            this.sendErrorResponse(response, 6, `Could not step over: ${msg}`);
        }
    }

    protected checkFileExists(name: string): boolean {
        if (!name) {
            return false;
        }

        if (this.fileExistsCache.has(name)) { // Check cache
            return this.fileExistsCache.get(name);
        }

        const ret = fs.existsSync(name);
        this.fileExistsCache.set(name, ret);
        return ret;
    }

    protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): Promise<void> {
        const createVariable = (arg, options?) => {
            if (options) {
                return this.variableHandles.create(new ExtendedVariable(arg, options));
            }
            else {
                return this.variableHandles.create(arg);
            }
        };

        const findOrCreateVariable = (varObj: VariableObject): number => {
            let id: number;
            if (this.variableHandlesReverse.hasOwnProperty(varObj.name)) {
                id = this.variableHandlesReverse[varObj.name];
            }
            else {
                id = createVariable(varObj);
                this.variableHandlesReverse[varObj.name] = id;
            }
            return varObj.isCompound() ? id : 0;
        };

        // Spec says if 'frameId' is specified, evaluate in the scope specified or in the global scope. Well,
        // we don't have a way to specify global scope ... use current thread then.
        let threadId = this.currentThreadId;
        let frameId = 0;
        if (args.frameId) {     // Should always be valid
            [threadId, frameId] = GDBDebugSession.decodeReference(args.frameId);
            if (traceThreads) {
                this.handleMsg('log', `**** evaluateRequest: ${args.context} '${args.expression}' in thread#${threadId} frame#${frameId}\n`);
            }
        } else {
            // In practice, never seen this unless it comes from a custom request
            this.handleMsg('log', `Thread Warning: ${args.context}: eval. expression '${args.expression}' with no thread context. Using default\n`);
        }

        if (args.context === 'watch') {
            try {
                const exp = args.expression;
                const hasher = crypto.createHash('sha256');
                hasher.update(exp);
                const watchName = hasher.digest('hex');
                const varObjName = `watch_${watchName}`;
                let varObj: VariableObject;
                try {
                    const changes = await this.miDebugger.varUpdate(varObjName, threadId, frameId);
                    const changelist = changes.result('changelist');
                    changelist.forEach((change) => {
                        const name = MINode.valueOf(change, 'name');
                        const vId = this.variableHandlesReverse[name];
                        const v = this.variableHandles.get(vId) as any;
                        v.applyChanges(change);
                    });
                    const varId = this.variableHandlesReverse[varObjName];
                    varObj = this.variableHandles.get(varId) as any;
                    response.body = {
                        result: varObj.value,
                        variablesReference: varObj.id
                    };
                }
                catch (err) {
                    if (err instanceof MIError && err.message === 'Variable object not found') {
                        varObj = await this.miDebugger.varCreate(0, exp, varObjName, '@');  // Create floating variable
                        const varId = findOrCreateVariable(varObj);
                        varObj.exp = exp;
                        varObj.id = varId;
                        response.body = {
                            result: varObj.value,
                            variablesReference: varObj.id
                        };
                    }
                    else {
                        throw err;
                    }
                }

                this.sendResponse(response);
            }
            catch (err) {
                response.body = {
                    result: `<${err.toString()}>`,
                    variablesReference: 0
                };
                this.sendResponse(response);
                if (this.args.showDevDebugOutput) {
                    this.handleMsg('stderr', 'watch: ' + err.toString());
                }
                // this.sendErrorResponse(response, 7, err.toString());
            }
        }
        else if (args.context === 'hover') {
            try {
                const res = await this.miDebugger.evalExpression(args.expression, threadId, frameId);
                response.body = {
                    variablesReference: 0,
                    result: res.result('value')
                };
                this.sendResponse(response);
            }
            catch (e) {
                // We get too many of these causing popus, just return a normal but empty response
                response.body = {
                    variablesReference: 0,
                    result: ''
                };
                this.sendResponse(response);
                if (this.args.showDevDebugOutput) {
                    this.handleMsg('stderr', 'hover: ' + e.toString());
                }
                // this.sendErrorResponse(response, 7, e.toString());
            }
        }
        else {
            // REPL: Set the proper thread/frame context before sending command to gdb. We don't know
            // what the command is but it needs to be run in the proper context.
            this.miDebugger.sendCommand(`thread-select ${threadId}`);
            this.miDebugger.sendCommand(`stack-select-frame ${frameId}`);
            this.miDebugger.sendUserInput(args.expression).then((output) => {
                if (typeof output === 'undefined') {
                    response.body = {
                        result: '',
                        variablesReference: 0
                    };
                }
                else {
                    response.body = {
                        result: JSON.stringify(output),
                        variablesReference: 0
                    };
                }
                this.sendResponse(response);
            }, (msg) => {
                this.sendErrorResponse(response, 8, msg.toString());
            });
        }
    }

    protected gotoTargetsRequest(response: DebugProtocol.GotoTargetsResponse, args: DebugProtocol.GotoTargetsArguments): void {
        this.miDebugger.goto(args.source.path, args.line).then((done) => {
            response.body = {
                targets: [{
                    id: 1,
                    label: args.source.name,
                    column: args.column,
                    line: args.line
                }]
            };
            this.sendResponse(response);
        }, (msg) => {
            this.sendErrorResponse(response, 16, `Could not jump to: ${msg}`);
        });
    }
}

function prettyStringArray(strings) {
    if (typeof strings === 'object') {
        if (strings.length !== undefined) {
            return strings.join(', ');
        }
        else {
            return JSON.stringify(strings);
        }
    }
    else { return strings; }
}

DebugSession.run(GDBDebugSession);
