import { DebugProtocol } from 'vscode-debugprotocol';
import { TelemetryEvent, GDBServerController, ConfigurationArguments, calculatePortMask, SWOConfigureEvent } from './common';
import * as os from 'os';
import { EventEmitter } from 'events';

export class JLinkServerController extends EventEmitter implements GDBServerController {
	public portsNeeded: string[] = ['gdbPort', 'swoPort', 'consolePort'];
	public name: 'J-Link';

	private args: ConfigurationArguments;
	private ports: { [name: string]: number };

	constructor() {
		super();
	}

	public setPorts(ports: { [name: string]: number }): void {
		this.ports = ports;
	}

	public setArguments(args: ConfigurationArguments): void {
		this.args = args;
	}

	public customRequest(command: string, response: DebugProtocol.Response, args: any): boolean {
		return false;
	}
	
	public launchCommands(): string[] {
		let gdbport = this.ports['gdbPort'];

		let commands = [
			`interpreter-exec console "source ${this.args.extensionPath}/support/gdbsupport.init"`,
			`target-select extended-remote localhost:${gdbport}`,
			'interpreter-exec console "monitor halt"',
			'interpreter-exec console "monitor reset"',
			'target-download',
			'interpreter-exec console "monitor reset"',
			'enable-pretty-printing'
		];

		if (this.args.swoConfig.enabled) {
			let swocommands = this.SWOConfigurationCommands();
			commands.push(...swocommands);
		}

		return commands;
	}

	public attachCommands(): string[] {
		let gdbport = this.ports['gdbPort'];

		let commands = [
			`interpreter-exec console "source ${this.args.extensionPath}/support/gdbsupport.init"`,
			`target-select extended-remote localhost:${gdbport}`,
			'interpreter-exec console "monitor halt"',
			'enable-pretty-printing'
		];

		if (this.args.swoConfig.enabled) {
			let swocommands = this.SWOConfigurationCommands();
			commands.push(...swocommands);
		}
		
		return commands;
	}

	public restartCommands(): string[] {
		let commands: string[] = [
			'exec-interrupt',
			'interpreter-exec console "monitor halt"',
			'interpreter-exec console "monitor reset"',
			// 'exec-step-instruction'
		];

		if (this.args.swoConfig.enabled) {
			let swocommands = this.SWOConfigurationCommands();
			commands.push(...swocommands);
		}

		return commands;
	}



	private SWOConfigurationCommands(): string[] {
		let portMask = calculatePortMask(this.args.swoConfig.decoders).toString(16);
		let swoFrequency = this.args.swoConfig.swoFrequency | 0;
		let cpuFrequency = this.args.swoConfig.cpuFrequency | 0;
		
		let commands: string[] = [
			`monitor SWO EnableTarget ${cpuFrequency} ${swoFrequency} ${portMask} 0`,
			`DisableITMPorts 0xFFFFFFFF`,
			`EnableITMPorts ${portMask}`,
			`EnableDWTSync`,
			`ITMSyncEnable`
		];

		commands.push(this.args.swoConfig.profile ? 'EnablePCSample' : 'DisablePCSample');
		
		return commands.map(c => `interpreter-exec console "${c}"`);
	}

	public serverExecutable() {
		if (this.args.serverpath) { return this.args.serverpath; }
		else {
			return os.platform() == 'win32' ? 'JLinkGDBServer.exe' : 'JLinkGDBServer';
		}
	}
	
	public serverArguments(): string[] {
		let gdbport = this.ports['gdbPort'];
		let swoport = this.ports['swoPort'];
		let consoleport = this.ports['consolePort'];

		let cmdargs = ['-if', 'swd', '-port', gdbport.toString(), '-swoport', swoport.toString(), '-telnetport', consoleport.toString(), '-device', this.args.device];
		if(this.args.serialNumber) {
			cmdargs.push('-select');
			cmdargs.push(`usb=${this.args.serialNumber}`);
		}
		else if(this.args.ipAddress) {
			cmdargs.push('-select');
			cmdargs.push(`ip=${this.args.ipAddress}`);
		}

		return cmdargs;
	}

	public initMatch(): RegExp {
		return /Waiting for GDB connection\.\.\./g;
	}

	public serverLaunchStarted(): void {}
	public serverLaunchCompleted(): void {
		this.emit('event', new SWOConfigureEvent({ type: 'jlink', port: this.ports['swoPort'] }));
	}
	public debuggerLaunchStarted(): void {}
	public debuggerLaunchCompleted(): void {}
}

