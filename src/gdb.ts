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
    protected currentThreadId: number = 0;
    
    private stopped: boolean = false;
    private stoppedReason: string = '';

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
        this.symbolTable = new SymbolTable(args.toolchainPath, args.toolchainPrefix, args.executable);
        this.symbolTable.loadSymbols();
        this.breakpointMap = new Map();
        this.fileExistsCache = new Map();
        this.processLaunchAttachRequest(response, false);
    }

    protected attachRequest(response: DebugProtocol.AttachResponse, args: ConfigurationArguments): void {
        this.args = this.normalizeArguments(args);
        this.symbolTable = new SymbolTable(args.toolchainPath, args.toolchainPrefix, args.executable);
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

            if (this.args.showDevDebugOutput) {
                this.handleMsg('log', `Please check OUTPUT tab (Adapter Output) for log of ${executable}` + '\n');
                const dbgMsg = `Launching server: "${executable}" ` + args.map((s) => `"${s}"`).join(' ') + '\n';
                this.handleMsg('log', dbgMsg);
            }

            let initMatch = this.serverController.initMatch();
            if (this.args.overrideGDBServerStartedRegex) {
                initMatch = new RegExp(this.args.overrideGDBServerStartedRegex, 'i');
            }

            this.server = new GDBServer(executable, args, initMatch, this.ports['gdbPort']);
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
                
                this.serverController.debuggerLaunchStarted();
                this.miDebugger.once('debug-ready', () => {
                    this.debugReady = true;
                });
                this.miDebugger.connect(this.args.cwd, this.args.executable, commands).then(() => {
                    this.started = true;
                    this.serverController.debuggerLaunchCompleted();
                    this.sendResponse(response);

                    const launchComplete = () => {
                        setTimeout(() => {
                            this.stopped = true;
                            this.stoppedReason = 'start';
                            this.sendEvent(new StoppedEvent('start', this.currentThreadId, true));
                            this.sendEvent(new CustomStoppedEvent('start', this.currentThreadId));
                        }, 50);
                    };


                    if (!this.args.stopOnEntry) {

                        setTimeout(() => {
                            this.stopped = false;
                            this.miDebugger.sendCommand('exec-continue');
                        }, 100);

                    } else if (this.args.runToMain) {
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

    protected readMemoryRequestCustom(response: DebugProtocol.Response, startAddress: number, length: number) {
        const address = hexFormat(startAddress, 8);
        this.miDebugger.sendCommand(`data-read-memory-bytes ${address} ${length}`).then((node) => {
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
            this.sendEvent(new TelemetryEvent('Error', 'Reading Memory', `${startAddress.toString(16)}-${length.toString(16)}`));
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
        this.miDebugger.sendCommand('data-list-register-values N').then((node) => {
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
        if (this.miDebugger) {
            if (this.attached) { this.miDebugger.detach(); }
            else { this.miDebugger.stop(); }
        }
        if (this.commandServer) {
            this.commandServer.close();
            this.commandServer = undefined;
        }

        try { this.server.exit(); }
        catch (e) {}

        this.sendResponse(response);
    }

    protected restartRequest(response: DebugProtocol.RestartResponse, args: DebugProtocol.RestartArguments): void {
        const restartProcessing = () => {
            const commands = [];

            commands.push(...this.args.preRestartCommands.map(COMMAND_MAP));
            const restartCommands = this.args.overrideRestartCommands != null ?
                this.args.overrideRestartCommands.map(COMMAND_MAP) : this.serverController.restartCommands();
            commands.push(...restartCommands);
            commands.push(...this.args.postRestartCommands.map(COMMAND_MAP));

            this.miDebugger.restart(commands).then((done) => {
                this.sendResponse(response);

                if(this.args.stopOnEntry) {
                    setTimeout(() => {
                        this.stopped = true;
                        this.stoppedReason = 'restart';
                        this.sendEvent(new ContinuedEvent(this.currentThreadId, true));
                        this.sendEvent(new StoppedEvent('restart', this.currentThreadId, true));
                    }, 50);
                } else {
                    setTimeout(() => {
                        this.stopped = false;
                        this.miDebugger.sendCommand('exec-continue');
                    }, 100);
                }

            }, (msg) => {
                this.sendErrorResponse(response, 6, `Could not restart: ${msg}`);
            });
        };

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

    protected handleBreakpoint(info: MINode) {
        this.stopped = true;
        this.stoppedReason = 'breakpoint';
        this.sendEvent(new StoppedEvent('breakpoint', this.currentThreadId, true));
        this.sendEvent(new CustomStoppedEvent('breakpoint', this.currentThreadId));
    }

    protected handleBreak(info: MINode) {
        this.stopped = true;
        this.stoppedReason = 'step';
        this.sendEvent(new StoppedEvent('step', this.currentThreadId, true));
        this.sendEvent(new CustomStoppedEvent('step', this.currentThreadId));
    }

    protected handlePause(info: MINode) {
        this.stopped = true;
        this.stoppedReason = 'user request';
        this.sendEvent(new StoppedEvent('user request', this.currentThreadId, true));
        this.sendEvent(new CustomStoppedEvent('user request', this.currentThreadId));
    }

    protected handleThreadCreated(info: { threadId: number, threadGroupId: number }) {
        this.sendEvent(new ThreadEvent('started', info.threadId));
    }

    protected handleThreadExited(info: { threadId: number, threadGroupId: number }) {
        this.sendEvent(new ThreadEvent('exited', info.threadId));
    }

    protected handleThreadSelected(info: { threadId: number }) {
        this.currentThreadId = info.threadId;
        this.sendEvent(new ThreadEvent('selected', info.threadId));
    }

    protected stopEvent(info: MINode) {
        if (!this.started) { this.crashed = true; }
        if (!this.quit) {
            this.stopped = true;
            this.stoppedReason = 'exception';
            this.sendEvent(new StoppedEvent('exception', this.currentThreadId, true));
            this.sendEvent(new CustomStoppedEvent('exception', this.currentThreadId));
        }
    }

    protected quitEvent() {
        this.quit = true;
        this.sendEvent(new TerminatedEvent());
    }

    protected launchError(err: any) {
        this.handleMsg('stderr', 'Could not start debugger process, does the program exist in filesystem?\n');
        this.handleMsg('stderr', err.toString() + '\n');
        this.quitEvent();
    }

    protected async setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments): Promise<void> {
        try {
            let name = args.name;
            if (args.variablesReference >= VAR_HANDLES_START) {
                const parent = this.variableHandles.get(args.variablesReference) as VariableObject;
                name = `${parent.name}.${name}`;
            }

            const res = await this.miDebugger.varAssign(name, args.value);
            response.body = {
                value: res.result('value')
            };
            this.sendResponse(response);
        }
        catch (err) {
            this.sendErrorResponse(response, 11, `Could not continue: ${err}`);
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
                    const parts = path.split('::');
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
        if (!this.stopped) {
            response.body = { threads: [] };
            this.sendResponse(response);
        }
        try {
            const threadIdNode = await this.miDebugger.sendCommand('thread-list-ids');
            const threadIds: number[] = threadIdNode.result('thread-ids').map((ti) => parseInt(ti[1]));
            const currentThread = threadIdNode.result('current-thread-id');

            if (!currentThread) {
                await this.miDebugger.sendCommand(`thread-select ${threadIds[0]}`);
                this.currentThreadId = threadIds[0];
            }
            else {
                this.currentThreadId = parseInt(currentThread);
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
                const stackId = (args.threadId << 8 | (element.level & 0xFF)) & 0xFFFF;
                const file = element.file;
                let disassemble = this.forceDisassembly || !file;
                if (!disassemble) { disassemble = !(await this.checkFileExists(file)); }
                if (!disassemble && this.activeEditorPath && this.activeEditorPath.startsWith('disassembly:///')) {
                    const symbolInfo = this.symbolTable.getFunctionByName(element.function, element.fileName);
                    let url: string;
                    if (symbolInfo) {
                        if (symbolInfo.scope !== SymbolScope.Global) {
                            url = `disassembly:///${symbolInfo.file}::${symbolInfo.name}.cdasm`;
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
                            let url: string;
                            if (symbolInfo.scope !== SymbolScope.Global) {
                                fname = `${symbolInfo.file}::${symbolInfo.name}.cdasm`;
                                url = `disassembly:///${symbolInfo.file}::${symbolInfo.name}.cdasm`;
                            }
                            else {
                                fname = `${symbolInfo.name}.cdasm`;
                                url = `disassembly:///${symbolInfo.name}.cdasm`;
                            }
                            
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
        scopes.push(new Scope('Static', STATIC_HANDLES_START + parseInt(args.frameId as any), false));

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
                    const changes = await this.miDebugger.varUpdate(varObjName);
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
                        varObj = await this.miDebugger.varCreate(symbol.name, varObjName);
                        const varId = this.findOrCreateVariable(varObj);
                        varObj.exp = symbol.name;
                        varObj.id = varId;
                    }
                    else {
                        throw err;
                    }
                }

                globals.push(varObj.toProtocolVariable());
            }

            response.body = { variables: globals };
            this.sendResponse(response);
        }
        catch (err) {
            this.sendErrorResponse(response, 1, `Could not get global variable information: ${err}`);
        }
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
            
            for (const symbol of staticSymbols) {
                const varObjName = `${file}_static_var_${symbol.name}`;
                let varObj: VariableObject;
                try {
                    const changes = await this.miDebugger.varUpdate(varObjName);
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
                        varObj = await this.miDebugger.varCreate(symbol.name, varObjName);
                        const varId = this.findOrCreateVariable(varObj);
                        varObj.exp = symbol.name;
                        varObj.id = varId;
                    }
                    else {
                        throw err;
                    }
                }

                statics.push(varObj.toProtocolVariable());
            }

            response.body = { variables: statics };
            this.sendResponse(response);
        }
        catch (err) {
            this.sendErrorResponse(response, 1, `Could not get global variable information: ${err}`);
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

    private async stackVariablesRequest(
        threadId: number,
        frameId: number,
        response: DebugProtocol.VariablesResponse,
        args: DebugProtocol.VariablesArguments
    ): Promise<void> {
        const variables: DebugProtocol.Variable[] = [];
        let stack: Variable[];
        try {
            stack = await this.miDebugger.getStackVariables(threadId, frameId);
            for (const variable of stack) {
                try {
                    const varObjName = `var_${variable.name}`;
                    let varObj: VariableObject;
                    try {
                        const changes = await this.miDebugger.varUpdate(varObjName);
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
                            varObj = await this.miDebugger.varCreate(variable.name, varObjName);
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
            variable = await this.miDebugger.evalExpression(JSON.stringify(id));
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
        
        if (args.variablesReference === GLOBAL_HANDLE_ID) {
            return this.globalVariablesRequest(response, args);
        }
        else if (args.variablesReference >= STATIC_HANDLES_START && args.variablesReference <= STATIC_HANDLES_FINISH) {
            const frameId = args.variablesReference & 0xFF;
            const threadId = (args.variablesReference & 0xFF00) >>> 8;
            return this.staticVariablesRequest(threadId, frameId, response, args);
        }
        else if (args.variablesReference >= STACK_HANDLES_START && args.variablesReference < STACK_HANDLES_FINISH) {
            const frameId = args.variablesReference & 0xFF;
            const threadId = (args.variablesReference & 0xFF00) >>> 8;
            return this.stackVariablesRequest(threadId, frameId, response, args);
        }
        else {
            id = this.variableHandles.get(args.variablesReference);

            if (typeof id === 'string') {
                return this.variableMembersRequest(id, response, args);
            }
            else if (typeof id === 'object') {
                if (id instanceof VariableObject) {
                    const pvar = id as VariableObject;
                    const variables: DebugProtocol.Variable[] = [];

                    // Variable members
                    let children: VariableObject[];
                    try {
                        children = await this.miDebugger.varListChildren(id.name);
                        const vars = children.map((child) => {
                            const varId = this.findOrCreateVariable(child);
                            child.id = varId;
                            if (/^\d+$/.test(child.exp)) {
                                child.fullExp = `${pvar.fullExp || pvar.exp}[${child.exp}]`;
                            }
                            else {
                                child.fullExp = `${pvar.fullExp || pvar.exp}.${child.exp}`;
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
                            const variable = await this.miDebugger.evalExpression(JSON.stringify(`${varReq.name}+${arrIndex})`));
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

    protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.ContinueArguments): void {
        this.miDebugger.interrupt(args.threadId).then((done) => {
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
                    if (symbolInfo.scope !== SymbolScope.Global) {
                        url = `disassembly:///${symbolInfo.file}::${symbolInfo.name}.cdasm`;
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
                    if (symbolInfo.scope !== SymbolScope.Global) {
                        url = `disassembly:///${symbolInfo.file}::${symbolInfo.name}.cdasm`;
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

        if (args.context === 'watch') {
            try {
                const exp = args.expression;
                const hasher = crypto.createHash('sha256');
                hasher.update(exp);
                const watchName = hasher.digest('hex');
                const varObjName = `watch_${watchName}`;
                let varObj: VariableObject;
                try {
                    const changes = await this.miDebugger.varUpdate(varObjName);
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
                        varObj = await this.miDebugger.varCreate(exp, varObjName);
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
                const res = await this.miDebugger.evalExpression(args.expression);
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
