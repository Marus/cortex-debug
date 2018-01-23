import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, ContinuedEvent, OutputEvent, Thread, StackFrame, Scope, Source, Handles, Event } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { MI2 } from "./backend/mi2/mi2";
import { hexFormat } from './frontend/utils';
import { Breakpoint, IBackend, Variable, VariableObject, MIError } from './backend/backend';
import { TelemetryEvent, ConfigurationArguments, GDBServerController, AdapterOutputEvent, SWOConfigureEvent } from './common';
import { GDBServer } from './backend/server';
import { MINode } from './backend/mi_parse';
import { expandValue, isExpandable } from './backend/gdb_expansion';
import * as portastic from 'portastic';
import * as os from 'os';
import * as net from 'net';
import * as path from 'path';
import { setTimeout } from 'timers';

import { JLinkServerController } from './jlink';
import { OpenOCDServerController } from './openocd';
import { STUtilServerController } from './stutil';
import { PyOCDServerController } from './pyocd';
import { BMPServerController } from './bmp';
import { SymbolTable } from './backend/symbols';
import { SymbolInformation, SymbolScope, SymbolType } from './symbols';

const SERVER_TYPE_MAP = {
	'jlink': JLinkServerController,
	'openocd': OpenOCDServerController,
	'stutil': STUtilServerController,
	'pyocd': PyOCDServerController,
	'bmp': BMPServerController
};

class ExtendedVariable {
	constructor(public name, public options) {
	}
}

const GLOBAL_HANDLE_ID = 10;
const STACK_HANDLES_START = 1000;
const STATIC_HANDLES_START = 2000;
const VAR_HANDLES_START = 10000;

class CustomStoppedEvent extends Event implements DebugProtocol.Event {
	body: {
		reason: string,
		threadID: number
	};
	event: string;

	constructor(reason: string, threadID: number) {
		super('custom-stop', { reason: reason, threadID: threadID });
	}
}

class CustomContinuedEvent extends Event implements DebugProtocol.Event {
	body: {
		threadID: number;
		allThreads: boolean;
	}
	event: string;

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
	protected threadID: number = 1;
	protected commandServer: net.Server;
	
	private currentFile: string;

	public constructor(debuggerLinesStartAt1: boolean, isServer: boolean = false, threadID: number = 1) {
		super(debuggerLinesStartAt1, isServer);
		this.threadID = threadID;
	}

	protected initDebugger() {
		this.miDebugger.on("launcherror", this.launchError.bind(this));
		this.miDebugger.on("quit", this.quitEvent.bind(this));
		this.miDebugger.on("exited-normally", this.quitEvent.bind(this));
		this.miDebugger.on("stopped", this.stopEvent.bind(this));
		this.miDebugger.on("msg", this.handleMsg.bind(this));
		this.miDebugger.on("breakpoint", this.handleBreakpoint.bind(this));
		this.miDebugger.on("step-end", this.handleBreak.bind(this));
		this.miDebugger.on("step-out-end", this.handleBreak.bind(this));
		this.miDebugger.on("signal-stop", this.handlePause.bind(this));
		this.miDebugger.on("running", this.handleRunning.bind(this));
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
		args.graphConfig = args.graphConfig || [];
		this.args = args;
		this.symbolTable = new SymbolTable(args.toolchainPath, args.executable);
		this.symbolTable.loadSymbols();
		this.processLaunchAttachRequest(response, false);
	}

	protected attachRequest(response: DebugProtocol.AttachResponse, args: ConfigurationArguments): void {
		args.graphConfig = args.graphConfig || [];
		this.args = args;
		this.symbolTable = new SymbolTable(args.toolchainPath, args.executable);
		this.symbolTable.loadSymbols();
		this.processLaunchAttachRequest(response, true);
	}

	private processLaunchAttachRequest(response: DebugProtocol.LaunchResponse, attach: boolean) {
		let ControllerClass = SERVER_TYPE_MAP[this.args.servertype];
		this.serverController = new ControllerClass();
		this.serverController.setArguments(this.args);
		this.serverController.on('event', this.serverControllerEvent.bind(this));
		
		this.quit = false;
		this.attached = false;
		this.started = false;
		this.crashed = false;
		this.debugReady = false;
		
		portastic.find({ min: 50000, max: 52000, retrieve: this.serverController.portsNeeded.length }).then(ports => {
			this.ports = {};
			this.serverController.portsNeeded.forEach((val, idx) => {
				this.ports[val] = ports[idx];
			});

			this.serverController.setPorts(this.ports);

			let executable = this.serverController.serverExecutable();
			let args = this.serverController.serverArguments();

			let gdbExePath = os.platform() !== 'win32' ? 'arm-none-eabi-gdb' : 'arm-none-eabi-gdb.exe';
			if (this.args.toolchainPath) {
				gdbExePath = path.normalize(path.join(this.args.toolchainPath, gdbExePath));
			}

			this.server = new GDBServer(executable, args, this.serverController.initMatch());
			this.server.on('output', this.handleAdapterOutput.bind(this));
			this.server.on('quit', () => {
				if (this.started) {
					this.quitEvent();
				}
				else {
					this.sendErrorResponse(response, 103, `${this.serverController.name} GDB Server Quit Unexpectedly. See Adapter Output for more details.`);
				}
			});
			this.server.on('launcherror', (err) => {
				this.sendErrorResponse(response, 103, `Failed to launch ${this.serverController.name} GDB Server: ${err.toString()}`);
			});

			let timeout = setTimeout(() => {
				this.server.exit();
				this.sendEvent(new TelemetryEvent('error-launching', { error: `Failed to launch ${this.serverController.name} GDB Server: Timeout.` }, {}));
				this.sendErrorResponse(response, 103, `Failed to launch ${this.serverController.name} GDB Server: Timeout.`);
			}, 10000);

			this.serverController.serverLaunchStarted();
			this.server.init().then((started) => {
				if(timeout) {
					clearTimeout(timeout);
					timeout = null;
				}

				this.serverController.serverLaunchCompleted();
				
				let gdbargs = ["-q", "--interpreter=mi2"];
				gdbargs = gdbargs.concat(this.args.debuggerArgs || []);

				this.miDebugger = new MI2(gdbExePath, gdbargs);
				this.initDebugger();

				this.miDebugger.printCalls = !!this.args.showDevDebugOutput;
				this.miDebugger.debugOutput = !!this.args.showDevDebugOutput;

				let commands = attach ? this.serverController.attachCommands() : this.serverController.launchCommands();

				this.serverController.debuggerLaunchStarted();
				this.miDebugger.connect(this.args.cwd, this.args.executable, commands).then(() => {
					setTimeout(() => {
						this.miDebugger.emit('ui-break-done');
					}, 50);

					this.serverController.debuggerLaunchCompleted();

					this.miDebugger.start().then(() => {
						this.started = true;
						this.sendResponse(response);
						
						if (this.crashed)
							this.handlePause(undefined);
					}, err => {
						this.sendErrorResponse(response, 100, `Failed to launch GDB: ${err.toString()}`);
						this.sendEvent(new TelemetryEvent('error-launching-gdb', { error: err.toString() }, {}));
					});
				}, (err) => {
					this.sendErrorResponse(response, 103, `Failed to launch GDB: ${err.toString()}`);
					this.sendEvent(new TelemetryEvent('error-launching-gdb', { error: err.toString() }, {}));
				});

			}, (error) => {
				if(timeout) {
					clearTimeout(timeout);
					timeout = null;
				}
				this.sendEvent(new TelemetryEvent('error-launching', { error: error.toString() }, {}));
				this.sendErrorResponse(response, 103, `Failed to launch ${this.serverController.name} GDB Server: ${error.toString()}`);
			});
			
		}, err => {
			this.sendEvent(new TelemetryEvent('error-launching', { error: err.toString() }, {}));
			this.sendErrorResponse(response, 103, `Failed to find open ports: ${err.toString()}`);
		});
	}

	protected customRequest(command: string, response: DebugProtocol.Response, args: any): void {
		if (this.serverController.customRequest(command, response, args)) {
			this.sendResponse(response);
			return;
		}

		switch(command) {
			case 'load-function-symbols':
				response.body = { functionSymbols: this.symbolTable.getFunctionSymbols() };
				this.sendResponse(response);
				break;
			case 'get-arguments':
				response.body = this.args;
				this.sendResponse(response);
				break;
			case 'read-memory':
				this.readMemoryRequest(response, args['address'], args['length']);	
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
			case 'execute-command':
				let cmd = args['command'] as string;
				if(cmd.startsWith('-')) { cmd = cmd.substring(1); }
				else { cmd = `interpreter-exec console "${cmd}"`; }
				this.miDebugger.sendCommand(cmd).then(node => {
					response.body = node.resultRecords;
					this.sendResponse(response);
				}, error => {
					response.body = error;
					this.sendErrorResponse(response, 110, "Unable to execute command");
				});
				break;
			default:
				response.body = { 'error': 'Invalid command.' };
				this.sendResponse(response);
				break;
		}
	}

	protected readMemoryRequest(response: DebugProtocol.Response, startAddress: number, length: number) {
		let address = hexFormat(startAddress, 8);
		this.miDebugger.sendCommand(`data-read-memory-bytes ${address} ${length}`).then(node => {
			let startAddress = node.resultRecords.results[0][1][0][0][1];
			let endAddress = node.resultRecords.results[0][1][0][2][1];
			let data = node.resultRecords.results[0][1][0][3][1];
			let bytes = data.match(/[0-9a-f]{2}/g).map(b => parseInt(b, 16));
			response.body = {
				startAddress: startAddress,
				endAddress: endAddress,
				bytes: bytes
			};
			this.sendResponse(response);
		}, error => {
			response.body = { 'error': error };
			this.sendErrorResponse(response, 114, `Unable to read memory: ${error.toString()}`);
			this.sendEvent(new TelemetryEvent('error-reading-memory', { address: startAddress.toString(), length: length.toString() }, {}));
		});
	}

	protected writeMemoryRequest(response: DebugProtocol.Response, startAddress: number, data: string) {
		let address = hexFormat(startAddress, 8);
		this.miDebugger.sendCommand(`data-write-memory-bytes ${address} ${data}`).then(node => {
			this.sendResponse(response);
		}, error => {
			response.body = { 'error': error };
			this.sendErrorResponse(response, 114, `Unable to write memory: ${error.toString()}`);
			this.sendEvent(new TelemetryEvent('error-writing-memory', { address: startAddress.toString(), length: data.length.toString() }, {}));
		});
	}

	protected readRegistersRequest(response: DebugProtocol.Response) {
		this.miDebugger.sendCommand('data-list-register-values x').then(node => {
			if (node.resultRecords.resultClass == 'done') {
				let rv = node.resultRecords.results[0][1];
				response.body = rv.map(n => {
					let val = {};
					n.forEach(x => {
						val[x[0]] = x[1];
					});
					return val;
				});
			}
			else {
				response.body = {
					'error': 'Unable to parse response'
				}
			}
			this.sendResponse(response);	
		}, error => {
			response.body = { 'error': error };
			this.sendErrorResponse(response, 115, `Unable to read registers: ${error.toString()}`);
			this.sendEvent(new TelemetryEvent('error-reading-registers', {}, {}));
		});
	}

	protected readRegisterListRequest(response: DebugProtocol.Response) {
		this.miDebugger.sendCommand('data-list-register-names').then(node => {
			if (node.resultRecords.resultClass == 'done') {
				let registerNames;
				node.resultRecords.results.forEach(rr => {
					if (rr[0] == 'register-names') {
						registerNames = rr[1];
					}
				});
				response.body = registerNames;
			}
			else {
				response.body = { 'error': node.resultRecords.results };
			}
			this.sendResponse(response);
		}, error => {
			response.body = { 'error': error };
			this.sendErrorResponse(response, 116, `Unable to read register list: ${error.toString()}`);
			this.sendEvent(new TelemetryEvent('error-reading-register-list', {}, {}));
		});
	}

	protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
		if(this.miDebugger) {
			if (this.attached)
				this.miDebugger.detach();
			else
				this.miDebugger.stop();
		}
		if(this.commandServer) {
			this.commandServer.close();
			this.commandServer = undefined;
		}

		try { this.server.exit(); }
		catch(e) {}

		this.sendResponse(response);
	}

	protected restartRequest(response: DebugProtocol.RestartResponse, args: DebugProtocol.RestartArguments): void {
		let commands = this.serverController.restartCommands();

		this.miDebugger.restart(commands).then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 6, `Could not restart: ${msg}`);
		})
	}

	protected handleAdapterOutput(output) {
		this.sendEvent(new AdapterOutputEvent(output, 'out'));
	}

	private serverControllerEvent(event: DebugProtocol.Event) {
		this.sendEvent(event);
	}

	protected handleMsg(type: string, msg: string) {
		if (type == "target")
			type = "stdout";
		if (type == "log")
			type = "stderr";
		this.sendEvent(new OutputEvent(msg, type));
	}

	protected handleRunning(info: MINode) {
		this.sendEvent(new ContinuedEvent(this.threadID, true));
		this.sendEvent(new CustomContinuedEvent(this.threadID, true));
	}

	protected handleBreakpoint(info: MINode) {

		this.sendEvent(new StoppedEvent("breakpoint", this.threadID));
		this.sendEvent(new CustomStoppedEvent("breakpoint", this.threadID));
	}

	protected handleBreak(info: MINode) {
		this.sendEvent(new StoppedEvent("step", this.threadID));
		this.sendEvent(new CustomStoppedEvent("step", this.threadID));
	}

	protected handlePause(info: MINode) {
		this.sendEvent(new StoppedEvent("user request", this.threadID));
		this.sendEvent(new CustomStoppedEvent("user request", this.threadID));
	}

	protected stopEvent(info: MINode) {
		if (!this.started)
			this.crashed = true;
		if (!this.quit) {
			this.sendEvent(new StoppedEvent("exception", this.threadID));
			this.sendEvent(new CustomStoppedEvent("exception", this.threadID));
		}
	}

	protected quitEvent() {
		this.quit = true;
		this.sendEvent(new TerminatedEvent());
	}

	protected launchError(err: any) {
		this.handleMsg("stderr", "Could not start debugger process, does the program exist in filesystem?\n");
		this.handleMsg("stderr", err.toString() + "\n");
		this.quitEvent();
	}

	protected async setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments): Promise<void> {
		try {
			let name = args.name;
			if (args.variablesReference >= VAR_HANDLES_START) {
				const parent = this.variableHandles.get(args.variablesReference) as VariableObject;
				name = `${parent.name}.${name}`;
			}

			let res = await this.miDebugger.varAssign(name, args.value);
			response.body = {
				value: res.result("value")
			};
			this.sendResponse(response);
		}
		catch (err) {
			this.sendErrorResponse(response, 11, `Could not continue: ${err}`);
		};
	}

	protected setFunctionBreakPointsRequest(response: DebugProtocol.SetFunctionBreakpointsResponse, args: DebugProtocol.SetFunctionBreakpointsArguments): void {
		let cb = (() => {
			this.debugReady = true;
			let all = [];
			args.breakpoints.forEach(brk => {
				all.push(this.miDebugger.addBreakPoint({ raw: brk.name, condition: brk.condition, countCondition: brk.hitCondition }));
			});
			Promise.all(all).then(brkpoints => {
				let finalBrks = [];
				brkpoints.forEach(brkp => {
					if (brkp[0])
						finalBrks.push({ line: brkp[1].line });
				});
				response.body = {
					breakpoints: finalBrks
				};
				this.sendResponse(response);
			}, msg => {
				this.sendErrorResponse(response, 10, msg.toString());
			});
		}).bind(this);
		if (this.debugReady)
			cb();
		else
			this.miDebugger.once("debug-ready", cb);
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
		let cb = (() => {
			this.debugReady = true;
			this.miDebugger.clearBreakPoints().then(() => {
				let path = args.source.path;
				let all = [];
				args.breakpoints.forEach(brk => {
					all.push(this.miDebugger.addBreakPoint({ file: path, line: brk.line, condition: brk.condition, countCondition: brk.hitCondition }));
				});
				Promise.all(all).then(brkpoints => {
					let finalBrks = [];
					brkpoints.forEach(brkp => {
						if (brkp[0])
							finalBrks.push({ line: brkp[1].line, verified: true });
					});
					response.body = {
						breakpoints: finalBrks
					};
					this.sendResponse(response);
					
				}, msg => {
					this.sendErrorResponse(response, 9, msg.toString());
				});
			}, msg => {
				this.sendErrorResponse(response, 9, msg.toString());
			});
		}).bind(this);

		if (this.debugReady)
			cb();
		else
			this.miDebugger.once("debug-ready", cb);
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		response.body = {
			threads: [
				new Thread(this.threadID, "Thread 1")
			]
		};
		this.sendResponse(response);
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
		this.miDebugger.getStack(args.levels).then(stack => {
			let ret: StackFrame[] = [];
			stack.forEach(element => {
				let file = element.file;
				if (file) {
					ret.push(new StackFrame(element.level, element.function + "@" + element.address, new Source(element.fileName, file), element.line, 0));
				}
				else
					ret.push(new StackFrame(element.level, element.function + "@" + element.address, null, element.line, 0));
			});
			response.body = {
				stackFrames: ret
			};
			this.sendResponse(response);
		}, err => {
			this.sendErrorResponse(response, 12, `Failed to get Stack Trace: ${err.toString()}`)
		});
	}

	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		this.sendResponse(response);
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
		const scopes = new Array<Scope>();
		scopes.push(new Scope("Local", STACK_HANDLES_START + (parseInt(args.frameId as any) || 0), false));
		scopes.push(new Scope('Global', GLOBAL_HANDLE_ID, false));
		scopes.push(new Scope('Static', STATIC_HANDLES_START + (parseInt(args.frameId as any) || 0), false));

		response.body = {
			scopes: scopes
		};
		this.sendResponse(response);
	}

	private async globalVariablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): Promise<void> {
		let symbolInfo: SymbolInformation[] = this.symbolTable.getGlobalVariables();

		let globals: DebugProtocol.Variable[] = [];
		try {
			for (let symbol of symbolInfo) {
				let varObjName = `global_var_${symbol.name}`;
				let varObj: VariableObject;
				try {
					const changes = await this.miDebugger.varUpdate(varObjName);
					const changelist = changes.result("changelist");
					changelist.forEach((change) => {
						const name = MINode.valueOf(change, "name");
						const vId = this.variableHandlesReverse[name];
						const v = this.variableHandles.get(vId) as any;
						v.applyChanges(change);
					});
					const varId = this.variableHandlesReverse[varObjName];
					varObj = this.variableHandles.get(varId) as any;
				}
				catch (err) {
					if (err instanceof MIError && err.message == "Variable object not found") {
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

	private async staticVariablesRequest(frameId: number, response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): Promise<void> {
		let statics: DebugProtocol.Variable[] = [];

		try {
			let frame = await this.miDebugger.getFrame(this.threadID, frameId);
			let file = frame.fileName;
			let staticSymbols = this.symbolTable.getStaticVariables(file);
			
			for (let symbol of staticSymbols) {
				let varObjName = `${file}_static_var_${symbol.name}`;
				let varObj: VariableObject;
				try {
					const changes = await this.miDebugger.varUpdate(varObjName);
					const changelist = changes.result("changelist");
					changelist.forEach((change) => {
						const name = MINode.valueOf(change, "name");
						const vId = this.variableHandlesReverse[name];
						const v = this.variableHandles.get(vId) as any;
						v.applyChanges(change);
					});
					const varId = this.variableHandlesReverse[varObjName];
					varObj = this.variableHandles.get(varId) as any;
				}
				catch (err) {
					if (err instanceof MIError && err.message == "Variable object not found") {
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
		if (options)
			return this.variableHandles.create(new ExtendedVariable(arg, options));
		else
			return this.variableHandles.create(arg);
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

	private async stackVariablesRequest(frameId: number, response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): Promise<void> {
		const variables: DebugProtocol.Variable[] = [];
		let stack: Variable[];
		try {
			stack = await this.miDebugger.getStackVariables(this.threadID, frameId);
			for (const variable of stack) {
				try {
					let varObjName = `var_${variable.name}`;
					let varObj: VariableObject;
					try {
						const changes = await this.miDebugger.varUpdate(varObjName);
						const changelist = changes.result("changelist");
						changelist.forEach((change) => {
							const name = MINode.valueOf(change, "name");
							const vId = this.variableHandlesReverse[name];
							const v = this.variableHandles.get(vId) as any;
							v.applyChanges(change);
						});
						const varId = this.variableHandlesReverse[varObjName];
						varObj = this.variableHandles.get(varId) as any;
					}
					catch (err) {
						if (err instanceof MIError && err.message == "Variable object not found") {
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
				let expanded = expandValue(this.createVariable.bind(this), variable.result("value"), id, variable);
				if (!expanded) {
					this.sendErrorResponse(response, 2, `Could not expand variable`);
				}
				else {
					if (typeof expanded[0] == "string")
						expanded = [
							{
								name: "<value>",
								value: prettyStringArray(expanded),
								variablesReference: 0
							}
						];
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
		else if (args.variablesReference >= STATIC_HANDLES_START && args.variablesReference < VAR_HANDLES_START) {
			return this.staticVariablesRequest(args.variablesReference - STATIC_HANDLES_START, response, args);
		}
		else if (args.variablesReference >= STACK_HANDLES_START && args.variablesReference < STATIC_HANDLES_START) {
			return this.stackVariablesRequest(args.variablesReference - STACK_HANDLES_START, response, args);
		}
		else {
			id = this.variableHandles.get(args.variablesReference);

			if (typeof id == "string") {
				return this.variableMembersRequest(id, response, args);
			}
			else if (typeof id == "object") {
				if (id instanceof VariableObject) {
					const variables: DebugProtocol.Variable[] = [];

					// Variable members
					let children: VariableObject[];
					try {
						children = await this.miDebugger.varListChildren(id.name);
						const vars = children.map(child => {
							const varId = this.findOrCreateVariable(child);
							child.id = varId;
							return child.toProtocolVariable();
						});

						response.body = {
							variables: vars
						}
						this.sendResponse(response);
					}
					catch (err) {
						this.sendErrorResponse(response, 1, `Could not expand variable: ${err}`);
					}
				}
				else if (id instanceof ExtendedVariable) {
					const variables: DebugProtocol.Variable[] = [];

					let varReq = id;
					if (varReq.options.arg) {
						let strArr = [];
						let argsPart = true;
						let arrIndex = 0;
						let submit = () => {
							response.body = {
								variables: strArr
							};
							this.sendResponse(response);
						};
						let addOne = async () => {
							const variable = await this.miDebugger.evalExpression(JSON.stringify(`${varReq.name}+${arrIndex})`));
							try {
								let expanded = expandValue(this.createVariable.bind(this), variable.result("value"), varReq.name, variable);
								if (!expanded) {
									this.sendErrorResponse(response, 15, `Could not expand variable`);
								}
								else {
									if (typeof expanded == "string") {
										if (expanded == "<nullptr>") {
											if (argsPart)
												argsPart = false;
											else
												return submit();
										}
										else if (expanded[0] != '"') {
											strArr.push({
												name: "[err]",
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
											name: "[err]",
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
					else
						this.sendErrorResponse(response, 13, `Unimplemented variable request options: ${JSON.stringify(varReq.options)}`);
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
		this.miDebugger.interrupt().then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 3, `Could not pause: ${msg}`);
		});
	}


	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this.miDebugger.continue().then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 2, `Could not continue: ${msg}`);
		});
	}

	protected stepInRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this.miDebugger.step().then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 4, `Could not step in: ${msg}`);
		});
	}

	protected stepOutRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this.miDebugger.stepOut().then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 5, `Could not step out: ${msg}`);
		});
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this.miDebugger.next().then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 6, `Could not step over: ${msg}`);
		});
	}

	protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): Promise<void> {
		let createVariable = (arg, options?) => {
			if (options)
				return this.variableHandles.create(new ExtendedVariable(arg, options));
			else
				return this.variableHandles.create(arg);
		};

		let findOrCreateVariable = (varObj: VariableObject): number => {
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

		if (args.context == 'watch') {
			try {
				let exp = args.expression;
				let varObjName = `watch_${exp}`;
				let varObj: VariableObject;
				try {
					const changes = await this.miDebugger.varUpdate(varObjName);
					const changelist = changes.result("changelist");
					changelist.forEach((change) => {
						const name = MINode.valueOf(change, "name");
						const vId = this.variableHandlesReverse[name];
						const v = this.variableHandles.get(vId) as any;
						v.applyChanges(change);
					});
					const varId = this.variableHandlesReverse[varObjName];
					varObj = this.variableHandles.get(varId) as any;
					response.body = {
						result: varObj.value,
						variablesReference: varObj.id,
					}
				}
				catch (err) {
					if (err instanceof MIError && err.message == "Variable object not found") {
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
				}
				this.sendErrorResponse(response, 7, err.toString());	
			}
		}
		else if (args.context == "hover") {
			try {
				var res = await this.miDebugger.evalExpression(args.expression);
				response.body = {
					variablesReference: 0,
					result: res.result('value')
				};
				this.sendResponse(response);
			}
			catch(e) {
				this.sendErrorResponse(response, 7, e.toString());
			}
		}
		else {
			this.miDebugger.sendUserInput(args.expression).then(output => {
				if (typeof output == "undefined")
					response.body = {
						result: "",
						variablesReference: 0
					};
				else
					response.body = {
						result: JSON.stringify(output),
						variablesReference: 0
					};
				this.sendResponse(response);
			}, msg => {
				this.sendErrorResponse(response, 8, msg.toString());
			});
		}
	}
}

function prettyStringArray(strings) {
	if (typeof strings == "object") {
		if (strings.length !== undefined)
			return strings.join(", ");
		else
			return JSON.stringify(strings);
	}
	else return strings;
}


DebugSession.run(GDBDebugSession);