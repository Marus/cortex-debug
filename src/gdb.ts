import { MI2DebugSession } from './mibase';
import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, Thread, StackFrame, Scope, Source, Handles } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { MI2 } from "./backend/mi2/mi2";
import { hexFormat } from './frontend/utils';
import { TelemetryEvent, ConfigurationArguments, GDBServerController, AdapterOutputEvent, SWOConfigureEvent } from './common';
import { GDBServer } from './backend/server';

import * as portastic from 'portastic';
import * as os from 'os';
import { setTimeout } from 'timers';

import { JLinkServerController } from './jlink';
import { OpenOCDServerController } from './openocd';
import { STUtilServerController } from './stutil';
import { PyOCDServerController } from './pyocd';
import { BMPServerController } from './bmp';

const SERVER_TYPE_MAP = {
	'jlink': JLinkServerController,
	'openocd': OpenOCDServerController,
	'stutil': STUtilServerController,
	'pyocd': PyOCDServerController,
	'bmp': BMPServerController
};

export class GDBDebugSession extends MI2DebugSession {
	private server: GDBServer;
	private args: ConfigurationArguments;
	private ports: { [name: string]: number };
	private serverController: GDBServerController;

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
		this.processLaunchAttachRequest(response, false);
	}

	protected attachRequest(response: DebugProtocol.AttachResponse, args: ConfigurationArguments): void {
		args.graphConfig = args.graphConfig || [];
		this.args = args;
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

			let defaultGDBExecutable = 'arm-none-eabi-gdb';
			if(os.platform() == 'win32') {
				defaultGDBExecutable = 'arm-none-eabi-gdb.exe';
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

				this.miDebugger = new MI2(this.args.gdbpath || defaultGDBExecutable, gdbargs);
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
}

DebugSession.run(GDBDebugSession);