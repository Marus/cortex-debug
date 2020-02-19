import { DebugSession, InitializedEvent, TerminatedEvent, ContinuedEvent, OutputEvent, Thread, ThreadEvent, StackFrame, Scope, Source, Handles, Event } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { MI2 } from './backend/mi2/mi2';
import { hexFormat } from './frontend/utils';
import { Breakpoint, IBackend, Variable, VariableObject, MIError } from './backend/backend';
import { TelemetryEvent, ConfigurationArguments, StoppedEvent, GDBServerController, AdapterOutputEvent, SWOConfigureEvent, DisassemblyInstruction } from './common';
import { GDBServer } from './backend/server';
import { MINode } from './backend/mi_parse';
import { expandValue, isExpandable } from './backend/gdb_expansion';
import * as os from 'os';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import * as hasbin from 'hasbin';
import * as crypto from 'crypto';

import { setTimeout } from 'timers';
import { EventEmitter } from 'events';

import { JLinkServerController } from './jlink';
import { OpenOCDServerController } from './openocd';
import { STUtilServerController } from './stutil';
import { PyOCDServerController } from './pyocd';
import { BMPServerController } from './bmp';
import { PEServerController } from './pemicro';
import { QEMUServerController } from './qemu';
import { ExternalServerController } from './external';
import { SymbolTable } from './backend/symbols';
import { SymbolInformation, SymbolScope, SymbolType } from './symbols';
import { TcpPortScanner } from './tcpportscanner';

const SERVER_TYPE_MAP = {
    jlink: JLinkServerController,
    openocd: OpenOCDServerController,
    stutil: STUtilServerController,
    pyocd: PyOCDServerController,
    pe: PEServerController,
    bmp: BMPServerController,
    qemu: QEMUServerController,
    external: ExternalServerController
};

class ExtendedVariable {
    constructor(public name, public options) {
    }
}

const GLOBAL_HANDLE_ID = 0xFE;
const STACK_HANDLES_START = 0x100;
const STACK_HANDLES_FINISH = 0xFFFF;
const STATIC_HANDLES_START = 0x010000;
const STATIC_HANDLES_FINISH = 0x01FFFF;
const VAR_HANDLES_START = 0x020000;

const COMMAND_MAP = (c) => c.startsWith('-') ? c.substring(1) : `interpreter-exec console "${c}"`;

class CustomStoppedEvent extends Event implements DebugProtocol.Event {
    public readonly body: {
        reason: string,
        threadID: number
    };
    public readonly event: string;

    constructor(reason: string, threadID: number) {
        super('custom-stop', { reason: reason, threadID: threadID });
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
    }
}

const traceThreads = false;

export class GDBDebugSession extends DebugSession {
    private server: GDBServer;
    private args: ConfigurationArguments;
    private ports: { [name: string]: number };
    private serverController: GDBServerController;
    private symbolTable: SymbolTable;

    protected variableHandles = new Handles<string | VariableObject | ExtendedVariable>(VAR_HANDLES_START);
    protected variableHandlesReverse: { [id: string]: number } = {};
    protected quit: boolean;
    protected attached: boolean;
    protected trimCWD: string;
    protected switchCWD: string;
    protected started: boolean;
    protected crashed: boolean;
    protected debugReady: boolean;
    protected miDebugger: MI2;
    protected commandServer: net.Server;
    protected forceDisassembly: boolean = false;
    protected activeEditorPath: string = null;
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

    // stoppedThreadId represents where execution stopped because of a pause, exception, step or breakpoint
    // Generally continuing execution can only work from that thread for embedded processors. It is bit
    // different from 'currentThreadId'. This is also the last thread-id used to notify VSCode about
    // the current thread so the call-stack will initially point to this thread. Maybe currentThreadId
    // can be made stricter and we can remove this variable
    private stoppedThreadId: number = 0;
    private stoppedEventPending = false;

    protected breakpointMap: Map<string, Breakpoint[]> = new Map();
    protected fileExistsCache: Map<string, boolean> = new Map();

    private currentFile: string;
    protected onConfigDone: EventEmitter = new EventEmitter();

    public constructor(debuggerLinesStartAt1: boolean, isServer: boolean = false, threadID: number = 1) {
        super(debuggerLinesStartAt1, isServer);
    }

    protected initDebugger() {
        this.miDebugger.on('launcherror', this.launchError.bind(this));
        this.miDebugger.on('quit', this.quitEvent.bind(this));
        this.miDebugger.on('exited-normally', this.quitEvent.bind(this));
        this.miDebugger.on('stopped', this.stopEvent.bind(this));
        this.miDebugger.on('msg', this.handleMsg.bind(this));
        this.miDebugger.on('breakpoint', this.handleBreakpoint.bind(this));
        this.miDebugger.on('step-end', this.handleBreak.bind(this));
        this.miDebugger.on('step-out-end', this.handleBreak.bind(this));
        this.miDebugger.on('signal-stop', this.handlePause.bind(this));
        this.miDebugger.on('running', this.handleRunning.bind(this));
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
        this.sendResponse(response);
    }

    protected launchRequest(response: DebugProtocol.LaunchResponse, args: ConfigurationArguments): void {
        this.args = this.normalizeArguments(args);
        this.symbolTable = new SymbolTable(args.toolchainPath, args.toolchainPrefix, args.executable, args.demangle);
        this.symbolTable.loadSymbols();
        this.breakpointMap = new Map();
        this.fileExistsCache = new Map();
        this.processLaunchAttachRequest(response, false);
    }

    protected attachRequest(response: DebugProtocol.AttachResponse, args: ConfigurationArguments): void {
        this.args = this.normalizeArguments(args);
        this.symbolTable = new SymbolTable(args.toolchainPath, args.toolchainPrefix, args.executable, args.demangle);
        this.symbolTable.loadSymbols();
        this.breakpointMap = new Map();
        this.fileExistsCache = new Map();
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

        return args;
    }

    private processLaunchAttachRequest(response: DebugProtocol.LaunchResponse, attach: boolean) {
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
        this.crashed = false;
        this.debugReady = false;
        this.stopped = false;
        this.activeThreadIds.clear();

        const portFinderOpts = { min: 50000, max: 52000, retrieve: this.serverController.portsNeeded.length };
        TcpPortScanner.findFreePorts(portFinderOpts, GDBServer.LOCALHOST).then((ports) => {
            this.ports = {};
            this.serverController.portsNeeded.forEach((val, idx) => {
                this.ports[val] = ports[idx];
            });

            this.serverController.setPorts(this.ports);

            const executable = this.serverController.serverExecutable();
            const args = this.serverController.serverArguments();

            let gdbExePath = os.platform() !== 'win32' ? `${this.args.toolchainPrefix}-gdb` : `${this.args.toolchainPrefix}-gdb.exe`;
            if (this.args.toolchainPath) {
                gdbExePath = path.normalize(path.join(this.args.toolchainPath, gdbExePath));
            }
            if (this.args.gdbpath) {
                gdbExePath = this.args.gdbpath;
            }

            // Check to see if gdb exists.
            if (path.isAbsolute(gdbExePath)) {
                if (fs.existsSync(gdbExePath) === false) {
                    this.sendErrorResponse(
                        response,
                        103,
                        `${this.serverController.name} GDB executable "${gdbExePath}" was not found.\n` +
                            'Please configure "cortex-debug.armToolchainPath" correctly.'
                    );
                    return;
                }
            }
            else {
                if (!hasbin.sync(gdbExePath.replace('.exe', ''))) {
                    this.sendErrorResponse(
                        response,
                        103,
                        `${this.serverController.name} GDB executable "${gdbExePath}" was not found.\n` +
                            'Please configure "cortex-debug.armToolchainPath" correctly.'
                    );
                    return;
                }
            }

            if (executable) {
                this.handleMsg('log', `Please check OUTPUT tab (Adapter Output) for output from ${executable}` + '\n');
                const dbgMsg = `Launching server: "${executable}" ` + args.map((s) => {
                    return '"' + s.replace(/"/g, '\\"') + '"';
                }).join(' ') + '\n';
                this.handleMsg('log', dbgMsg);
            }

            let initMatch = this.serverController.initMatch();
            if (this.args.overrideGDBServerStartedRegex) {
                initMatch = new RegExp(this.args.overrideGDBServerStartedRegex, 'i');
            }

            this.server = new GDBServer(this.args.cwd, executable, args, initMatch, this.ports['gdbPort']);
            this.server.on('output', this.handleAdapterOutput.bind(this));
            this.server.on('quit', () => {
                if (this.started) {
                    this.quitEvent();
                }
                else {
                    this.sendErrorResponse(
                        response,
                        103,
                        `${this.serverController.name} GDB Server Quit Unexpectedly. See Adapter Output for more details.`
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
            this.server.init().then((started) => {
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                }

                this.serverController.serverLaunchCompleted();
                
                let gdbargs = ['-q', '--interpreter=mi2'];
                gdbargs = gdbargs.concat(this.args.debuggerArgs || []);

                this.miDebugger = new MI2(gdbExePath, gdbargs);
                this.initDebugger();

                this.miDebugger.printCalls = !!this.args.showDevDebugOutput;
                this.miDebugger.debugOutput = !!this.args.showDevDebugOutput;

                const commands = [`interpreter-exec console "source ${this.args.extensionPath}/support/gdbsupport.init"`];
                if (this.args.demangle) {
                    commands.push('interpreter-exec console "set print demangle on"');
                    commands.push('interpreter-exec console "set print asm-demangle on"');
                }
                commands.push(...this.serverController.initCommands());
                
                if (attach) {
                    commands.push(...this.args.preAttachCommands.map(COMMAND_MAP));
                    const attachCommands = this.args.overrideAttachCommands != null ?
                        this.args.overrideAttachCommands.map(COMMAND_MAP) : this.serverController.attachCommands();
                    commands.push(...attachCommands);
                    commands.push(...this.args.postAttachCommands.map(COMMAND_MAP));
                    commands.push(...this.serverController.swoCommands());
                }
                else {
                    commands.push(...this.args.preLaunchCommands.map(COMMAND_MAP));
                    const launchCommands = this.args.overrideLaunchCommands != null ?
                        this.args.overrideLaunchCommands.map(COMMAND_MAP) : this.serverController.launchCommands();
                    commands.push(...launchCommands);
                    commands.push(...this.args.postLaunchCommands.map(COMMAND_MAP));
                    commands.push(...this.serverController.swoCommands());
                }
                
                this.serverController.debuggerLaunchStarted();
                this.miDebugger.once('debug-ready', () => {
                    this.debugReady = true;
                    this.attached = attach;
                });

                if (true) {
                    const dbgMsg = `Launching GDB: "${gdbExePath}" ` + gdbargs.map((s) => {
                        return '"' + s.replace(/"/g, '\\"') + '"';
                    }).join(' ') + '\n';
                    this.handleMsg('log', dbgMsg);
                }

                this.miDebugger.connect(this.args.cwd, this.args.executable, commands).then(() => {
                    this.started = true;
                    this.serverController.debuggerLaunchCompleted();
                    this.sendResponse(response);

                    const launchComplete = () => {
                        setTimeout(() => {
                            this.stopped = true;
                            this.stoppedReason = 'start';
                            this.stoppedThreadId = this.currentThreadId;
                            this.sendEvent(new StoppedEvent('start', this.currentThreadId, true));
                            this.sendEvent(new CustomStoppedEvent('start', this.currentThreadId));
                        }, 50);
                    };

                    if (this.args.runToMain) {
                        this.miDebugger.sendCommand('break-insert -t --function main').then(() => {
                            this.miDebugger.once('generic-stopped', launchComplete);
                            // To avoid race conditions between finishing configuration, we should stay
                            // in stopped mode. Or, we end up clobbering the stopped event that might come
                            // during setting of any additional breakpoints.
                            this.onConfigDone.once('done', () => {
                                this.miDebugger.sendCommand('exec-continue');
                            });
                        });
                    }
                    else {
                        launchComplete();
                        this.onConfigDone.once('done', () => {
                            this.runPostStartSessionCommands(false);
                        });
                    }
                }, (err) => {
                    this.sendErrorResponse(response, 103, `Failed to launch GDB: ${err.toString()}`);
                    this.sendEvent(new TelemetryEvent('Error', 'Launching GDB', err.toString()));
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
            });
            
        }, (err) => {
            this.sendEvent(new TelemetryEvent('Error', 'Launching Server', `Failed to find open ports: ${err.toString()}`));
            this.sendErrorResponse(response, 103, `Failed to find open ports: ${err.toString()}`);
        });
    }

    // Runs a set of commands after a quiet time and is no other gdb transactions are happening
    protected runPostStartSessionCommands(isRestart: boolean, interval: number = 10): void {
        let commands = isRestart ? this.args.postRestartSessionCommands : this.args.postStartSessionCommands;
        if (commands && (commands.length > 0)) {
            let curToken = this.miDebugger.getCurrentToken();
            commands = commands.map(COMMAND_MAP);
            // We want to let things quiet down before we run the next set of commands. Note that while
            // we are running this command sequence, some results can cause other gdb commands to be generated if
            // running state changes. Can't help it for now
            const to = setInterval(() => {
                const nxtToken = this.miDebugger.getCurrentToken();
                if (curToken === nxtToken) {
                    clearInterval(to);
                    this.miDebugger.postStart(commands);
                } else {
                    curToken = nxtToken;
                }
            }, interval);
        }
    }

    protected customRequest(command: string, response: DebugProtocol.Response, args: any): void {
        if (this.serverController.customRequest(command, response, args)) {
            this.sendResponse(response);
            return;
        }

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
                this.readMemoryRequestCustom(response, args['address'], args['length']);
                break;
            case 'write-memory':
                this.writeMemoryRequest(response, args['address'], args['data']);
                break;
            case 'read-registers':
                this.readRegistersRequest(response);
                break;
            case 'read-register-list':
                this.readRegisterListRequest(response);
                break;
            case 'disassemble':
                this.disassembleRequest(response, args);
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
            default:
                response.body = { error: 'Invalid command.' };
                this.sendResponse(response);
                break;
        }
    }

    protected async disassembleRequest(response: DebugProtocol.Response, args: any): Promise<void> {
        if (args.function) {
            try {
                const funcInfo: SymbolInformation = await this.getDisassemblyForFunction(args.function, args.file);
                response.body = {
                    instructions: funcInfo.instructions,
                    name: funcInfo.name,
                    file: funcInfo.file,
                    address: funcInfo.address,
                    length: funcInfo.length
                };
                this.sendResponse(response);
            }
            catch (e) {
                this.sendErrorResponse(response, 1, `Unable to disassemble: ${e.toString()}`);
            }
            return;
        }
        else if (args.startAddress) {
            try {
                let funcInfo = this.symbolTable.getFunctionAtAddress(args.startAddress);
                if (funcInfo) {
                    funcInfo = await this.getDisassemblyForFunction(funcInfo.name, funcInfo.file);
                    response.body = {
                        instructions: funcInfo.instructions,
                        name: funcInfo.name,
                        file: funcInfo.file,
                        address: funcInfo.address,
                        length: funcInfo.length
                    };
                    this.sendResponse(response);
                }
                else {
                    // tslint:disable-next-line:max-line-length
                    const instructions: DisassemblyInstruction[] = await this.getDisassemblyForAddresses(args.startAddress, args.length || 256);
                    response.body = { instructions: instructions };
                    this.sendResponse(response);
                }
            }
            catch (e) {
                this.sendErrorResponse(response, 1, `Unable to disassemble: ${e.toString()}`);
            }
            return;
        }
        else {
            this.sendErrorResponse(response, 1, 'Unable to disassemble; invalid parameters.');
        }
    }

    private async getDisassemblyForFunction(functionName: string, file?: string): Promise<SymbolInformation> {
        const symbol: SymbolInformation = this.symbolTable.getFunctionByName(functionName, file);

        if (!symbol) { throw new Error(`Unable to find function with name ${functionName}.`); }

        if (symbol.instructions) { return symbol; }

        const startAddress = symbol.address;
        const endAddress = symbol.address + symbol.length;

        // tslint:disable-next-line:max-line-length
        const result = await this.miDebugger.sendCommand(`data-disassemble -s ${hexFormat(startAddress, 8)} -e ${hexFormat(endAddress, 8)} -- 2`);
        const rawInstructions = result.result('asm_insns');
        const instructions: DisassemblyInstruction[] = rawInstructions.map((ri) => {
            const address = MINode.valueOf(ri, 'address');
            const functionName = MINode.valueOf(ri, 'func-name');
            const offset = parseInt(MINode.valueOf(ri, 'offset'));
            const inst = MINode.valueOf(ri, 'inst');
            const opcodes = MINode.valueOf(ri, 'opcodes');

            return {
                address: address,
                functionName: functionName,
                offset: offset,
                instruction: inst,
                opcodes: opcodes
            };
        });
        symbol.instructions = instructions;
        return symbol;
    }

    private async getDisassemblyForAddresses(startAddress: number, length: number): Promise<DisassemblyInstruction[]> {
        const endAddress = startAddress + length;

        // tslint:disable-next-line:max-line-length
        const result = await this.miDebugger.sendCommand(`data-disassemble -s ${hexFormat(startAddress, 8)} -e ${hexFormat(endAddress, 8)} -- 2`);
        const rawInstructions = result.result('asm_insns');
        const instructions: DisassemblyInstruction[] = rawInstructions.map((ri) => {
            const address = MINode.valueOf(ri, 'address');
            const functionName = MINode.valueOf(ri, 'func-name');
            const offset = parseInt(MINode.valueOf(ri, 'offset'));
            const inst = MINode.valueOf(ri, 'inst');
            const opcodes = MINode.valueOf(ri, 'opcodes');

            return {
                address: address,
                functionName: functionName,
                offset: offset,
                instruction: inst,
                opcodes: opcodes
            };
        });

        return instructions;
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
            this.sendErrorResponse(response, 114, `Unable to read memory: ${error.toString()}`);
            this.sendEvent(new TelemetryEvent('Error', 'Reading Memory', `${startAddress}-${length.toString(16)}`));
        });
    }

    protected writeMemoryRequest(response: DebugProtocol.Response, startAddress: number, data: string) {
        const address = hexFormat(startAddress, 8);
        this.miDebugger.sendCommand(`data-write-memory-bytes ${address} ${data}`).then((node) => {
            this.sendResponse(response);
        }, (error) => {
            response.body = { error: error };
            this.sendErrorResponse(response, 114, `Unable to write memory: ${error.toString()}`);
            this.sendEvent(new TelemetryEvent('Error', 'Writing Memory', `${startAddress.toString(16)}-${data.length.toString(16)}`));
        });
    }

    protected readRegistersRequest(response: DebugProtocol.Response) {
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

    protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
        const doDisconnectProcessing = () => {
            if (this.attached) {
                this.attached = false;
                this.miDebugger.detach();
            } else {
                this.miDebugger.stop();
            }
            if (this.commandServer) {
                this.commandServer.close();
                this.commandServer = undefined;
            }
            setTimeout(() => {      // Give gdb a chance to disconnect and exit normally
                try {
                    this.disableSendStoppedEvents = false;
                    this.server.exit();
                }
                catch (e) {}
                finally {
                    this.sendResponse(response);
                }
            }, 50);
        };

        this.disableSendStoppedEvents = true;
        if (this.miDebugger) {
            if (this.attached && !this.stopped) {
                this.miDebugger.once('generic-stopped', doDisconnectProcessing);
                this.miDebugger.sendCommand('exec-interrupt');
            } else {
                doDisconnectProcessing();
            }
        }
    }

    //
    // I don't think we are following the protocol here. but the protocol doesn't make sense. I got a
    // clarification that for an attach session, restart means detach and re-attach. How does this make
    // any sense? Isn't that like a null operation?
    //
    // https://github.com/microsoft/debug-adapter-protocol/issues/73
    //
    protected restartRequest(response: DebugProtocol.RestartResponse, args: DebugProtocol.RestartArguments): void {
        const restartProcessing = async () => {
            this.disableSendStoppedEvents = false;
            const commands = [];

            commands.push(...this.args.preRestartCommands.map(COMMAND_MAP));
            const restartCommands = this.args.overrideRestartCommands != null ?
                this.args.overrideRestartCommands.map(COMMAND_MAP) : this.serverController.restartCommands();
            commands.push(...restartCommands);
            commands.push(...this.args.postRestartCommands.map(COMMAND_MAP));
            commands.push(...this.serverController.swoCommands());

            this.miDebugger.restart(commands).then((done) => {
                this.sendResponse(response);
                setTimeout(() => {
                    this.stopped = true;        // This should aleady be true??
                    this.stoppedReason = 'restart';
                    this.sendEvent(new ContinuedEvent(this.currentThreadId, true));
                    this.sendEvent(new StoppedEvent('restart', this.currentThreadId, true));
                    this.sendEvent(new CustomStoppedEvent('restart', this.currentThreadId));
                    this.runPostStartSessionCommands(true, 50);
                }, 50);
            }, (msg) => {
                this.sendErrorResponse(response, 6, `Could not restart: ${msg}`);
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

    protected handleAdapterOutput(output) {
        this.sendEvent(new AdapterOutputEvent(output, 'out'));
    }

    private serverControllerEvent(event: DebugProtocol.Event) {
        this.sendEvent(event);
    }

    protected handleMsg(type: string, msg: string) {
        if (type === 'target') { type = 'stdout'; }
        if (type === 'log') { type = 'stderr'; }
        this.sendEvent(new OutputEvent(msg, type));
    }

    protected handleRunning(info: MINode) {
        this.stopped = false;
        this.sendEvent(new ContinuedEvent(this.currentThreadId, true));
        this.sendEvent(new CustomContinuedEvent(this.currentThreadId, true));
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
        this.stopped = true;
        this.stoppedReason = 'breakpoint';
        this.findPausedThread(info);
        if (!this.disableSendStoppedEvents) {
            this.sendEvent(new StoppedEvent('breakpoint', this.currentThreadId, true));
            this.sendEvent(new CustomStoppedEvent('breakpoint', this.currentThreadId));
        } else {
            this.stoppedEventPending = true;
        }
    }

    protected handleBreak(info: MINode) {
        this.stopped = true;
        this.stoppedReason = 'step';
        this.findPausedThread(info);
        if (!this.disableSendStoppedEvents) {
            this.sendEvent(new StoppedEvent('step', this.currentThreadId, true));
            this.sendEvent(new CustomStoppedEvent('step', this.currentThreadId));
        } else {
            this.stoppedEventPending = true;
        }
    }

    public sendEvent(event: DebugProtocol.Event): void {
        super.sendEvent(event);
        if (traceThreads && (event instanceof StoppedEvent || event instanceof ContinuedEvent)) {
            this.handleMsg('log', '**** Event: ' + JSON.stringify(event) + '\n');
        }
    }

    protected handlePause(info: MINode) {
        this.stopped = true;
        this.stoppedReason = 'user request';
        this.findPausedThread(info);
        if (!this.disableSendStoppedEvents) {
            this.sendEvent(new StoppedEvent('user request', this.currentThreadId, true));
            this.sendEvent(new CustomStoppedEvent('user request', this.currentThreadId));
        } else {
            this.stoppedEventPending = true;
        }
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
    }

    protected stopEvent(info: MINode) {
        if (!this.started) { this.crashed = true; }
        if (!this.quit) {
            this.stopped = true;
            this.stoppedReason = 'exception';
            this.findPausedThread(info);
            this.sendEvent(new StoppedEvent('exception', this.currentThreadId, true));
            this.sendEvent(new CustomStoppedEvent('exception', this.currentThreadId));
        }
    }

    protected quitEvent() {
        if (traceThreads) {
            this.handleMsg('log', '**** quit event\n');
        }
        this.quit = true;
        this.sendEvent(new TerminatedEvent());
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
            const globOrStatic = this.getFloatingVariable(varRef, name);
            if (globOrStatic) {
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
        const createBreakpoints = async (shouldContinue) => {
            const all = [];
            args.breakpoints.forEach((brk) => {
                all.push(this.miDebugger.addBreakPoint({ raw: brk.name, condition: brk.condition, countCondition: brk.hitCondition }));
            });
            
            try {
                const breakpoints = await Promise.all(all);
                const finalBrks = [];
                breakpoints.forEach((brkp) => {
                    if (brkp[0]) { finalBrks.push({ line: brkp[1].line }); }
                });
                response.body = {
                    breakpoints: finalBrks
                };
                this.sendResponse(response);
            }
            catch (msg) {
                this.sendErrorResponse(response, 10, msg.toString());
            }
            if (shouldContinue) {
                await this.miDebugger.sendCommand('exec-continue');
            }
        };

        const process = async () => {
            if (this.stopped) { await createBreakpoints(false); }
            else {
                this.miDebugger.sendCommand('exec-interrupt');
                this.miDebugger.once('generic-stopped', () => { createBreakpoints(true); });
            }
        };

        if (this.debugReady) { process(); }
        else { this.miDebugger.once('debug-ready', process); }
    }

    protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments) {
        const createBreakpoints = async (shouldContinue) => {
            this.debugReady = true;
            const currentBreakpoints = (this.breakpointMap.get(args.source.path) || []).map((bp) => bp.number);
            
            try {
                await this.miDebugger.removeBreakpoints(currentBreakpoints);
                this.breakpointMap.set(args.source.path, []);
                
                const all: Array<Promise<Breakpoint>> = [];
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

                    const symbol: SymbolInformation = await this.getDisassemblyForFunction(func, file);
                    
                    if (symbol) {
                        args.breakpoints.forEach((brk) => {
                            if (brk.line <= symbol.instructions.length) {
                                const line = symbol.instructions[brk.line - 1];
                                all.push(this.miDebugger.addBreakPoint({
                                    file: args.source.path,
                                    line: brk.line,
                                    condition: brk.condition,
                                    countCondition: brk.hitCondition,
                                    raw: line.address
                                }));
                            }
                        });
                    }
                }
                else {
                    args.breakpoints.forEach((brk) => {
                        all.push(this.miDebugger.addBreakPoint({
                            file: args.source.path,
                            line: brk.line,
                            condition: brk.condition,
                            countCondition: brk.hitCondition
                        }));
                    });
                }

                const brkpoints = await Promise.all(all);

                const finalBrks: Breakpoint[] = brkpoints.filter((bp) => bp !== null);

                response.body = {
                    breakpoints: finalBrks.map((bp) => {
                        return {
                            line: bp.line,
                            id: bp.number,
                            verified: true
                        };
                    })
                };

                this.breakpointMap.set(args.source.path, finalBrks);
                this.sendResponse(response);
            }
            catch (msg) {
                this.sendErrorResponse(response, 9, msg.toString());
            }

            if (shouldContinue) {
                await this.miDebugger.sendCommand('exec-continue');
            }
        };

        const process = async () => {
            if (this.stopped) {
                await createBreakpoints(false);
            }
            else {
                await this.miDebugger.sendCommand('exec-interrupt');
                this.miDebugger.once('generic-stopped', () => { createBreakpoints(true); });
            }
        };

        if (this.debugReady) { process(); }
        else { this.miDebugger.once('debug-ready', process); }
    }

    protected async threadsRequest(response: DebugProtocol.ThreadsResponse): Promise<void> {
        if (!this.stopped || this.disableSendStoppedEvents) {
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
                    this.handleThreadCreated({threadId: thId, threadGroupId: 'i1'});
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
                this.sendEvent(new StoppedEvent(this.stoppedReason, this.currentThreadId, true));
                this.sendEvent(new CustomStoppedEvent(this.stoppedReason, this.currentThreadId));
            }

            const nodes = await Promise.all(threadIds.map((id) => this.miDebugger.sendCommand(`thread-info ${id}`)));

            const threads = nodes.map((node: MINode) => {
                let th = node.result('threads');
                if (th.length === 1) {
                    th = th[0];
                    const id = parseInt(MINode.valueOf(th, 'id'));
                    const tid = MINode.valueOf(th, 'target-id');
                    const details = MINode.valueOf(th, 'details');

                    return new Thread(id, details || tid);
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
            this.sendErrorResponse(response, 1, `Unable to get thread information: ${e}`);
        }
    }

    protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): Promise<void> {
        try {
            const stack = await this.miDebugger.getStack(args.threadId, args.startFrame, args.levels);
            const ret: StackFrame[] = [];
            for (const element of stack) {
                const stackId = GDBDebugSession.encodeReference(args.threadId, element.level);
                const file = element.file;
                let disassemble = this.forceDisassembly || !file;
                if (!disassemble) { disassemble = !(await this.checkFileExists(file)); }
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
                        const symbolInfo = await this.getDisassemblyForFunction(element.function, element.fileName);
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
                        ret.push(new StackFrame(stackId, element.function + '@' + element.address, new Source(element.fileName, file), element.line, 0));
                    }
                }
                catch (e) {
                    ret.push(new StackFrame(stackId, element.function + '@' + element.address, null, element.line, 0));
                }
            }

            response.body = {
                stackFrames: ret
            };
            this.sendResponse(response);
        }
        catch (err) {
            this.sendErrorResponse(response, 12, `Failed to get Stack Trace: ${err.toString()}`);
        }
    }

    protected configurationDoneRequest(
        response: DebugProtocol.ConfigurationDoneResponse,
        args: DebugProtocol.ConfigurationDoneArguments
    ): void {
        this.sendResponse(response);
        this.onConfigDone.emit('done');
    }

    protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
        const scopes = new Array<Scope>();
        scopes.push(new Scope('Local', parseInt(args.frameId as any), false));
        scopes.push(new Scope('Global', GLOBAL_HANDLE_ID, false));

        const staticId = STATIC_HANDLES_START + parseInt(args.frameId as any);
        scopes.push(new Scope('Static', staticId, false));
        this.floatingVariableMap[staticId] = {};         // Clear any previously stored stuff for this scope

        response.body = {
            scopes: scopes
        };
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
                            varObj = await this.miDebugger.varCreate(symbol.name, varObjName);
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
    private floatingVariableMap: {[scopeId: number]: {[name: string]: VariableObject}} = {};

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
            const file = frame.fileName;
            const staticSymbols = this.symbolTable.getStaticVariables(file);

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
                            varObj = await this.miDebugger.varCreate(symbol.name, varObjName);
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
                            varObj = await this.miDebugger.varCreate(variable.name, varObjName, '*');
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
            this.sendErrorResponse(response, 1, `Could not expand variable: ${err}`);
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
        }
        else if (args.variablesReference >= STATIC_HANDLES_START && args.variablesReference <= STATIC_HANDLES_FINISH) {
            const [threadId, frameId] = GDBDebugSession.decodeReference(args.variablesReference);
            return this.staticVariablesRequest(threadId, frameId, response, args);
        }
        else if (args.variablesReference >= STACK_HANDLES_START && args.variablesReference < STACK_HANDLES_FINISH) {
            return this.stackVariablesRequest(response, args);
        }
        else {
            id = this.variableHandles.get(args.variablesReference);

            if (typeof id === 'string') {
                return this.variableMembersRequest(id, response, args);
            }
            else if (typeof id === 'object') {
                if (id instanceof VariableObject) {
                    const pvar = id as VariableObject;

                    // Variable members
                    let children: VariableObject[];
                    const childMap: {[name: string]: number} = {};
                    try {
                        children = await this.miDebugger.varListChildren(id.name, this.args.flattenAnonymous);
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
            let assemblyMode = this.forceDisassembly;
            if (!assemblyMode) {
                const frame = await this.miDebugger.getFrame(args.threadId, 0);
                assemblyMode = !(await this.checkFileExists(frame.file));

                if (this.activeEditorPath && this.activeEditorPath.startsWith('disassembly:///')) {
                    const symbolInfo = this.symbolTable.getFunctionByName(frame.function, frame.fileName);
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
            let assemblyMode = this.forceDisassembly;
            if (!assemblyMode) {
                const frame = await this.miDebugger.getFrame(args.threadId, 0);
                assemblyMode = !(await this.checkFileExists(frame.file));

                if (this.activeEditorPath && this.activeEditorPath.startsWith('disassembly:///')) {
                    const symbolInfo = this.symbolTable.getFunctionByName(frame.function, frame.fileName);
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

            const done = await this.miDebugger.next(args.threadId, assemblyMode);
            this.sendResponse(response);
        }
        catch (msg) {
            this.sendErrorResponse(response, 6, `Could not step over: ${msg}`);
        }
    }

    protected checkFileExists(name: string): Promise<boolean> {
        if (!name) { return Promise.resolve(false); }

        if (this.fileExistsCache.has(name)) { // Check cache
            return Promise.resolve(this.fileExistsCache.get(name));
        }

        return new Promise((resolve, reject) => {
            fs.exists(name, (exists) => {
                this.fileExistsCache.set(name, exists);
                resolve(exists);
            });
        });
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
                        varObj = await this.miDebugger.varCreate(exp, varObjName, '@');  // Create floating variable
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
                this.sendErrorResponse(response, 7, err.toString());
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
                this.sendErrorResponse(response, 7, e.toString());
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
