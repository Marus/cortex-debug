//
// When the new DAP spec is released
// TODO:
// * Update setDataBreakpoints to check for frame-id if the 'name' is an expression
// * Return the new type of busy error for evaluate/memory-requests/disassembly and certain other responses
//
import {
    Logger, logger, LoggingDebugSession, InitializedEvent, TerminatedEvent,
    ContinuedEvent, OutputEvent, Thread, ThreadEvent,
    StackFrame, Scope, Source, Handles, Event, ErrorDestination
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { MI2, parseReadMemResults } from './backend/mi2/mi2';
import { extractBits, hexFormat } from './frontend/utils';
import { Variable, VariableObject, MIError, OurDataBreakpoint, OurInstructionBreakpoint, OurSourceBreakpoint } from './backend/backend';
import {
    TelemetryEvent, ConfigurationArguments, StoppedEvent, GDBServerController, SymbolFile,
    createPortName, GenericCustomEvent, quoteShellCmdLine, toStringDecHexOctBin, ADAPTER_DEBUG_MODE, defSymbolFile, CTIAction, getPathRelative
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
import { LiveWatchMonitor } from './live-watch-monitor';

// returns [threadId, frameId]
// We use 3 nibbles for frameId (max of 4K) and 2 nibbles for ThreadId (max of 256).
// Thread id's start at 1 and frame id's start from 0 for GDB
const RegionSize = 0xFFFFF;
export function decodeReference(varRef: number): number[] {
    return [(varRef & RegionSize) >>> 12, varRef & 0xFFF];
}

export function encodeReference(threadId: number, frameId: number): number {
    return ((threadId << 12) | (frameId & 0xFFF)) & RegionSize;
}

enum HandleRegions {
    GLOBAL_HANDLE_ID      = 0xFFFFFFFF,
    STACK_HANDLES_START   = encodeReference(0x01, 0x000),
    STACK_HANDLES_FINISH  = encodeReference(0xFF, 0xFFF),
    STATIC_HANDLES_START  = STACK_HANDLES_FINISH + 1,
    STATIC_HANDLES_FINISH = STATIC_HANDLES_START + RegionSize,
    REG_HANDLE_START      = STATIC_HANDLES_FINISH + 1,
    REG_HANDLE_FINISH     = REG_HANDLE_START + RegionSize,
    VAR_HANDLES_START     = REG_HANDLE_FINISH + 1,
    rest = 0xFFFFFFFF - VAR_HANDLES_START

}

if (false) {
    for (const nm of Object.keys(HandleRegions)) {
        if (isNaN(Number(nm))) {
            const v = HandleRegions[nm];
            console.log(nm.padStart(25, ' '), '0x' + v.toString(16).padStart(8, '0'), v.toString().padStart(10, ' '));
        }
    }
}

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

const VarNotFoundMsg = 'Variable object not found';
export class ExtendedVariable {
    constructor(public name, public options) {
    }
}

function COMMAND_MAP(c: string): string {
    if (!c) { return c; }
    c = c.trim();
    if (['continue', 'c', 'cont'].find((s) => s === c)) {
        // For some reason doing a continue in one of the commands from launch.json does not work with gdb when in MI mode
        // Maybe it is version dependent
        return 'exec-continue --all';
    }
    return c.startsWith('-') ? c.substring(1) : `interpreter-exec console "${c.replace(/"/g, '\\"')}"`;
}

let dbgResumeStopCounter = 0;
class CustomStoppedEvent extends Event implements DebugProtocol.Event {
    public readonly body: {
        reason: string,
        threadID: number
    };
    public readonly event: string;

    constructor(reason: string, threadID: number) {
        super('custom-stop', { reason: reason, threadID: threadID });
        // console.log(`${dbgResumeStopCounter} **** Stopped reason:${reason} thread:${threadID}`);
        dbgResumeStopCounter++;
    }
}

class PendingContinue {
    constructor(public shouldContinue: boolean, public haveMore?: () => boolean) {}
}

class VSCodeRequest<RespType, ArgsType> {
    constructor(
        // In the varargs extra, the first element is a PenContinue object. The rest are whatever else was passed in
        // when calling RequestQueue.add
        public functor: (response: RespType, args: ArgsType, ...extra: any[]) => Promise<void>,
        public response: RespType,
        public args: ArgsType,
        public resolve: any,
        public reject: any,
        public extra: any[]
    ) {}
}

/*
** There are breakpoint requests where VSCode sends duplicate or back to back requests. If the target is already running
** and the second one comes in while the first one is running (still un-resolved) and ruins the sequence in many ways.
** To avoid this, we can queue all such requests and guaranteed to execute the request one at a time in proper order
**
** There is another request (evaluateRequest) that can also be messed up by back to back requests, which messes up in other
** ways. You can also have duplicates here because the user created such dups.
**
** For requests where gdb needs to be temporarily interrupted for the operation to succeed, use setFunctionBreakpoints as a template (carefully)
** and for others, use evaluateRequest as a template
*/
export class RequestQueue<RespType, ArgsType> {
    private queue: Array<VSCodeRequest<RespType, ArgsType>> = [];
    private queueBusy = false;
    public pendedContinue = new PendingContinue(false, this.haveMore.bind(this));
    constructor(private alwaysResolve = true) {}
    public add(
        // For the varargs, extra can be any set of args but the first arg if used, is of type PendContinue
        functor: (response: RespType, args: ArgsType, ...extra: any[]) => Promise<void>,
        response: RespType, args: ArgsType, ...extra): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            this.queue.push(new VSCodeRequest<RespType, ArgsType>(functor, response, args, resolve, reject, extra));
            while (!this.queueBusy && (this.queue.length > 0)) {
                this.queueBusy = true;
                const obj = this.queue.shift();
                try {
                    const p = obj.functor(obj.response, obj.args, this.pendedContinue, ...obj.extra);
                    await p;
                    obj.resolve();
                }
                catch (e) {
                    if (this.alwaysResolve) {
                        obj.resolve();
                    } else {
                        obj.reject(e);
                    }
                }
                this.queueBusy = false;
            }
        });
    }

    public haveMore(): boolean {
        return this.queue.length > 0;
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
        // console.log(`${dbgResumeStopCounter} **** Running thread:${threadID}`);
        dbgResumeStopCounter++;
    }
}

const traceThreads = false;
export class GDBDebugSession extends LoggingDebugSession {
    private server: GDBServer;
    public args: ConfigurationArguments;
    private ports: { [name: string]: number };
    private serverController: GDBServerController;
    public symbolTable: SymbolTable;
    private usingParentServer = false;

    protected variableHandles = new Handles<string | VariableObject | ExtendedVariable>(HandleRegions.VAR_HANDLES_START);
    protected variableHandlesReverse: { [id: string]: number } = {};
    protected quit: boolean;
    protected attached: boolean;
    protected started: boolean;
    protected debugReady: boolean;
    public miDebugger: MI2;
    public miLiveGdb: LiveWatchMonitor | undefined;
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
    public stoppedThreadId: number = 0;

    protected functionBreakpoints = [];
    protected breakpointMap: Map<string, OurSourceBreakpoint[]> = new Map<string, OurSourceBreakpoint[]>();
    protected breakpointById: Map<number, OurSourceBreakpoint> = new Map<number, OurSourceBreakpoint>();
    protected instrBreakpointMap: Map<number, OurInstructionBreakpoint> = new Map<number, OurInstructionBreakpoint>();
    protected dataBreakpointMap: Map<number, OurDataBreakpoint> = new Map<number, OurDataBreakpoint>();
    protected fileExistsCache: Map<string, boolean> = new Map<string, boolean>();

    protected onInternalEvents: EventEmitter = new EventEmitter();
    protected configDone: boolean;

    protected suppressRadixMsgs = false;

    protected tcpPortAllocatedListner = this.tcpPortsAllocated.bind(this);

    public constructor(debuggerLinesStartAt1: boolean, public readonly isServer: boolean = false, threadID: number = 1) {
        super(undefined, debuggerLinesStartAt1, isServer);     // Use if deriving from LogDebugSession
        // super(debuggerLinesStartAt1, isServer);  // Use if deriving from DebugSession

        // TcpPortScanner.PortAllocated.on('allocated', (ports) => {
        //    this.sendEvent(new GenericCustomEvent('ports-allocated', ports));
        // });
        // While debugging, we are in server mode so these listners start piling up preventing addition of more listners
        TcpPortScanner.PortAllocated.on('allocated', this.tcpPortAllocatedListner);
    }

    private tcpPortsAllocated(ports) {
        this.sendEvent(new GenericCustomEvent('ports-allocated', ports));
    }

    // tslint:disable-next-line: max-line-length
    public sendErrorResponsePub(response: DebugProtocol.Response, codeOrMessage: number | DebugProtocol.Message, format?: string, variables?: any, dest?: any): void {
        this.sendErrorResponse(response, codeOrMessage, format, variables, dest);
    }

    protected initDebugger() {
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
    }

    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
        response.body.supportsHitConditionalBreakpoints = true;
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsConditionalBreakpoints = true;
        response.body.supportsLogPoints = true;
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
        response.body.supportsReadMemoryRequest = true;
        response.body.supportsWriteMemoryRequest = true;
        this.sendResponse(response);
    }

    private launchAttachInit(args: ConfigurationArguments) {
        // make sure to 'Stop' the buffered logging if 'trace' is not set
        args.pvtShowDevDebugOutput = args.showDevDebugOutput;
        if (args.showDevDebugOutput === ADAPTER_DEBUG_MODE.VSCODE) {
            logger.setup(Logger.LogLevel.Verbose , false, false);
            logger.init((ev: OutputEvent) => {
                // This callback is called with every msg. We don't want to create a recursive
                // callback to output a single message. Turn off logging, print and then turn it
                // back on.
                logger.setup(Logger.LogLevel.Stop, false, false);
                const msg = this.wrapTimeStamp(ev.body.output);
                this.sendEvent(new OutputEvent(msg, ev.body.category));
                logger.setup(Logger.LogLevel.Verbose, false, false);
            });
            args.showDevDebugOutput = ADAPTER_DEBUG_MODE.RAW;
        }

        this.args = this.normalizeArguments(args);
        this.handleMsg('stdout',
            `Cortex-Debug: VSCode debugger extension version ${args.pvtVersion} git(${__COMMIT_HASH__}). ` +
            'Usage info: https://github.com/Marus/cortex-debug#usage');

        if (this.args.showDevDebugOutput) {
            this.handleMsg('log', '"configuration": ' + JSON.stringify(args, undefined, 4) + '\n');
        }

        // When debugging this extension, we are in server mode serving multiple instances of a debugger.
        // So make sure any old data is cleared, and we only rely on what the frontend tells us
        TcpPortScanner.AvoidPorts.clear();
        for (const p of args.pvtAvoidPorts || []) {
            // Reserve it and neighboring ports
            for (let count = 0; count < 4; count++) {
                TcpPortScanner.AvoidPorts.add(p + count);
            }
        }
    }

    private dbgSymbolTable: SymbolTable = null;
    private loadSymbols(): Promise<void> {
        return new Promise<void>((resolve) => {
            // this.dbgSymbolStuff(args, '/Users/hdm/Downloads/XXX-01.elf', 'main', null);
            // this.dbgSymbolStuff(args, '/Users/hdm/Downloads/bme680-driver-design_585.out', 'setup_bme680', './src/bme680_test_app.c');
            // this.dbgSymbolStuff(args, '/Users/hdm/Downloads/test.out', 'BSP_Delay', 'C:/Development/GitRepos/Firmware/phoenix/STM32F4/usb_bsp.c');
            const execs: SymbolFile[] = this.args.symbolFiles || [defSymbolFile(this.args.executable)];
            this.symbolTable = new SymbolTable(this, execs);
            this.symbolTable.loadSymbols().then(() => {
                if (this.args.rttConfig.enabled) {
                    const symName = this.symbolTable.rttSymbolName;
                    if (!this.args.rttConfig.address) {
                        this.handleMsg('stderr', 'INFO: "rttConfig.address" not specified. Defaulting to "auto"\n');
                        this.args.rttConfig.address = 'auto';
                    }
                    if (this.args.rttConfig.address === 'auto') {
                        const rttSym = this.symbolTable.getGlobalOrStaticVarByName(symName);
                        if (!rttSym) {
                            this.args.rttConfig.enabled = false;
                            this.handleMsg('stderr', `Could not find symbol '${symName}' in executable. ` +
                                'Make sure you compile/link with debug ON or you can specify your own RTT address\n');
                        } else {
                            const searchStr = this.args.rttConfig.searchId || 'SEGGER RTT';
                            this.args.rttConfig.address = hexFormat(rttSym.address);
                            this.args.rttConfig.searchSize = Math.max(this.args.rttConfig.searchSize || 0, searchStr.length);
                            this.args.rttConfig.searchId = searchStr;
                            this.args.rttConfig.clearSearch = (this.args.rttConfig.clearSearch === undefined) ? true : this.args.rttConfig.clearSearch;
                        }
                    }
                }
                resolve();
            }, (e) => {
                this.handleMsg('log', `WARNING: Loading symbols failed. Please report this issue. Debugging may still work ${e}\n`);
                resolve();
            });
        });
    }

    private async dbgSymbolStuff(args: ConfigurationArguments, elfFile: string, func: string, file: string) {
        if (os.userInfo().username === 'hdm') {
            this.handleMsg('log', `Reading symbols from ${elfFile}\n`);
            const tmpSymbols = new SymbolTable(this, [defSymbolFile(elfFile)]);
            this.dbgSymbolTable = tmpSymbols;
            await tmpSymbols.loadSymbols();
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

        if (args.chainedConfigurations && args.chainedConfigurations.enabled && args.chainedConfigurations.launches) {
            for (const config of args.chainedConfigurations.launches) {
                let folder = config.folder || args.cwd || process.cwd();
                if (!path.isAbsolute(folder)) {
                    folder = path.join(args.cwd || process.cwd(), folder);
                }
                folder = path.normalize(folder).replace(/\\/g, '/');
                while ((folder.length > 1) && folder.endsWith('/') && !folder.endsWith(':/')) {
                    folder = folder.substring(0, folder.length - 1);
                }
                config.folder = folder;
            }
        }

        return args;
    }

    private getTCPPorts(useParent): Thenable<void> {
        return new Promise((resolve, reject) => {
            const startPort = 50000;
            if (useParent) {
                this.ports = this.args.pvtPorts = this.args.pvtParent.pvtPorts;
                this.serverController.setPorts(this.ports);
                if (this.args.showDevDebugOutput) {
                    this.handleMsg('log', JSON.stringify({configFromParent: this.args.pvtMyConfigFromParent}, undefined, 4) + '\n');
                }
                return resolve();
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

    private processLaunchAttachRequest(response: DebugProtocol.LaunchResponse, attach: boolean): Promise<void> {
        return new Promise<void>((resolve) => {
            const doResolve = () => {
                if (resolve) {
                    resolve();
                    resolve = null;
                }
            };
            const haveSymFiles = this.args.symbolFiles && (this.args.symbolFiles.length > 0);
            if (!fs.existsSync(this.args.executable) && !haveSymFiles) {
                this.sendErrorResponse(response, 103, `Unable to find executable file at ${this.args.executable}.`);
                return doResolve();
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

            this.serverConsoleLog(`******* Starting new session request type="${this.args.request}"`);

            if (!this.getGdbPath(response)) {
                return doResolve();
            }
            const symbolsPromise = this.loadSymbols();      // This is totally async and in most cases, done while gdb is starting
            const gdbPromise = this.startGdb(response);
            // const gdbInfoVariables = this.symbolTable.loadSymbolsFromGdb(gdbPromise);
            this.usingParentServer = this.args.pvtMyConfigFromParent && !this.args.pvtMyConfigFromParent.detached;
            this.getTCPPorts(this.usingParentServer).then(async () => {
                await this.serverController.allocateRTTPorts();     // Must be done before serverArguments()
                const executable = this.usingParentServer ? null : this.serverController.serverExecutable();
                const args = this.usingParentServer ? [] : this.serverController.serverArguments();
                this.sendEvent(new GenericCustomEvent('ports-done', undefined));        // Should be no more TCP ports allocation

                const serverCwd = this.getServerCwd(executable);

                if (executable) {
                    this.handleMsg('log', 'Launching gdb-server: ' + quoteShellCmdLine([executable, ...args]) + '\n');
                    this.handleMsg('stdout', `    Please check TERMINAL tab (gdb-server) for output from ${executable}` + '\n');
                }

                const consolePort = (this.args as any).gdbServerConsolePort;
                const gdbPort = this.ports[createPortName(this.args.targetProcessor)];
                let initMatch = null;
                if (!this.usingParentServer) {
                    initMatch = this.serverController.initMatch();
                    if (this.args.overrideGDBServerStartedRegex) {
                        initMatch = new RegExp(this.args.overrideGDBServerStartedRegex, 'i');
                    }
                    if (consolePort === undefined) {
                        this.launchErrorResponse(response, 107, 'GDB Server Console tcp port is undefined.');
                        return doResolve();
                    }
                }
                this.server = new GDBServer(serverCwd, executable, args, initMatch, gdbPort, consolePort);
                this.server.on('exit', () => {
                    if (this.started) {
                        this.serverQuitEvent();
                    } else if (!this.miDebugger.isRunning()) {
                        this.launchErrorResponse(response, 103, 'GDB could not start as expected. Bad installation or version mismatch. '
                            + 'See if you can start gdb from a shell prompt and check its version (Must be >= 9)');
                        doResolve();
                    } else {
                        const server = this.serverController?.name || this.args.servertype;
                        const msg = `${server}: GDB Server Quit Unexpectedly. See gdb-server output in TERMINAL tab for more details.`;
                        this.launchErrorResponse(response, 103, msg);
                        doResolve();
                    }
                });
                this.server.on('launcherror', (err) => {
                    this.launchErrorResponse(response, 103, `Failed to launch ${this.serverController.name || this.args.servertype} GDB Server: ${err}`);
                    doResolve();
                });

                let timeout = setTimeout(() => {
                    this.server.exit();
                    this.sendEvent(new TelemetryEvent(
                        'Error',
                        'Launching Server',
                        `Failed to launch ${this.serverController.name || this.args.servertype} GDB Server: Timeout.`
                    ));
                    this.launchErrorResponse(response, 103, `Failed to launch ${this.serverController.name || this.args.servertype} GDB Server: Timeout.`);
                    doResolve();
                }, GDBServer.SERVER_TIMEOUT);

                this.serverController.serverLaunchStarted();
                this.server.init().then(async (started) => {
                    if (timeout) {
                        clearTimeout(timeout);
                        timeout = null;
                    }
                    const commands = [];
                    try {
                        // This is where 4 things meet and they must all finish (in any order) before we can proceed
                        // 1. Gdb has been started
                        // 2. No more: We read the symbols from gdb
                        // 3. Found free TCP ports and launched gdb-server
                        // 4. Finished reading symbols from objdump and nm
                        const showTimes = this.args.showDevDebugOutput && this.args.showDevDebugTimestamps;
                        await gdbPromise;
                        if (showTimes) { this.handleMsg('log', 'Debug Time: GDB Ready...\n'); }

                        // await gdbInfoVariables;
                        // if (showTimes) { this.handleMsg('log', 'Debug Time: GDB info variables done...\n'); }

                        await this.serverController.serverLaunchCompleted();
                        if (showTimes) { this.handleMsg('log', 'Debug Time: GDB Server post start events done...\n'); }

                        await symbolsPromise;
                        if (showTimes) { this.handleMsg('log', 'Debug Time: objdump and nm done...\n'); }
                        if (showTimes) { this.handleMsg('log', 'Debug Time: All pending items done, proceed to gdb connect...\n'); }

                        // This is the last of the place where ports are allocated
                        this.sendEvent(new GenericCustomEvent('post-start-server', this.args));
                        commands.push(...this.serverController.initCommands());

                        if (attach) {
                            commands.push(...this.args.preAttachCommands.map(COMMAND_MAP));
                            const attachCommands = this.args.overrideAttachCommands != null ?
                                this.args.overrideAttachCommands.map(COMMAND_MAP) : this.serverController.attachCommands();
                            commands.push(...attachCommands);
                            commands.push(...this.args.postAttachCommands.map(COMMAND_MAP));
                        } else {
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
                        this.launchErrorResponse(response, 104, `Failed to generate gdb commands: ${msg}`);
                        return doResolve();
                    }

                    this.serverController.debuggerLaunchStarted(this);
                    this.miDebugger.once('debug-ready', () => {
                        this.debugReady = true;
                        this.attached = attach;
                    });

                    // For now, we unconditionally suppress events because we will recover after we run the post start commands
                    this.disableSendStoppedEvents = true;
                    this.sendDummyStackTrace = !attach && (!!this.args.runToEntryPoint || !this.args.breakAfterReset);
                    this.miDebugger.connect(commands).then(async () => {
                        const mode = attach ? SessionMode.ATTACH : SessionMode.LAUNCH;
                        this.started = true;
                        this.serverController.debuggerLaunchCompleted();

                        this.sendEvent(new InitializedEvent());     // This is when we tell that the debugger has really started
                        // After the above, VSCode will set various kinds of breakpoints, watchpoints, etc. When all those things
                        // happen, it will finally send a configDone request and now everything should be stable
                        this.sendEvent(new GenericCustomEvent('post-start-gdb', this.args));

                        this.onInternalEvents.once('config-done', async () => {
                            // Let the gdb server settle down. They are sometimes still creating/delteting threads
                            await new Promise<void>((r) => setTimeout(() => { this.startComplete(mode), r(); }, 100));
                            // We wait for all other initialization to complete so we don't create race conditions.
                            // This is such a piece of shit/fragile code. Not sure how what VSCode is doing but it hangs when we send an appropriate
                            // busy error.
                            if (this.sendDummyStackTrace) {
                                this.onInternalEvents.once('stack-trace-request', () => {
                                    // Now, we wait for VSCode to query the stack trace. This is an issue with VSCode that if we don't allow it
                                    // to collect some thread/stack information, and we issue a continue, the pause button will never work.
                                    // We sometimes seem to get duplicate stack trace requests (back to back). We have implemented the workaround for just
                                    // one request but we have to handle multiple. Ridiculous. Not sure what we are doing wrong.
                                    this.sendDummyStackTrace = false;       // Maybe this should be inside the timeout, it keeps returning dummy stack traces
                                    setTimeout(() => this.finishStartSequence(mode), 100);
                                });
                            } else {
                                // Let VSCode finish its queries from the stop we sent in startComplete()
                                setTimeout(() => this.finishStartSequence(mode), 100);
                            }
                        });
                        this.sendResponse(response);
                        doResolve();
                    }, (err) => {
                        this.launchErrorResponse(response, 103, `Failed to launch GDB: ${err.toString()}`);
                        this.sendEvent(new TelemetryEvent('Error', 'Launching GDB', err.toString()));
                        try {
                            this.miDebugger.stop();     // This should also kill the server if there is one
                            this.server.exit();
                        }
                        finally {
                            doResolve();
                        }
                    });

                }, (error) => {
                    if (timeout) {
                        clearTimeout(timeout);
                        timeout = null;
                    }
                    this.sendEvent(new TelemetryEvent(
                        'Error',
                        'Launching Server',
                        `Failed to launch ${this.serverController.name || this.args.servertype} GDB Server: ${error.toString()}`
                    ));
                    // tslint:disable-next-line: max-line-length
                    this.launchErrorResponse(response, 103, `Failed to launch ${this.serverController.name || this.args.servertype} GDB Server: ${error.toString()}`);
                    doResolve();
                    this.server.exit();
                });

            }, (err) => {
                this.sendEvent(new TelemetryEvent('Error', 'Launching Server', `Failed to find open ports: ${err.toString()}`));
                this.launchErrorResponse(response, 103, `Failed to find open ports: ${err.toString()}`);
                doResolve();
            });
        });
    }

    // There are so many ways launching can fail but we only want to send the error response once.
    // However, send everything to the Debug Console anyways.
    private errResponseSent = false;
    private launchErrorResponse(response: DebugProtocol.LaunchResponse, code: number, msg: string) {
        this.handleMsg('stderr', `Error ${code}: ` + msg.endsWith('\n') ? msg : msg + '\n');
        if (!this.errResponseSent) {
            this.errResponseSent = true;
            this.sendErrorResponse(response, code, msg);
        }
    }

    //
    // Following function should never exist. The only way ST tools work is if the are run from the dir. where the
    // executable lives. Tried setting LD_LIBRARY_PATH, worked for some people and broke other peoples environments.
    // Normally, we NEED the server's CWD to be same as what the user wanted from the config. Because this where
    // the server scripts (OpenOCD, JLink, etc.) live and changing cwd for all servers will break for other servers
    // that are not so quirky.
    //
    private getServerCwd(serverExe: string) {
        let serverCwd = this.args.cwd || process.cwd();
        if (this.args.serverCwd) {
            serverCwd = this.args.serverCwd;
        } else if (this.args.servertype === 'stlink') {
            serverCwd = path.dirname(serverExe) || '.';
            if (serverCwd !== '.') {
                this.handleMsg('log', `Setting GDB-Server CWD: ${serverCwd}\n`);
            }
        }
        return serverCwd;
    }

    private notifyStopped(doCustom = true) {
        this.sendEvent(new StoppedEvent(this.stoppedReason, this.currentThreadId, true));
        if (doCustom) {
            this.sendEvent(new CustomStoppedEvent(this.stoppedReason, this.currentThreadId));
        }
    }

    private startCompleteForReset(mode: SessionMode, sendStoppedEvents = true) {
        if ((mode !== SessionMode.ATTACH) && (mode !== SessionMode.LAUNCH)) {
            this.startComplete(mode, sendStoppedEvents);
        }
    }

    private startComplete(mode: SessionMode, sendStoppedEvents = true) {
        this.disableSendStoppedEvents = false;
        this.continuing = false;
        this.stopped = this.miDebugger.status !== 'running';        // Set to real status
        if (sendStoppedEvents && !this.args.noDebug && this.stopped) {
            this.stoppedReason = mode;
            this.stoppedThreadId = this.currentThreadId;
            // We have to fake a continue and then stop, since we may already be in stopped mode in VSCode's view
            this.sendEvent(new ContinuedEvent(this.currentThreadId, true));
            this.notifyStopped();
        }
    }

    private finishStartSequence(mode: SessionMode): Promise<void> {
        return new Promise<void>(async (resolve) => {
            try {
                if ((mode === SessionMode.ATTACH) || (mode === SessionMode.LAUNCH)) {
                    const swoRttCommands = this.serverController.swoAndRTTCommands();
                    for (const cmd of swoRttCommands) {
                        await this.miDebugger.sendCommand(cmd);
                    }
                    if (this.args.liveWatch?.enabled) {
                        const liveGdb = new LiveWatchMonitor(this);
                        try {
                            // We must connect while it is paused. If no breakAfterReset and no runToEntryPoint, the program will
                            // continue but a connection from gdb will halt gdb-servers and we don't want that.
                            await this.startGdbForLiveWatch(liveGdb);
                            this.handleMsg('stdout', 'Started live-monitor-gdb session\n');
                            this.miLiveGdb = liveGdb;
                        }
                        catch (e) {
                            this.handleMsg('stderr', `Failed to start live-monitor-gdb session. Error: ${e}\n`);
                        }
                    }
                }
            }
            catch (e) {
                const msg = `SWO/RTT Initialization failed: ${e}`;
                this.handleMsg('stderr', msg);
                this.sendEvent(new GenericCustomEvent('popup', {type: 'error', message: msg}));
            }
            if (!this.args.noDebug && (mode !== SessionMode.ATTACH) && this.args.runToEntryPoint) {
                this.miDebugger.sendCommand(`break-insert -t --function ${this.args.runToEntryPoint}`).then(() => {
                    this.miDebugger.once('generic-stopped', () => {
                        resolve();
                    });
                    this.startCompleteForReset(mode, false);
                    this.sendContinue();
                }, (err) => {
                    // If failed to set the temporary breakpoint (e.g. function does not exist)
                    // complete the launch as if the breakpoint had not being defined
                    this.handleMsg('log', `launch.json: Unable to set temporary breakpoint "runToEntryPoint":"${this.args.runToEntryPoint}".` +
                        'Function may not exist or out of breakpoints? ' + err.toString() + '\n');
                    if (mode === SessionMode.LAUNCH) {
                        this.args.runToEntryPoint = '';     // Don't try again. It will likely to fail
                    }
                    this.startComplete(mode);               // Call this again to return actual stack trace
                    resolve();
                });
            } else {
                this.runPostStartSessionCommands(mode).then((didContinue) => {
                    if (!didContinue) {
                        this.startCompleteForReset(mode, true);
                    }
                    resolve();
                }, (e) => {
                    // Should never happen
                    console.log(e);
                    resolve();
                });
            }
        });
    }

    private getGdbPath(response: DebugProtocol.LaunchResponse): string {
        let gdbExePath = os.platform() !== 'win32' ? `${this.args.toolchainPrefix}-gdb` : `${this.args.toolchainPrefix}-gdb.exe`;
        if (this.args.toolchainPath) {
            gdbExePath = path.normalize(path.join(this.args.toolchainPath, gdbExePath));
        }
        const gdbMissingMsg = `GDB executable "${gdbExePath}" was not found.\n` +
            'Please configure "cortex-debug.armToolchainPath" or "cortex-debug.gdbPath" correctly.';

        if (this.args.gdbPath) {
            gdbExePath = this.args.gdbPath;
        } else if (path.isAbsolute(gdbExePath)) {
            if (fs.existsSync(gdbExePath) === false) {
                this.launchErrorResponse(response, 103, gdbMissingMsg);
                return null;
            }
        }
        else if (!hasbin.sync(gdbExePath.replace(/\.exe$/i, ''))) {
            this.launchErrorResponse(response, 103, gdbMissingMsg);
            return null;
        }
        this.args.gdbPath = gdbExePath;     // This now becomes the official gdb-path
        return gdbExePath;
    }

    private gdbInitCommands: string[] = [];
    private startGdb(response: DebugProtocol.LaunchResponse): Promise<void> {
        const gdbExePath = this.args.gdbPath;
        const gdbargs = ['-q', '--interpreter=mi2'].concat(this.args.debuggerArgs || []);
        if (!this.args.symbolFiles) {
            if (!path.isAbsolute(this.args.executable)) {
                this.args.executable = path.join(this.args.cwd, this.args.executable);
            }
        }
        const dbgMsg = 'Launching GDB: ' + quoteShellCmdLine([gdbExePath, ...gdbargs]) + '\n';
        this.handleMsg('log', dbgMsg);
        if (!this.args.showDevDebugOutput) {
            this.handleMsg('stdout', '    IMPORTANT: Set "showDevDebugOutput": "raw" in "launch.json" to see verbose GDB transactions ' +
                'here. Very helpful to debug issues or report problems\n');
        }
        if (this.args.showDevDebugOutput && this.args.chainedConfigurations && this.args.chainedConfigurations.enabled) {
            const str = JSON.stringify({chainedConfigurations: this.args.chainedConfigurations}, null, 4);
            this.handleMsg('log', str + '\n');
        }

        this.miDebugger = new MI2(gdbExePath, gdbargs);
        this.miDebugger.debugOutput = this.args.showDevDebugOutput as ADAPTER_DEBUG_MODE;
        this.miDebugger.on('launcherror', (err) => {
            const msg = 'Could not start GDB process, does the program exist in filesystem?\n' + err.toString() + '\n';
            this.launchErrorResponse(response, 103, msg);
            this.quitEvent();
        });
        this.initDebugger();
        this.gdbInitCommands = [
            'interpreter-exec console "set print demangle on"',
            'interpreter-exec console "set print asm-demangle on"',
            'enable-pretty-printing',
            `interpreter-exec console "source ${this.args.extensionPath}/support/gdbsupport.init"`,
            `interpreter-exec console "source ${this.args.extensionPath}/support/gdb-swo.init"`,
            ...this.formatRadixGdbCommand()
        ];
        if (this.args.symbolFiles) {
            for (const symF of this.args.symbolFiles) {
                let cmd = `interpreter-exec console "add-symbol-file \\"${symF.file}\\""`;
                cmd += symF.offset ? ` -o ${hexFormat(symF.offset)}"` : '';
                cmd += (typeof symF.textaddress === 'number') ? ` ${hexFormat(symF.textaddress)}"` : '';
                for (const section of symF.sections) {
                    cmd += ` -s ${section.name} ${section.address}`;
                }
                this.gdbInitCommands.push(cmd);
            }
            if (this.gdbInitCommands.length === 0) {
                this.handleMsg('log', 'Info: GDB may not start since there were no files with symbols in "symbolFiles?\n');
            }
        } else {
            this.gdbInitCommands.push(`file-exec-and-symbols "${this.args.executable}"`);
        }
        const ret = this.miDebugger.start(this.args.cwd, this.gdbInitCommands);
        return ret;
    }

    public startGdbForLiveWatch(liveGdb: LiveWatchMonitor): Promise<void> {
        const mi2 = new MI2(this.miDebugger.application, this.miDebugger.args, true);
        liveGdb.setupEvents(mi2);
        const commands = [...this.gdbInitCommands];
        mi2.debugOutput = this.args.showDevDebugOutput as ADAPTER_DEBUG_MODE;
        commands.push('interpreter-exec console "set stack-cache off"');
        commands.push('interpreter-exec console "set remote interrupt-on-connect off"');
        if (this.serverController?.initCommands) {
            commands.push(...this.serverController.initCommands());
        }
        const ret = mi2.start(this.args.cwd, commands);
        return ret;
    }
        
    private sendContinue(): Promise<void> {
        return new Promise<void>((resolve) => {
            this.continuing = true;
            this.miDebugger.sendCommand('exec-continue --all').then((done) => {
                resolve();
            }, (e) => {
                console.error('Not expecting continue to fail. ' + e);
                this.continuing = false;
                resolve();
            });
        });
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
        // We get the status from the MI because we may not have received the event yet
        return (this.miDebugger.status !== 'running');
    }

    // Runs a set of commands after a quiet time and is no other gdb transactions are happening
    // Returning 'true' means the execution is going to continue
    protected runPostStartSessionCommands(mode: SessionMode, interval: number = 100): Promise<boolean> {
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

        return new Promise<boolean>((resolve, reject) => {
            const doResolve = async () => {
                if (this.args.noDebug || (shouldContinue && this.isMIStatusStopped())) {
                    if ((mode === SessionMode.RESET) || (mode === SessionMode.RESTART)) {
                        this.sendDummyStackTrace = true;
                        this.onInternalEvents.once('stack-trace-request', () => {
                            this.sendDummyStackTrace = false;
                            this.sendContinue();
                        });
                        this.startComplete(mode);
                    } else {
                        this.sendContinue();
                    }
                    resolve(true);
                } else {
                    resolve(!this.isMIStatusStopped());
                }
            };
            if ((commands.length > 0) || shouldContinue) {
                commands = commands.map(COMMAND_MAP);
                this.miDebugger.postStart(commands).then(() => {
                    doResolve();
                }, (e) => {
                    const msg = `Error running post start/restart/reset commands ${e}`;
                    this.sendEvent(new GenericCustomEvent('popup', {type: 'error', message: msg}));
                    doResolve();
                });
            } else {
                resolve(false);
            }
        });
    }

    public serverConsoleLog(msg: string) {
        const pid = this.miDebugger && this.miDebugger.pid > 0 ? this.miDebugger.pid : process.pid;
        ServerConsoleLog(`${this.args.name}: ` + msg, pid);
    }

    protected async customRequest(command: string, response: DebugProtocol.Response, args: any) {
        const retFunc = () => {
            this.sendErrorResponse(response, 110, `Custom request ${command} cannot be run now, because debugger is busy}`,
                undefined, ErrorDestination.Telemetry);
            return;
        };

        if (this.serverController.customRequest(command, response, args)) {
            return retFunc();
        }

        const isBusy = !this.stopped || this.continuing || !this.isMIStatusStopped();
        switch (command) {
            case 'liveEvaluate':
                if (this.miLiveGdb) {
                    const r: DebugProtocol.EvaluateResponse = {
                        ...response,
                        body: {
                            result: undefined,
                            variablesReference: undefined
                        }
                    };
                    await this.miLiveGdb.evaluateRequest(r, args);
                } else {
                    this.sendResponse(response);
                }
                break;
            case 'liveCacheRefresh':
                if (this.miLiveGdb) {
                    await this.miLiveGdb.refreshLiveCache(args);
                }
                this.sendResponse(response);
                break;
            case 'liveVariables':
                if (this.miLiveGdb) {
                    const r: DebugProtocol.VariablesResponse = {
                        ...response,
                        body: {
                            variables: []
                        }
                    };
                    return this.miLiveGdb.variablesRequest(r, args);
                } else {
                    this.sendResponse(response);
                }
                break;
            case 'is-global-or-static': {
                const varRef = args.varRef;
                const id = this.variableHandles.get(varRef);
                const ret = this.isVarRefGlobalOrStatic(varRef, id);
                response.body = { success: ret };
                this.sendResponse(response);
                break;
            }
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
                if (isBusy) { return retFunc(); }
                this.readMemoryRequestCustom(response, args['address'], args['length']);
                break;
            case 'write-memory':
                if (isBusy) { return retFunc(); }
                this.writeMemoryRequestCustom(response, args['address'], args['data']);
                break;
            case 'set-var-format':
                this.args.variableUseNaturalFormat = (args && args.hex) ? false : true;
                this.setGdbOutputRadix();
                this.sendResponse(response);
                break;
            case 'read-registers':
                if (isBusy || this.sendDummyStackTrace) { return retFunc(); }
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
                const cmd = COMMAND_MAP(args?.command as string);
                if (cmd) {
                    this.miDebugger.sendCommand(cmd).then((node) => {
                        response.body = node.resultRecords;
                        this.sendResponse(response);
                    }, (error) => {
                        response.body = error;
                        this.sendErrorResponse(response, 110, 'Unable to execute command');
                    });
                }
                break;
            case 'reset-device':
                this.resetDevice(response, args);
                break;
            case 'custom-stop-debugging':
                this.serverConsoleLog(`Got request ${command}`);
                await this.disconnectRequest2(response, args);
                break;
            case 'notified-children-to-terminate':  // We never get this request
                this.serverConsoleLog(`Got request ${command}`);
                this.emit('children-terminating');
                this.sendResponse(response);
                break;
            case 'rtt-poll': {
                if (this.serverController.rttPoll) {
                    this.serverController.rttPoll();
                }
                break;
            }
            default:
                response.body = { error: 'Invalid command.' };
                this.sendResponse(response);
                break;
        }
    }

    protected async setGdbOutputRadix() {
        for (const cmd of this.formatRadixGdbCommand()) {
            try {
                await this.miDebugger.sendCommand(cmd);
                if (this.miLiveGdb?.miDebugger) {
                    await this.miLiveGdb.miDebugger.sendCommand(cmd);
                }
            }
            catch {}
        }
        if (this.stopped) {
            // We are already stopped but this fakes a stop again which refreshes all debugger windows
            // We don't have a way to only refresh portions. It is all or nothing, there is a bit
            // of screen flashing and causes changes in GUI contexts (stack for instance)
            this.sendEvent(new StoppedEvent(this.stoppedReason, this.currentThreadId, true));
        }
    }

    private formatRadixGdbCommand(forced: string | null = null): string[] {
        // radix setting affects future interpretations of values, so format it unambiguously with hex values
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

    protected readMemoryRequest(response: DebugProtocol.ReadMemoryResponse, args: DebugProtocol.ReadMemoryArguments, request?: DebugProtocol.Request): void {
        if (this.isBusy()) {
            this.busyError(response, args);
            return;
        }
        const startAddress = parseInt(args.memoryReference);
        const length = args.count;
        const useAddr = hexFormat(startAddress + (args.offset || 0));
        response.body = {
            address: useAddr,
            data: ''
        };
        if (length === 0) {
            this.sendResponse(response);
            return;
        }
        // const offset = args.offset ? `-o ${args.offset}` : '';
        const command = `data-read-memory-bytes "${useAddr}" ${length}`;
        this.miDebugger.sendCommand(command).then((node) => {
            const results = parseReadMemResults(node);
            const numBytes = results.data.length / 2;
            const intAry = new Uint8Array(numBytes);
            const data = results.data;
            for (let ix = 0, dx = 0; ix < numBytes; ix++, dx += 2) {
                // const tmp = results.data.substring(ix * 2, 2);
                const tmp = data[dx] + data[dx + 1];
                intAry[ix] = twoCharsToIntMap[tmp];
            }
            const buf = Buffer.from(intAry);
            const b64Data = buf.toString('base64');
            response.body.data = b64Data;
            this.sendResponse(response);
        }, (error) => {
            this.sendErrorResponse(response, 114, `Read memory error: ${error.toString()}`);
            this.sendEvent(new TelemetryEvent('Error', 'Reading Memory', command));
        });
    }

    protected writeMemoryRequest(response: DebugProtocol.WriteMemoryResponse, args: DebugProtocol.WriteMemoryArguments, request?: DebugProtocol.Request): void {
        if (this.isBusy()) {
            this.busyError(response, args);
            return;
        }
        const startAddress = parseInt(args.memoryReference);
        const useAddr = hexFormat(startAddress + (args.offset || 0));
        const buf = Buffer.from(args.data, 'base64');
        const data = buf.toString('hex');

        // Note: We don't do partials
        this.miDebugger.sendCommand(`data-write-memory-bytes ${useAddr} ${data}`).then((node) => {
            response.body = {
                bytesWritten: buf.length
            };
            this.sendResponse(response);
        }, (error) => {
            (response as DebugProtocol.Response).body = { error: error };
            this.sendErrorResponse(response, 114, `Write memory error: ${error.toString()}`);
            this.sendEvent(new TelemetryEvent('Error', 'Writing Memory', `${startAddress.toString(16)}-${data.length.toString(16)}`));
        });
    }

    protected readMemoryRequestCustom(response: DebugProtocol.Response, startAddress: string, length: number) {
        this.miDebugger.sendCommand(`data-read-memory-bytes "${startAddress}" ${length}`).then((node) => {
            const results = parseReadMemResults(node);
            // const bytes = results.data.match(/[0-9a-f]{2}/g).map((b) => parseInt(b, 16));
            const bytes = [];
            const numBytes = results.data.length / 2;
            const data = results.data;
            for (let ix = 0, dx = 0; ix < numBytes; ix++, dx += 2) {
                const tmp = data[dx] + data[dx + 1];
                bytes.push(twoCharsToIntMap[tmp]);
            }
            response.body = {
                startAddress: results.startAddress,
                endAddress: results.endAddress,
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
                    this.serverConsoleLog('disconnectRequest sendResponse 3');
                    this.sendResponse(response);
                } else {
                    nTimes--;
                }
            }, 10);
            this.server.once('exit', () => {
                if (to) {
                    clearInterval(to);
                    to = null;
                    this.serverConsoleLog('disconnectRequest sendResponse 2');
                    this.sendResponse(response);
                }
            });
            // Note: If gdb exits first, then we kill the server anyways
        } else {
            this.miDebugger.once('quit', () => {
                this.serverConsoleLog('disconnectRequest sendResponse 1');
                this.sendResponse(response);
            });
        }
    }

    protected disconnectingPromise: Promise<void> = undefined;
    protected async disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): Promise<void> {
        TcpPortScanner.PortAllocated.removeListener('allocated', this.tcpPortAllocatedListner);
        if (this.disconnectingPromise) {
            // One of the ways this happens when we have the following
            // * we are a child session of someone else
            // * the parent has already asked us to quit and in the process, we sent a TerminatedEvent to VSCode
            // * VSCode in turn asks to disconnect. all is good, we were quitting anyways. Not sure exactly what else we could do
            this.serverConsoleLog('Got disconnect request while we are already disconnecting');
            await this.disconnectingPromise;
            this.sendResponse(response);
            return Promise.resolve();
        } else {
            // We have a problem here. It is not clear in the case of managed life-cycles what the children are supposed to do.
            // If we try to wait for children to exit cleanly and then exit ourselves, we are having issues (when not in server mode
            // which is always the case for production).
            //
            // If we wait for a timeout or event and the child exits in the meantime, VSCode is killing the parent while we are still
            // not yet done terminating ourselves. So, let the children terminate and in the meantime, at the same time we terminate ourselves
            // What really happens is that when/if we terminate first, the server (if any) is killed and the children will automatically die
            // but not gracefully.
            //
            // We have a catchall exit handler defined in server.ts but hopefully, we can get rid of that
            //
            // Maybe longer term, what might be better is that we enter server mode ourselves. For another day
            if (this.args.chainedConfigurations?.enabled) {
                this.serverConsoleLog('Begin disconnectRequest children');
                this.sendEvent(new GenericCustomEvent('session-terminating', args));
            }
            return this.disconnectRequest2(response, args);
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

    protected disconnectRequest2(
        response: DebugProtocol.DisconnectResponse | DebugProtocol.Response,
        args: DebugProtocol.DisconnectArguments): Promise<void> {
        this.disconnectingPromise =  new Promise<void>(async (resolve) => {
            this.serverConsoleLog('Begin disconnectRequest');
            const doDisconnectProcessing = async () => {
                if (this.miLiveGdb) {
                    this.miLiveGdb.quit();
                    await new Promise((resolve) => setTimeout(resolve, 100));
                }
                await this.tryDeleteBreakpoints();
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
                resolve();
            };

            if (this.miDebugger) {
                this.disableSendStoppedEvents = true;
                if (!this.stopped) {
                    // Many ways things can fail. See issue #561
                    // exec-interrupt can fail because gdb is wedged and does not respond with proper status ever
                    // use a timeout and try to end session anyways.
                    let to = setTimeout(() => {
                        if (to) {
                            to = null;
                            this.handleMsg('log', 'GDB never responded to an interrupt request. Trying to end session anyways\n');
                            doDisconnectProcessing();
                        }
                    }, 2000);
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
                } else {
                    doDisconnectProcessing();
                }
            } else {
                resolve();
            }
        });
        return this.disconnectingPromise;
    }

    //
    // I don't think we are following the protocol here. but the protocol doesn't make sense. I got a
    // clarification that for an attach session, restart means detach and re-attach. Doesn't make
    // any sense for embedded?
    //
    // https://github.com/microsoft/debug-adapter-protocol/issues/73
    //
    private sendDummyStackTrace = false;
    protected restartRequest(response: DebugProtocol.RestartResponse, args: DebugProtocol.RestartArguments | any): Promise<void> {
        return new Promise<void>((resolve) => {
            const mode: SessionMode = (args === 'reset') ? SessionMode.RESET : SessionMode.RESTART;
            const restartProcessing = () => {
                const commands = [];
                this.args.pvtRestartOrReset = true;
                this.disableSendStoppedEvents = false;
                this.continuing = false;

                if (mode === SessionMode.RESTART) {
                    commands.push(...this.args.preRestartCommands.map(COMMAND_MAP));
                    const restartCommands = this.args.overrideRestartCommands ?
                        this.args.overrideRestartCommands.map(COMMAND_MAP) : this.serverController.restartCommands();
                    commands.push(...restartCommands);
                    commands.push(...this.args.postRestartCommands.map(COMMAND_MAP));
                } else {
                    commands.push(...this.args.preResetCommands.map(COMMAND_MAP));
                    const resetCommands = this.args.overrideResetCommands ? this.args.overrideResetCommands.map(COMMAND_MAP) :
                                          this.args.overrideRestartCommands ? this.args.overrideRestartCommands.map(COMMAND_MAP) :
                                          this.serverController.restartCommands();
                    commands.push(...resetCommands);
                    commands.push(...this.args.postResetCommands.map(COMMAND_MAP));
                }

                let finishCalled = false;
                const callFinish = () => {
                    if (!finishCalled) {
                        finishCalled = true;
                        this.sendDummyStackTrace = false;
                        this.finishStartSequence(mode);
                    }
                };

                // When we restart/reset, some startup sequences will produce a stopped event and some don't. In case such
                // an event is called, consume and return a dummy stacktrace (prevents unnecessary disassembly, multiple requests from VSCode, etc.)
                this.sendDummyStackTrace = true;    // Return dummies until we finish the start sequence
                this.onInternalEvents.once('stack-trace-request', () => {
                    callFinish();
                });

                this.miDebugger.restart(commands).then(async (done) => {
                    if (this.args.chainedConfigurations && this.args.chainedConfigurations.enabled) {
                        setTimeout(() => {      // Maybe this delay should be handled in the front-end
                            this.serverConsoleLog(`Begin ${mode} children`);
                            this.sendEvent(new GenericCustomEvent(`session-${mode}`, args));
                        }, 250);
                    }

                    if (!finishCalled) {
                        // gdb-server never produced any stopped events, so wait a bit to let things settle down
                        // Sometimes gdb sends delayed responses for program status (running, stopped, etc.) changes
                        await new Promise((resolve) => setTimeout(resolve, 100));
                        callFinish();
                    }
                    resolve();
                }, (msg) => {
                    this.sendErrorResponse(response, 6, `Could not restart/reset: ${msg}`);
                    resolve();
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
        });
    }

    protected getResetCommands(): string[] {
        return this.args.overrideResetCommands != null ? this.args.overrideResetCommands.map(COMMAND_MAP) :
               this.args.overrideRestartCommands != null ? this.args.overrideRestartCommands.map(COMMAND_MAP) :
               this.serverController.restartCommands();
    }

    protected async resetDevice(response: DebugProtocol.Response, args: any) {
        try {
            await this.restartRequest(response, args);
        }
        catch (e) {}
    }

    protected timeStart = Date.now();
    protected timeLast = this.timeStart;
    protected wrapTimeStamp(str: string): string {
        if (this.args.showDevDebugOutput && this.args.showDevDebugTimestamps) {
            return this.wrapTimeStampRaw(str);
        } else {
            return str;
        }
    }

    private wrapTimeStampRaw(str: string) {
        const now = Date.now();
        const elapsed = now - this.timeStart;
        const delta = now - this.timeLast;
        this.timeLast = now;
        const elapsedStr = elapsed.toString().padStart(10, '0') + '+' + delta.toString().padStart(5, '0');
        return elapsedStr + ': ' + str;
    }

    private serverControllerEvent(event: DebugProtocol.Event) {
        this.sendEvent(event);
    }

    // TODO: We should add more features here. type could be a message for error, warning, info and we auto prepend
    //   the tag for it. For consistency. Also make type an enum
    public handleMsg(type: string, msg: string) {
        if (this.suppressRadixMsgs && (type === 'console') && /radix/.test(msg)) {
            // Filter out unnecessary radix change messages
            return;
        }
        if (type === 'target') { type = 'stdout'; }
        if (type === 'log') { type = 'stderr'; }
        msg = this.wrapTimeStamp(msg);
        if (this.args.pvtShowDevDebugOutput === ADAPTER_DEBUG_MODE.VSCODE) {
            logger.setup(Logger.LogLevel.Stop, false, false);
            this.sendEvent(new OutputEvent(msg, type));
            logger.setup(Logger.LogLevel.Verbose, false, false);
        } else {
            this.sendEvent(new OutputEvent(msg, type));
        }
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
        const msg = 'Error: A serious error occurred with gdb, unable to continue or interrupt We may not be able to recover ' +
            'from this point. You can try continuing or ending session. Must address root cause though';
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
        this.clearAllThreads();
    }

    private clearAllThreads() {
        this.currentThreadId = 0;
        for (const thId of this.activeThreadIds.values()) {
            this.sendEvent(new ThreadEvent('exited', thId));
        }
        this.activeThreadIds.clear();
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

    protected quitEvent(type?: string, msg?: string) {
        this.quit = true;
        if (traceThreads) {
            this.handleMsg('log', '**** quit event\n');
        }
        if (msg && type) {
            this.handleMsg(type, msg);
        }
        if (this.server && this.server.isProcessRunning()) {
            // A gdb quit may be happening with VSCode asking us to finish or a crash or user doing something
            this.serverConsoleLog('quitEvent: Killing server');
            this.server.exit();
        }
        setTimeout(() => {
            // In case GDB quit because of normal processing, let that process finish. Wait for,\
            // a disconnect response to be sent before we send a TerminatedEvent();. Note that we could
            // also be here because the server crashed/quit on us before gdb-did
            try {
                this.sendEvent(new TerminatedEvent());
                this.serverConsoleLog('quitEvent: sending VSCode TerminatedEvent');
            }
            catch (e) {
            }
        }, 10);
    }

    protected serverQuitEvent() {
        if (this.miDebugger.isRunning() && !this.quit) {
            // Server quit before gdb quit. Maybe it crashed. Gdb is still running so stop it
            // which will in turn notify VSCode via `quitEvent()`
            this.miDebugger.stop();
        }
    }

    protected async setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments): Promise<void> {
        try {
            let name = args.name;
            let threadId = -1;
            let frameId = -1;
            const varRef = args.variablesReference;
            const isReg = (varRef >= HandleRegions.REG_HANDLE_START && varRef < HandleRegions.REG_HANDLE_FINISH);
            const globOrStatic = !isReg && this.getFloatingVariable(varRef, name);
            if (isReg) {
                [threadId, frameId] = decodeReference(varRef);
                const varObj = await this.miDebugger.varCreate(varRef, '$' + name, '-', '*', threadId, frameId);
                name = varObj.name;
            } else if (globOrStatic) {
                name = globOrStatic.name;
            } else if (varRef >= HandleRegions.VAR_HANDLES_START) {
                const parent = this.variableHandles.get(args.variablesReference) as VariableObject;
                const fullName = parent.children[name];
                name = fullName ? fullName : `${parent.name}.${name}`;
            } else if (varRef >= HandleRegions.STACK_HANDLES_START && varRef < HandleRegions.STACK_HANDLES_FINISH) {
                const tryName = this.createStackVarName(name, varRef);
                if (this.variableHandlesReverse.hasOwnProperty(tryName)) {
                    name = tryName;
                }
                [threadId, frameId] = decodeReference(varRef);
            }
            const res = await this.miDebugger.varAssign(name, args.value, threadId, frameId);
            // TODO: Need to check for errors? Currently handled by outer try/catch
            response.body = {
                value: res.result('value')
            };
            this.sendResponse(response);
        }
        catch (err) {
            this.sendErrorResponse(response, 11, `Could not set variable: ${err}`);
        }
    }

    // These should really by multiple pairs that are unique so you cannot mix up
    // the response and args
    private allBreakPointsQ = new RequestQueue<
        DebugProtocol.SetFunctionBreakpointsResponse |
        DebugProtocol.SetBreakpointsResponse |
        DebugProtocol.SetInstructionBreakpointsResponse |
        DebugProtocol.SetDataBreakpointsResponse,
        DebugProtocol.SetFunctionBreakpointsArguments |
        DebugProtocol.SetBreakpointsArguments |
        DebugProtocol.SetInstructionBreakpointsArguments |
        DebugProtocol.SetDataBreakpointsArguments>();
    protected setFunctionBreakPointsRequest(
        r: DebugProtocol.SetFunctionBreakpointsResponse,
        a: DebugProtocol.SetFunctionBreakpointsArguments): Promise<void> {
        const doit = (
            response: DebugProtocol.SetFunctionBreakpointsResponse,
            args: DebugProtocol.SetFunctionBreakpointsArguments,
            pendContinue: PendingContinue): Promise<void> => {
            return new Promise(async (resolve) => {
                const createBreakpoints = async () => {
                    try {
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

                    this.continueIfNoMore(pendContinue);
                    resolve();
                };

                await this.doPauseExecContinue(createBreakpoints, pendContinue);
            });
        };

        return this.allBreakPointsQ.add(doit, r, a);
    }

    private continueIfNoMore(pendContinue: PendingContinue) {
        if (pendContinue.haveMore()) {
        } else if (pendContinue.shouldContinue) {
            this.disableSendStoppedEvents = false;
            pendContinue.shouldContinue = false;
            this.sendContinue();
        }
    }

    private async doPauseExecContinue(createBreakpoints: () => Promise<void>, pendContinue: PendingContinue) {
        if (this.miDebugger.status !== 'running') { // May not even have started just yet
            await createBreakpoints();
        } else {
            this.disableSendStoppedEvents = true;
            pendContinue.shouldContinue = true;
            this.miDebugger.once('generic-stopped', () => { createBreakpoints(); });
            this.miDebugger.sendCommand('exec-interrupt');
        }
    }

    protected setBreakPointsRequest(
        r: DebugProtocol.SetBreakpointsResponse,
        a: DebugProtocol.SetBreakpointsArguments): Promise<void> {
        const doit = (
            response: DebugProtocol.SetBreakpointsResponse,
            args: DebugProtocol.SetBreakpointsArguments,
            pendContinue: PendingContinue): Promise<void> => {
            return new Promise(async (resolve) => {
                const createBreakpoints = async () => {
                    const currentBreakpoints = (this.breakpointMap.get(args.source.path) || []).map((bp) => bp.number);

                    try {
                        await this.miDebugger.removeBreakpoints(currentBreakpoints);
                        for (const old of currentBreakpoints) {
                            this.breakpointById.delete(old);
                        }
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

                        const bpts: OurSourceBreakpoint[] = brkpoints.filter((bp) => !(bp instanceof MIError)) as OurSourceBreakpoint[];
                        for (const bpt of bpts) {
                            this.breakpointById.set(bpt.number, bpt);
                        }
                        this.breakpointMap.set(args.source.path, bpts);
                        this.sendResponse(response);
                    }
                    catch (msg) {
                        this.sendErrorResponse(response, 9, msg.toString());
                    }

                    this.continueIfNoMore(pendContinue);
                    resolve();
                };

                await this.doPauseExecContinue(createBreakpoints, pendContinue);
            });
        };

        return this.allBreakPointsQ.add(doit, r, a);
    }

    protected setInstructionBreakpointsRequest(
        r: DebugProtocol.SetInstructionBreakpointsResponse,
        a: DebugProtocol.SetInstructionBreakpointsArguments, request?: DebugProtocol.Request): Promise<void> {
        const doit = (
            response: DebugProtocol.SetInstructionBreakpointsResponse,
            args: DebugProtocol.SetInstructionBreakpointsArguments,
            pendContinue: PendingContinue): Promise<void> => {
            return new Promise<void>(async (resolve) => {
                const createBreakpoints = async () => {
                    try {
                        const currentBreakpoints = Array.from(this.instrBreakpointMap.keys());
                        this.instrBreakpointMap.clear();

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
                    }
                    catch (msg) {
                        this.sendErrorResponse(response, 9, msg.toString());
                    }

                    this.continueIfNoMore(pendContinue);
                    resolve();
                };

                await this.doPauseExecContinue(createBreakpoints, pendContinue);
            });
        };

        return this.allBreakPointsQ.add(doit, r, a);
    }

    protected isVarRefGlobalOrStatic(varRef: number, id: any): 'global' | 'static' | undefined {
        if (varRef === HandleRegions.GLOBAL_HANDLE_ID) {
            return 'global';
        }
        if (varRef <= HandleRegions.STACK_HANDLES_FINISH) {
            // These are scopes for local variable frames
            return undefined;
        }
        if ((varRef >= HandleRegions.STATIC_HANDLES_START) && (varRef <= HandleRegions.STATIC_HANDLES_FINISH)) {
            return 'static';
        }
        if ((varRef >= HandleRegions.REG_HANDLE_START) && (varRef <= HandleRegions.REG_HANDLE_FINISH)) {
            return undefined;
        }

        if (id instanceof ExtendedVariable) {
            return undefined;
        }
        if (id instanceof VariableObject) {
            const pRef = (id as VariableObject).parent;
            const parent = this.variableHandles.get(pRef);
            return this.isVarRefGlobalOrStatic(pRef, parent);
        }

        console.log(`isVarRefGlobalOrStatic: What is this? varRef = ${varRef}`, '0x' + varRef.toString(16).padStart(8, '0'), id);
        return undefined;
    }

    protected dataBreakpointInfoRequest(response: DebugProtocol.DataBreakpointInfoResponse, args: DebugProtocol.DataBreakpointInfoArguments): void {
        response.body = {
            dataId: null,
            description: 'cannot break on data access',
            accessTypes: undefined,
            canPersist: false
        };

        const ref = args.variablesReference;
        if ((ref !== undefined) && args.name && !((ref >= HandleRegions.REG_HANDLE_START) && (ref <= HandleRegions.REG_HANDLE_FINISH))) {
            const id = this.variableHandles.get(args.variablesReference);
            response.body.canPersist = !!this.isVarRefGlobalOrStatic(args.variablesReference, id);
            const parentObj = (id as VariableObject);
            const fullName = (parentObj ? (parentObj.fullExp || parentObj.exp) + '.' : '') + args.name;
            response.body.dataId = fullName;
            response.body.description = fullName;       // What is displayed in the Breakpoints window
            response.body.accessTypes = ['read', 'write', 'readWrite'];
        }

        this.sendResponse(response);
    }

    protected setDataBreakpointsRequest(
        r: DebugProtocol.SetDataBreakpointsResponse,
        a: DebugProtocol.SetDataBreakpointsArguments): Promise<void> {
        const doit = (
            response: DebugProtocol.SetDataBreakpointsResponse,
            args: DebugProtocol.SetDataBreakpointsArguments,
            pendContinue: PendingContinue): Promise<void> => {
            return new Promise<void>(async (resolve) => {
                const createBreakpoints = async () => {
                    try {
                        const currentBreakpoints = Array.from(this.dataBreakpointMap.keys());
                        this.dataBreakpointMap.clear();

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

                    this.continueIfNoMore(pendContinue);
                    resolve();
                };

                await this.doPauseExecContinue(createBreakpoints, pendContinue);
            });
        };

        return this.allBreakPointsQ.add(doit, r, a);
    }

    protected threadsRequest(response: DebugProtocol.ThreadsResponse): Promise<void> {
        response.body = { threads: [] };
        if (!this.isMIStatusStopped() || !this.stopped || this.disableSendStoppedEvents || this.continuing) {
            this.sendResponse(response);
            return Promise.resolve();
        }

        if (this.sendDummyStackTrace) {
            if (this.args.showDevDebugOutput) {
                this.handleMsg('log', 'Returning dummy thread-id to workaround VSCode issue with pause button not working\n');
            }
            const useThread = this.currentThreadId || (this.activeThreadIds.size ? this.activeThreadIds.values[0] : 1);
            response.body.threads = [new Thread(useThread, 'cortex-debug-dummy-thread')];
            this.sendResponse(response);
            return Promise.resolve();
        }

        return new Promise<void>(async (resolve) => {
            try {
                const threadIdNode = await this.miDebugger.sendCommand('thread-list-ids');
                const threadIds: number[] = threadIdNode.result('thread-ids').map((ti) => parseInt(ti[1]));
                const currentThread = threadIdNode.result('current-thread-id');

                if (!threadIds || (threadIds.length === 0)) {
                    // Yes, this does happen at the very beginning of an RTOS session
                    this.sendResponse(response);
                    resolve();
                    return;
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
                if (this.currentThreadId !== this.stoppedThreadId) {
                    this.stoppedThreadId = this.currentThreadId;
                    // We have to fake a continue and then stop, since we may already be in stopped mode in VSCode's view
                    this.sendEvent(new ContinuedEvent(this.currentThreadId, true));
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
                resolve();
            }
            catch (e) {
                if (this.isMIStatusStopped()) {     // Between the time we asked for a info, a continue occurred
                    this.sendErrorResponse(response, 1, `Unable to get thread information: ${e}`);
                } else {
                    this.sendResponse(response);
                }
                resolve();
            }
        });
    }

    protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): Promise<void> {
        response.body = {
            stackFrames: [],
            totalFrames: 0
        };
        // Handle optional args when not passed
        args.startFrame = args.startFrame ?? 0;
        args.levels = args.levels ?? Infinity;
        const createDummy = () => {
            response.body.stackFrames = [new StackFrame(encodeReference(args.threadId, 0), 'cortex-debug-dummy', null, 0, 0)];
            response.body.totalFrames = 1;
        };
        const isBusy = () => {
            return !this.isMIStatusStopped() || !this.stopped || this.disableSendStoppedEvents || this.continuing;
        };
        if (this.sendDummyStackTrace) {
            // VSCode has a bug. Once we send a Stopped Event, VSCode pause button refuses to work until some stack trace is
            // returned. We have issues during startup (and reset/restart) where we need to continue right after the initial
            // stop. So, we wait until VSCode got some dummy stack trace to continue. Not an issue if you have runToEntryPoint
            // but is an issue otherwise.
            // This also prevents disassembly getting requested while we are still in the middle of starting up and the PC can
            // temporarily be in la la land.
            if (this.args.showDevDebugOutput) {
                this.handleMsg('log', `Returning dummy stack frame to workaround VSCode issue with pause button not working: ${JSON.stringify(args)}\n`);
            }
            createDummy();
            this.onInternalEvents.emit('stack-trace-request');
            this.sendResponse(response);
            return Promise.resolve();
        }
        if (isBusy()) {
            createDummy();
            this.sendResponse(response);
            return Promise.resolve();
        }
        return new Promise<void>(async (resolve) => {
            try {
                // GDB can take a long time if the stack is malformed to report depth. Instead, we just keep asking
                // for chunks of stack trace until GDB runs out of them
                const useMaxDepth = false;
                const defMaxDepth = 1000;
                const maxDepth = useMaxDepth ? await this.miDebugger.getStackDepth(args.threadId, defMaxDepth) : defMaxDepth;
                const highFrame = Math.min(maxDepth, args.startFrame + args.levels) - 1;
                const stack = await this.miDebugger.getStack(args.threadId, args.startFrame, highFrame);
                const ret: StackFrame[] = [];
                for (const element of stack) {
                    const stackId = encodeReference(args.threadId, element.level);
                    const file = element.file;
                    const src = file ? new Source(element.fileName, file) : undefined;
                    const sf = new StackFrame(stackId, element.function + '@' + element.address, src, element.line, 0);
                    sf.instructionPointerReference = element.address;
                    ret.push(sf);
                }
                response.body = {
                    stackFrames: ret,
                    totalFrames: useMaxDepth ? maxDepth : undefined
                };
                this.sendResponse(response);
                resolve();
            }
            catch (err) {
                if (isBusy()) {     // Between the time we asked for a info, a continue occurred
                    this.sendErrorResponse(response, 12, `Failed to get Stack Trace: ${err.toString()}`);
                } else {
                    this.sendResponse(response);
                }
                resolve();
            }
        });
    }

    protected configurationDoneRequest(
        response: DebugProtocol.ConfigurationDoneResponse,
        args: DebugProtocol.ConfigurationDoneArguments
    ): void {
        this.sendResponse(response);
        this.configDone = true;
        this.onInternalEvents.emit('config-done');
    }

    protected async scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): Promise<void> {
        const scopes = new Array<Scope>();
        response.body = {
            scopes: scopes
        };
        if (!this.isMIStatusStopped() || !this.stopped || this.disableSendStoppedEvents || this.continuing) {
            this.sendResponse(response);
            return Promise.resolve();
        }
        scopes.push(new Scope('Local', args.frameId, false));
        scopes.push(new Scope('Global', HandleRegions.GLOBAL_HANDLE_ID, false));

        const [threadId, frameId] = decodeReference(args.frameId);
        let file = '<unknown file>';
        try {
            const frame = await this.miDebugger.getFrame(threadId, frameId);
            file = getPathRelative(this.args.cwd, frame?.file || '');
        }
        catch {
            // Do Nothing. If you hit step/next really really fast, this can fail our/gdb/gdb-server/vscode are out of synch.
            // Side effect is statics won't show up but only during the fast transitions.
            // Objective is just not to crash
        }
        finally {
            const staticId = HandleRegions.STATIC_HANDLES_START + args.frameId;
            scopes.push(new Scope(`Static: ${file}`, staticId, false));
            this.floatingVariableMap[staticId] = {};         // Clear any previously stored stuff for this scope
        }

        scopes.push(new Scope('Registers', HandleRegions.REG_HANDLE_START + args.frameId));
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
            const [threadId, frameId] = decodeReference(args.variablesReference);
            const fmt = this.args.variableUseNaturalFormat ? 'N' : 'x';
            // --thread --frame does not work properly when combined with -data-list-register-values
            await this.miDebugger.sendCommand(`stack-select-frame --thread ${threadId} ${frameId}`);
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

    private async updateOrCreateVariable(
        displayName: string | undefined, symOrExpr: string, gdbVarName: string, parentVarReference: number,
        threadId: number, frameId: number, isFloating: boolean): Promise<DebugProtocol.Variable> {
        try {
            let varObj: VariableObject;
            let varId = this.variableHandlesReverse[gdbVarName];
            let createNewVar = varId === undefined;
            let updateError;
            if (!createNewVar) {
                try {
                    const changes = await this.miDebugger.varUpdate(gdbVarName, threadId, frameId);
                    const changelist = changes.result('changelist');
                    for (const change of changelist || []) {
                        const inScope = MINode.valueOf(change, 'in_scope');
                        if (inScope === 'true') {
                            const name = MINode.valueOf(change, 'name');
                            const vId = this.variableHandlesReverse[name];
                            const v = this.variableHandles.get(vId) as any;
                            v.applyChanges(change /*, variable.valueStr*/);
                        } else {
                            const msg = `${symOrExpr} currently not in scope`;
                            await this.miDebugger.sendCommand(`var-delete ${gdbVarName}`);
                            if (this.args.showDevDebugOutput) {
                                this.handleMsg('log', `Expression ${msg}. Will try to create again\n`);
                            }
                            createNewVar = true;
                            throw new Error(msg);
                        }
                    }
                    varObj = this.variableHandles.get(varId) as any;
                }
                catch (err) {
                    updateError = err;
                }
            }

            try {
                if (createNewVar || (updateError instanceof MIError && updateError.message === VarNotFoundMsg)) {
                    // Create variable in current frame/thread context. Matters when we have to set the variable
                    if (isFloating) {
                        varObj = await this.miDebugger.varCreate(parentVarReference, symOrExpr, gdbVarName, '@');
                    } else {
                        varObj = await this.miDebugger.varCreate(parentVarReference, symOrExpr, gdbVarName, '@', threadId, frameId);
                    }
                    varId = this.findOrCreateVariable(varObj);
                    varObj.exp = symOrExpr;
                    varObj.id = varId;
                } else if (!varObj) {
                    throw updateError || new Error('updateOrCreateVariable: unknown error');
                }
            }
            catch (err) {
                if (isFloating) {
                    if (this.args.showDevDebugOutput) {
                        this.handleMsg('stderr', `Could not create global/static variable ${symOrExpr}\n`);
                        this.handleMsg('stderr', `Error: ${err}\n`);
                    }
                    varObj = null;
                } else {
                    throw err;
                }
            }
            
            if (isFloating && varObj) {
                this.putFloatingVariable(parentVarReference, symOrExpr, varObj);
            }
            return varObj?.toProtocolVariable(displayName || varObj.name);
        }
        catch (err) {
            const ret: DebugProtocol.Variable = {
                name: symOrExpr,
                value: `<${err}>`,
                variablesReference: 0
            };
            return ret;
        }
    }

    private async globalVariablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): Promise<void> {
        const symbolInfo: SymbolInformation[] = this.symbolTable.getGlobalVariables();
        const globals: DebugProtocol.Variable[] = [];
        try {
            for (const symbol of symbolInfo) {
                const varObjName = `global_var_${symbol.name}`;
                const tmp = await this.updateOrCreateVariable(symbol.name, symbol.name, varObjName, args.variablesReference, -1, -1, true);
                globals.push(tmp);
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
            let staticNames = file ? await this.symbolTable.getStaticVariableNames(file) : null;
            if (!staticNames) {
                file = frame.fileName;
                staticNames = file ? await this.symbolTable.getStaticVariableNames(file) : [];
            }

            const hasher = crypto.createHash('sha256');
            hasher.update(file || '');
            const fHash = hasher.digest('hex');

            if (os.platform() === 'win32') {
                file = file.replace(/\\/g, '/');
            }

            for (const displayName of staticNames) {
                const exprName = `'${file}'::${displayName}`;
                const varObjName = this.createStaticVarName(fHash, displayName);
                const tmp = await this.updateOrCreateVariable(displayName, exprName, varObjName, args.variablesReference, threadId, frameId, true);
                statics.push(tmp);
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
        response.body = { variables: [] };
        if (!this.isMIStatusStopped() || !this.stopped || this.disableSendStoppedEvents || this.continuing) {
            this.sendResponse(response);
            return;
        }
        const [threadId, frameId] = decodeReference(args.variablesReference);
        const variables: DebugProtocol.Variable[] = [];
        let stack: Variable[];
        try {
            // Don't think we need the following anymore after gdb 9.x
            // await this.miDebugger.sendCommand(`stack-select-frame --thread ${threadId} ${frameId}`);
            stack = await this.miDebugger.getStackVariables(threadId, frameId);
            for (const variable of stack) {
                const varObjName = this.createStackVarName(variable.name, args.variablesReference);
                const tmp = await this.updateOrCreateVariable(variable.name, variable.name, varObjName, args.variablesReference, threadId, frameId, false);
                variables.push(tmp);
            }
            response.body = {
                variables: variables
            };
            this.sendResponse(response);
        }
        catch (err) {
            if (this.isMIStatusStopped()) {     // Between the time we asked for a info, a continue occurred
                this.sendErrorResponse(response, 1, `Could not get stack variables: ${err}`);
            } else {
                this.sendResponse(response);
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
        response.body = { variables: [] };
        if (!this.isMIStatusStopped() || !this.stopped || this.disableSendStoppedEvents || this.continuing) {
            this.sendResponse(response);
            return;
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
        if (args.variablesReference === HandleRegions.GLOBAL_HANDLE_ID) {
            return this.globalVariablesRequest(response, args);
        } else if (args.variablesReference >= HandleRegions.STATIC_HANDLES_START && args.variablesReference <= HandleRegions.STATIC_HANDLES_FINISH) {
            const [threadId, frameId] = decodeReference(args.variablesReference);
            return this.staticVariablesRequest(threadId, frameId, response, args);
        } else if (args.variablesReference >= HandleRegions.STACK_HANDLES_START && args.variablesReference <= HandleRegions.STACK_HANDLES_FINISH) {
            return this.stackVariablesRequest(response, args);
        } else if (args.variablesReference >= HandleRegions.REG_HANDLE_START && args.variablesReference <= HandleRegions.REG_HANDLE_FINISH) {
            return this.registersRequest(response, args);
        } else {
            id = this.variableHandles.get(args.variablesReference);

            if (typeof id === 'string') {
                return this.variableMembersRequest(id, response, args);
            }
            else if (typeof id === 'object') {
                if (id instanceof VariableObject) {
                    const pVar = id as VariableObject;

                    // Variable members
                    let children: VariableObject[];
                    const childMap: { [name: string]: number } = {};
                    try {
                        children = await this.miDebugger.varListChildren(args.variablesReference, id.name);
                        const vars = children.map((child) => {
                            const varId = this.findOrCreateVariable(child);
                            child.id = varId;
                            if (/^\d+$/.test(child.exp)) {
                                child.fullExp = `${pVar.fullExp || pVar.exp}[${child.exp}]`;
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
                                    pVar.children[child.exp] = child.name;
                                }
                                child.fullExp = `${pVar.fullExp || pVar.exp}${suffix}`;
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
                            try {
                                const variable = await this.miDebugger.evalExpression(JSON.stringify(`${varReq.name}+${arrIndex})`), -1, -1);
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

    protected async pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments): Promise<void> {
        try {
            if (this.args.ctiOpenOCDConfig?.enabled && this.args.ctiOpenOCDConfig?.pauseCommands && this.serverController.ctiStopResume) {
                this.serverController.ctiStopResume(CTIAction.pause);
            } else {
                const done = await this.miDebugger.interrupt();
            }
            this.sendResponse(response);
        }
        catch (msg) {
            this.sendErrorResponse(response, 3, `Could not pause: ${msg}`);
        }
    }

    protected async continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): Promise<void> {
        try {
            if (this.args.ctiOpenOCDConfig?.enabled && this.args.ctiOpenOCDConfig?.resumeCommands && this.serverController.ctiStopResume) {
                this.serverController.ctiStopResume(CTIAction.resume);
            } else {
                const done = await this.miDebugger.continue(args.threadId);
            }
            response.body = { allThreadsContinued: true };
            this.sendResponse(response);
        }
        catch (msg) {
            this.sendErrorResponse(response, 2, `Could not continue: ${msg}`);
        }
    }

    protected async stepInRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): Promise<void> {
        try {
            const assemblyMode = args.granularity === 'instruction';
            const done = await this.miDebugger.step(args.threadId, assemblyMode);
            this.sendResponse(response);
        }
        catch (msg) {
            this.sendErrorResponse(response, 6, `Could not step over: ${msg}`);
        }
    }

    protected async stepOutRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): Promise<void> {
        try {
            const done = await this.miDebugger.stepOut(args.threadId);
            this.sendResponse(response);
        }
        catch (msg) {
            this.sendErrorResponse(response, 5, `Could not step out: ${msg}`);
        }
    }

    protected async nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): Promise<void> {
        try {
            const assemblyMode = args.granularity === 'instruction';
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

    public isBusy() {
        return !this.stopped || this.continuing || (this.miDebugger.status === 'running') || this.sendDummyStackTrace;
    }

    public busyError(response: DebugProtocol.Response, args: any) {
        if (this.args.showDevDebugOutput) {
            this.handleMsg('log', `Info: Received ${response.command} request while busy. ${JSON.stringify(args)}\n`);
        }
        response.message = 'notStopped';
        this.sendErrorResponse(response, 8, 'Busy', undefined, ErrorDestination.Telemetry);
    }

    private evaluateQ = new RequestQueue<DebugProtocol.EvaluateResponse, DebugProtocol.EvaluateArguments>();
    protected evaluateRequest(r: DebugProtocol.EvaluateResponse, a: DebugProtocol.EvaluateArguments): Promise<void> {
        a.context = a.context || 'hover';       // Not sure who is calling with an undefined context
        if (a.context !== 'repl') {
            if (this.isBusy()) {
                this.busyError(r, a);
                return Promise.resolve();
            }
        }

        const doit = (response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments) => {
            return new Promise<void>(async (resolve) => {
                if (this.isBusy() && (a.context !== 'repl')) {
                    this.busyError(response, args);
                    resolve();
                    return;
                }
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
                // we don't have a way to specify global scope ... use floating variable.
                let threadId = this.stoppedThreadId || 1;
                let frameId = 0;
                if (args.frameId !== undefined) {     // Should always be valid
                    [threadId, frameId] = decodeReference(args.frameId);
                }

                if (args.context !== 'repl') {
                    try {
                        const exp = args.expression;
                        const hasher = crypto.createHash('sha256');
                        hasher.update(exp);
                        if (args.frameId !== undefined) {
                            hasher.update(args.frameId.toString(16));
                        }
                        const exprName = hasher.digest('hex');
                        const varObjName = `${args.context}_${exprName}`;
                        let varObj: VariableObject;
                        let varId = this.variableHandlesReverse[varObjName];
                        let createNewVar = varId === undefined;
                        let updateError;
                        if (!createNewVar) {
                            try {
                                const changes = await this.miDebugger.varUpdate(varObjName, threadId, frameId);
                                const changelist = changes.result('changelist');
                                for (const change of changelist || []) {
                                    const inScope = MINode.valueOf(change, 'in_scope');
                                    if (inScope === 'true') {
                                        const name = MINode.valueOf(change, 'name');
                                        const vId = this.variableHandlesReverse[name];
                                        const v = this.variableHandles.get(vId) as any;
                                        v.applyChanges(change);
                                    } else {
                                        const msg = `${exp} currently not in scope`;
                                        await this.miDebugger.sendCommand(`var-delete ${varObjName}`);
                                        if (this.args.showDevDebugOutput) {
                                            this.handleMsg('log', `Expression ${msg}. Will try to create again\n`);
                                        }
                                        createNewVar = true;
                                        throw new Error(msg);
                                    }
                                }
                                varObj = this.variableHandles.get(varId) as any;
                            }
                            catch (err) {
                                updateError = err;
                            }
                        }
                        if (!this.isBusy() && (createNewVar || ((updateError instanceof MIError && updateError.message === VarNotFoundMsg)))) {
                            // We always create a floating variable so it will be updated in the context of the current frame
                            // Technicall, we should be able to bind this to this frame but for some reason gdb gets confused
                            // from previous stack frames and returns the wrong results or says nothing changed when in fact it has
                            if (args.frameId === undefined) {
                                varObj = await this.miDebugger.varCreate(0, exp, varObjName, '@');  // Create floating variable
                            } else {
                                varObj = await this.miDebugger.varCreate(0, exp, varObjName, '@', threadId, frameId);
                            }

                            varId = findOrCreateVariable(varObj);
                            varObj.exp = exp;
                            varObj.id = varId;
                        } else if (!varObj) {
                            throw updateError || new Error('evaluateRequest: unknown error');
                        }
                        response.body = varObj.toProtocolEvaluateResponseBody();
                        this.sendResponse(response);
                    }
                    catch (err) {
                        if (this.isBusy()) {
                            this.busyError(response, args);
                        } else {
                            response.body = {
                                result: (args.context === 'hover') ? null : `<${err.toString()}>`,
                                variablesReference: 0
                            };
                            this.sendResponse(response);
                            if (this.args.showDevDebugOutput) {
                                this.handleMsg('stderr', args.context + ' ' + err.toString());
                            }
                        }
                        // this.sendErrorResponse(response, 7, err.toString());
                    }
                    finally {
                        resolve();
                    }
                } else {        // This is an 'repl'
                    if (args.expression.startsWith('+') && this.miLiveGdb) {
                        args.expression = args.expression.substring(1);
                        this.miLiveGdb.evaluateRequest(r, args).finally(() => {
                            resolve();
                        });
                        return;
                    }
                    try {
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
                            resolve();
                        }, (msg) => {
                            this.sendErrorResponse(response, 8, msg.toString());
                            resolve();
                        });
                    }
                    catch (e) {
                        this.sendErrorResponse(response, 8, e.toString());
                        resolve();
                    }
                }
            });
        };

        return this.evaluateQ.add(doit, r, a);
    }

    protected async gotoTargetsRequest(response: DebugProtocol.GotoTargetsResponse, args: DebugProtocol.GotoTargetsArguments): Promise<void> {
        try {
            const done = await this.miDebugger.goto(args.source.path, args.line);
            if (!done) {
                this.sendErrorResponse(response, 16, `Could not jump to: ${args.source.path}:${args.line}`);
            } else {
                response.body = {
                    targets: [{
                        id: 1,
                        label: args.source.name,
                        column: args.column,
                        line: args.line
                    }]
                };
                this.sendResponse(response);
            }
        }
        catch (msg) {
            this.sendErrorResponse(response, 16, `Could not jump to: ${msg ? msg : ''} ${args.source.path}:${args.line}`);
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

function initTwoCharsToIntMap(): object {
    const obj = {};
    for (let i = 0; i < 256; i++) {
        const key = i.toString(16).padStart(2, '0');
        obj[key] = i;
    }
    return obj;
}

const twoCharsToIntMap = initTwoCharsToIntMap();

LoggingDebugSession.run(GDBDebugSession);
