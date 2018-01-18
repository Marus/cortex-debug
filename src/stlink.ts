import { GDBDebugSession } from './gdb';
import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, Thread, StackFrame, Scope, Source, Handles, Event } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { STLink } from './backend/stlink';
import { MI2 } from "./backend/mi2/mi2";
import { AdapterOutputEvent, SWOConfigureEvent } from './common';
import * as portastic from 'portastic';
import * as os from 'os';
import { TelemetryEvent } from './common';

export interface ConfigurationArguments extends DebugProtocol.LaunchRequestArguments {
	gdbpath: string;
	executable: string;
	cwd: string;
	device: string;
	stutilpath: string;
	debugger_args: string[];
	showDevDebugOutput: boolean;
	svdFile: string;
}

class STLinkGDBDebugSession extends GDBDebugSession {
	protected stutil : STLink;
	private args: ConfigurationArguments;
	private gdbPort: number;
	private consolePort: number;

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: ConfigurationArguments): void {
		this.args = args;
		this.processLaunchAttachRequest(response, args, false);
	}
	
	private processLaunchAttachRequest(response: DebugProtocol.LaunchResponse, args: ConfigurationArguments, attach: boolean) {
		this.quit = false;
		this.attached = false;
		this.started = false;
		this.crashed = false;
		this.debugReady = false;
		
		portastic.find({ min: 50000, max: 52000, retrieve: 2 }).then(ports => {
			this.gdbPort = ports[0];
			this.consolePort = ports[1];

			let defaultExecutable = 'st-util';	// the name of the program is st-util rather than STLink
			let defaultGDBExecutable = 'arm-none-eabi-gdb';
			if(os.platform() == 'win32') {
				defaultExecutable = 'st-util.exe';
				defaultGDBExecutable = 'arm-none-eabi-gdb.exe';
			}

			this.stutil = new STLink(args.stutilpath || defaultExecutable, this.gdbPort);
			this.stutil.on('stutil-output', this.handleSTUtilOutput.bind(this));
			this.stutil.on('stutil-stderr', this.handleSTUtilErrorOutput.bind(this));
			
			this.stutil.on("launcherror", (err) => {
				this.sendErrorResponse(response, 103, `Failed to launch STLink GDB Server: ${err.toString()}`);
			});
			this.stutil.on("quit", () => {
				if (this.started) {
					this.quitEvent.bind(this)
				}
				else {
					this.sendErrorResponse(response, 103, `STLink GDB Server Quit Unexpectedly. See Adapter Output for more details.`);
					this.sendErrorResponse(response, 103, `STLink GDB Server Quit Unexpectedly.`);
				}
			});

			let timeout = null;

			this.stutil.on('stlink-init', () => {
				if(timeout) {
					clearTimeout(timeout);
					timeout = null;
				}

				this.miDebugger = new MI2(args.gdbpath || defaultGDBExecutable, ["-q", "--interpreter=mi2"], args.debugger_args);
				this.initDebugger();
	
				this.miDebugger.printCalls = !!args.showDevDebugOutput;
				this.miDebugger.debugOutput = !!args.showDevDebugOutput

				let commands = attach ? this.attachCommands(this.gdbPort, args) : this.launchCommands(this.gdbPort, args);
				
				this.miDebugger.connect(args.cwd, args.executable, commands).then(() => {
					setTimeout(() => {
						this.miDebugger.emit("ui-break-done");
					}, 50);
	
					this.miDebugger.start().then(() => {
						this.started = true;
						this.sendResponse(response);
						
						if (this.crashed)
							this.handlePause(undefined);
					}, err => {
						this.sendErrorResponse(response, 100, `Failed to launch GDB: ${err.toString()}`);
						this.sendEvent(new TelemetryEvent('error-launching-gdb', { error: err.toString() }, {}));
					});
				}, err => {
					this.sendErrorResponse(response, 103, `Failed to launch GDB: ${err.toString()}`);
					this.sendEvent(new TelemetryEvent('error-launching-gdb', { error: err.toString() }, {}));
				});
			});
			
			this.stutil.init().then(_ => {}, _ => {});
			
			timeout = setTimeout(() => {
				this.stutil.exit();
				this.sendEvent(new TelemetryEvent('error-launching-stlink', { error: `Failed to launch STLink Server: Timeout.` }, {}));
				this.sendErrorResponse(response, 103, `Failed to launch STLink Server: Timeout.`);
			}, 10000);
		}, err => {
			this.sendEvent(new TelemetryEvent('error-launching-stlink', { error: err.toString() }, {}));
			this.sendErrorResponse(response, 103, `Failed to launch STLink Server: ${err.toString()}`);
		});
	}

	protected launchCommands(gdbport: number, args: ConfigurationArguments): string[] {
		let commands = [
			`target-select extended-remote localhost:${gdbport}`,
			'interpreter-exec console "monitor halt"',
			'interpreter-exec console "monitor reset"',
			'target-download',
			'interpreter-exec console "monitor reset"',
			'enable-pretty-printing'
		];

		return commands;
	}

	protected attachCommands(gdbport: number, args: ConfigurationArguments): string[] {
		let commands = [
			`target-select extended-remote localhost:${gdbport}`,
			'interpreter-exec console "monitor halt"',
			'enable-pretty-printing'
		];

		return commands;
	}

	protected restartCommands(): string[] {
		return [
			'exec-interrupt',
			'interpreter-exec console "monitor halt"',
			'interpreter-exec console "monitor reset"',
			'exec-step-instruction'
		];
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

		try { this.stutil.stop(); }
		catch(e) {}

		this.sendResponse(response);
	}

	protected restartRequest(response: DebugProtocol.RestartResponse, args: DebugProtocol.RestartArguments): void {
		let commands = this.restartCommands();

		this.miDebugger.restart(commands).then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 6, `Could not restart: ${msg}`);
		})
	}

	protected handleSTUtilOutput(output) {
		this.sendEvent(new AdapterOutputEvent(output, 'out'));
	}

	protected handleSTUtilErrorOutput(output) {
		this.sendEvent(new AdapterOutputEvent(output, 'err'));
	}

	protected customRequest(command: string, response: DebugProtocol.Response, args: any): void {
		switch(command) {
			case 'get-arguments':
				response.body = {
					type: 'stlink-gdb',
					device: this.args.device,
					GDBPort: this.gdbPort,
					ConsolePort: this.consolePort,
					SVDFile: this.args.svdFile,
					SWOConfig: { enabled: false, cpuFrequency: 0, swoFrequency: 0 },
					GraphConfig: []
				};
				this.sendResponse(response);
				break;
			default:
				super.customRequest(command, response, args);
				break;
		}
	}

	private calculatePortMask(configuration: any[]) {
		let mask: number = 0;
		configuration.forEach(c => {
			mask = (mask | (1 << c.number)) >>> 0;
		});
		return mask;
	}
}

DebugSession.run(STLinkGDBDebugSession);