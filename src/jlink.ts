import { GDBDebugSession } from './gdb';
import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, Thread, StackFrame, Scope, Source, Handles, Event } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { ValuesFormattingMode } from './backend/backend';
import { JLink } from './backend/jlink';
import { MI2 } from "./backend/mi2/mi2";
import * as portastic from 'portastic';


class JLinkOutputEvent extends Event implements DebugProtocol.Event {
	body: {
		type: string,
		content: string
	};
	event: string;

	constructor(content: string, type: string) {
		super('jlink-output', { content: content, type: type });
	}
}

interface ConfigurationArguments {
	executable: string;
	svdPath: string;
	device: string;
	swoConfig: any;
	graphConfig: any;
}

export interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	gdbpath: string;
	executable: string;
	cwd: string;
	jlinkpath: string;
	device: string;
	debugger_args: string[];
	valuesFormatting: ValuesFormattingMode;
	showDevDebugOutput: boolean;
	svdPath: string;
	swoConfig: any;
	graphConfig: any;
}

export interface AttachRequestArguments extends DebugProtocol.AttachRequestArguments {
	gdbpath: string;
	executable: string;
	cwd: string;
	jlinkpath: string;
	device: string;
	debugger_args: string[];
	valuesFormatting: ValuesFormattingMode;
	showDevDebugOutput: boolean;
	svdPath: string;
	swoConfig: any;
	graphConfig: any;
}

class JLinkGDBDebugSession extends GDBDebugSession {
	protected jlink : JLink;
	private args: ConfigurationArguments;
	private gdbPort: number;
	private swoPort: number;
	private consolePort: number;

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
		this.args = args;

		portastic.find({ min: 50000, max: 52000, retrieve: 3 }).then(ports => {
			this.gdbPort = ports[0];
			this.swoPort = ports[1];
			this.consolePort = ports[2];

			this.jlink = new JLink(args.jlinkpath || "JLinkGDBServer", args.device, this.gdbPort, this.swoPort, this.consolePort, undefined);
			this.jlink.on('jlink-output', this.handleJLinkOutput.bind(this));
			this.jlink.on('jlink-stderr', this.handleJLinkErrorOutput.bind(this));
			this.jlink.on("launcherror", this.launchError.bind(this));
			this.jlink.on("quit", this.quitEvent.bind(this));
			
			this.quit = false;
			this.attached = false;
			this.needContinue = false;
			this.started = false;
			this.crashed = false;
			this.debugReady = false;
			
			this.jlink.init().then(_ => {
				this.miDebugger = new MI2(args.gdbpath || "arm-none-eabi-gdb", ["-q", "--interpreter=mi2"], args.debugger_args);
				this.initDebugger();
	
				this.setValuesFormattingMode(args.valuesFormatting);
				this.miDebugger.printCalls = !!args.showDevDebugOutput;
				this.miDebugger.debugOutput = !!args.showDevDebugOutput
				
				this.miDebugger.connect(args.cwd, args.executable, this.launchCommands(this.gdbPort, args)).then(() => {
					// if (args.autorun)
					// 	args.autorun.forEach(command => {
					// 		this.miDebugger.sendUserInput(command);
					// 	});
					
					setTimeout(() => {
						this.miDebugger.emit("ui-break-done");
					}, 50);
	
					this.sendResponse(response);
					this.miDebugger.start().then(() => {
						this.started = true;
						if (this.crashed)
							this.handlePause(undefined);
					}, err => {
						this.sendErrorResponse(response, 100, `Failed to Start MI Debugger: ${err.toString()}`);
					});
				}, err => {
					this.sendErrorResponse(response, 103, `Failed to load MI Debugger: ${err.toString()}`);
				});			
			}, err => {
				this.sendErrorResponse(response, 103, `Failed to launch JLink Server: ${err.toString()}`);
			});
		}, error => {
			console.log('Unable to launch');
			this.sendErrorResponse(response, 103, `Failed to launch JLink Server: ${error.toString()}`);
		});
	}

	protected attachRequest(response: DebugProtocol.AttachResponse, args: AttachRequestArguments): void {
		this.args = args;
		
		portastic.find({ min: 50000, max: 52000, retrieve: 3 }).then(ports => {
			this.gdbPort = ports[0];
			this.swoPort = ports[1];
			this.consolePort = ports[2];

			this.jlink = new JLink(args.jlinkpath || "JLinkGDBServer", args.device, this.gdbPort, this.swoPort, this.consolePort, undefined);
			this.jlink.on('jlink-output', this.handleJLinkOutput.bind(this));
			this.jlink.on('jlink-stderr', this.handleJLinkErrorOutput.bind(this));
			this.jlink.on("launcherror", this.launchError.bind(this));
			this.jlink.on("quit", this.quitEvent.bind(this));
			
			this.quit = false;
			this.attached = false;
			this.needContinue = false;
			this.started = false;
			this.crashed = false;
			this.debugReady = false;
			
			this.jlink.init().then(_ => {
				this.miDebugger = new MI2(args.gdbpath || "arm-none-eabi-gdb", ["-q", "--interpreter=mi2"], args.debugger_args);
				this.initDebugger();
	
				this.setValuesFormattingMode(args.valuesFormatting);
				this.miDebugger.printCalls = !!args.showDevDebugOutput;
				this.miDebugger.debugOutput = !!args.showDevDebugOutput
				
				this.miDebugger.connect(args.cwd, args.executable, this.launchCommands(this.gdbPort, args)).then(() => {
					// if (args.autorun)
					// 	args.autorun.forEach(command => {
					// 		this.miDebugger.sendUserInput(command);
					// 	});
					
					setTimeout(() => {
						this.miDebugger.emit("ui-break-done");
					}, 50);
	
					this.sendResponse(response);
					this.miDebugger.start().then(() => {
						this.started = true;
						if (this.crashed)
							this.handlePause(undefined);
					}, err => {
						this.sendErrorResponse(response, 100, `Failed to Start MI Debugger: ${err.toString()}`);
					});
				}, err => {
					this.sendErrorResponse(response, 103, `Failed to load MI Debugger: ${err.toString()}`);
				});			
			}, err => {
				this.sendErrorResponse(response, 103, `Failed to launch JLink Server: ${err.toString()}`);
			});
		}, error => {
			console.log('Unable to launch');
			this.sendErrorResponse(response, 103, `Failed to launch JLink Server: ${error.toString()}`);
		});
	}

	protected launchCommands(gdbport: number, args: LaunchRequestArguments): string[] {
		let commands = [
			`target-select extended-remote localhost:${gdbport}`,
			'interpreter-exec console "monitor halt"',
			'interpreter-exec console "monitor reset"',
			'target-download',
			'interpreter-exec console "monitor reset"'
		];

		if(args.valuesFormatting == 'prettyPrinters') {
			commands.push('enable-pretty-printing');
		}

		if(args.swoConfig.enabled) {
			let portMask = '0x' + this.calculatePortMask(args.swoConfig.ports).toString(16);
			let swoFrequency = args.swoConfig.swoFrequency | 0;
			let cpuFrequency = args.swoConfig.cpuFrequency | 0;

			let command = `monitor SWO EnableTarget ${cpuFrequency} ${swoFrequency} ${portMask} 0`;
			commands.push(`interpreter-exec console "${command}"`);
		}

		return commands;
	}

	protected attachCommands(gdbport: number, args: AttachRequestArguments): string[] {
		let commands = [
			`target-select extended-remote localhost:${gdbport}`,
			'interpreter-exec console "monitor halt"',
		];

		if(args.valuesFormatting == 'prettyPrinters') {
			commands.push('enable-pretty-printing');
		}

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

	protected handleJLinkOutput(output) {
		this.sendEvent(new JLinkOutputEvent(output, 'out'));
	}

	protected handleJLinkErrorOutput(output) {
		this.sendEvent(new JLinkOutputEvent(output, 'err'));
	}

	protected customRequest(command: string, response: DebugProtocol.Response, args: any): void {
		switch(command) {
			case 'get-arguments':
				response.body = {
					GDBPort: this.gdbPort,
					SWOPort: this.swoPort,
					ConsolePort: this.consolePort,
					device: this.args.device,
					SVDPath: this.args.svdPath,
					SWOConfig: this.args.swoConfig
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