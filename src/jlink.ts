import { GDBDebugSession } from './gdb';
import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, Thread, StackFrame, Scope, Source, Handles, Event } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { JLink } from './backend/jlink';
import { MI2 } from "./backend/mi2/mi2";
import { AdapterOutputEvent, SWOConfigureEvent } from './common';
import * as portastic from 'portastic';
import * as os from 'os';

export interface ConfigurationArguments extends DebugProtocol.LaunchRequestArguments {
	gdbpath: string;
	executable: string;
	cwd: string;
	jlinkpath: string;
	device: string;
	debugger_args: string[];
	showDevDebugOutput: boolean;
	svdFile: string;
	swoConfig: any;
	graphConfig: any;
	ipAddress: string;
	serialNumber: string;
}

class JLinkGDBDebugSession extends GDBDebugSession {
	protected jlink : JLink;
	private args: ConfigurationArguments;
	private gdbPort: number;
	private swoPort: number;
	private consolePort: number;

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: ConfigurationArguments): void {
		args.swoConfig = args.swoConfig || { enabled: false, cpuFrequency: 0, swoFrequency: 0 };
		args.graphConfig = args.graphConfig || [];
		this.args = args;
		this.processLaunchAttachRequest(response, args, false);
	}

	protected attachRequest(response: DebugProtocol.AttachResponse, args: ConfigurationArguments): void {
		args.swoConfig = args.swoConfig || { enabled: false, cpuFrequency: 0, swoFrequency: 0 };
		args.graphConfig = args.graphConfig || [];
		this.args = args;
		this.processLaunchAttachRequest(response, args, true);
	}
	
	private processLaunchAttachRequest(response: DebugProtocol.LaunchResponse, args: ConfigurationArguments, attach: boolean) {
		this.quit = false;
		this.attached = false;
		this.started = false;
		this.crashed = false;
		this.debugReady = false;
		
		portastic.find({ min: 50000, max: 52000, retrieve: 3 }).then(ports => {
			this.gdbPort = ports[0];
			this.swoPort = ports[1];
			this.consolePort = ports[2];

			let defaultExecutable = 'JLinkGDBServer';
			let defaultGDBExecutable = 'arm-none-eabi-gdb';
			if(os.platform() == 'win32') {
				defaultExecutable = 'JLinkGDBServer.exe';
				defaultGDBExecutable = 'arm-none-eabi-gdb.exe';
			}

			this.jlink = new JLink(args.jlinkpath || defaultExecutable, args.device, this.gdbPort, this.swoPort, this.consolePort, args.ipAddress, args.serialNumber);
			this.jlink.on('jlink-output', this.handleJLinkOutput.bind(this));
			this.jlink.on('jlink-stderr', this.handleJLinkErrorOutput.bind(this));
			
			this.jlink.on("launcherror", (err) => {
				this.sendErrorResponse(response, 103, `Failed to launch J-Link GDB Server: ${err.toString()}`);
			});
			this.jlink.on("quit", () => {
				if (this.started) {
					this.quitEvent.bind(this)
				}
				else {
					this.sendErrorResponse(response, 103, `J-Link GDB Server Quit Unexpectedly. See Adapter Output for more details.`);
				}
			});

			let timeout = null;

			this.jlink.on('jlink-init', () => {
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
					if(args.swoConfig.enabled) {
						this.sendEvent(new SWOConfigureEvent('jlink', { port: this.swoPort }));
					}
					
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
					});
				}, err => {
					this.sendErrorResponse(response, 103, `Failed to launch GDB: ${err.toString()}`);
				});
			});
			
			this.jlink.init().then(_ => {}, _ => {});
			
			timeout = setTimeout(() => {
				this.jlink.exit();
				this.sendErrorResponse(response, 103, `Failed to launch JLink Server: Timeout.`);
			}, 10000);
		}, err => {
			this.sendErrorResponse(response, 103, `Failed to launch JLink Server: ${err.toString()}`);
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

		if(args.swoConfig.enabled) {
			let portMask = '0x' + this.calculatePortMask(args.swoConfig.ports).toString(16);
			let swoFrequency = args.swoConfig.swoFrequency | 0;
			let cpuFrequency = args.swoConfig.cpuFrequency | 0;

			let command = `monitor SWO EnableTarget ${cpuFrequency} ${swoFrequency} ${portMask} 0`;
			commands.push(`interpreter-exec console "${command}"`);
		}

		return commands;
	}

	protected attachCommands(gdbport: number, args: ConfigurationArguments): string[] {
		let commands = [
			`target-select extended-remote localhost:${gdbport}`,
			'interpreter-exec console "monitor halt"',
			'enable-pretty-printing'
		];

		if(args.swoConfig.enabled) {
			let portMask = '0x' + this.calculatePortMask(args.swoConfig.ports).toString(16);
			let swoFrequency = args.swoConfig.swoFrequency | 0;
			let cpuFrequency = args.swoConfig.cpuFrequency | 0;

			let command = `monitor SWO EnableTarget ${cpuFrequency} ${swoFrequency} ${portMask} 0`;
			commands.push(`interpreter-exec console "${command}"`);
		}

		return commands;
	}

	protected restartCommands(): string[] {
		return [
			'exec-interrupt',
			'interpreter-exec console "monitor halt"',
			'interpreter-exec console "monitor reset"',
			'exec-continue'
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

		try { this.jlink.stop(); }
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

	protected handleJLinkOutput(output) {
		this.sendEvent(new AdapterOutputEvent(output, 'out'));
	}

	protected handleJLinkErrorOutput(output) {
		this.sendEvent(new AdapterOutputEvent(output, 'err'));
	}

	protected customRequest(command: string, response: DebugProtocol.Response, args: any): void {
		switch(command) {
			case 'get-arguments':
				response.body = {
					type: 'jlink',
					GDBPort: this.gdbPort,
					SWOPort: this.swoPort,
					ConsolePort: this.consolePort,
					device: this.args.device,
					SVDFile: this.args.svdFile,
					SWOConfig: this.args.swoConfig,
					GraphConfig: this.args.graphConfig
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

DebugSession.run(JLinkGDBDebugSession);