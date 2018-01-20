import { DebugProtocol } from 'vscode-debugprotocol';
import { TelemetryEvent, GDBServerController, ConfigurationArguments, SWOConfigureEvent } from './common';
import * as os from 'os';
import * as tmp from 'tmp';
import * as ChildProcess from 'child_process'
import { EventEmitter } from 'events';

export class OpenOCDServerController extends EventEmitter implements GDBServerController {
	public portsNeeded = ['gdbPort'];
	public name = 'OpenOCD';
	private swoPath: string;
	private args: ConfigurationArguments;
	private ports: { [name: string]: number };

	constructor() {
		super();
		this.swoPath = tmp.tmpNameSync();
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
			`target-select extended-remote localhost:${gdbport}`,
			'interpreter-exec console "monitor reset halt"',
			'target-download',
			'interpreter-exec console "monitor reset halt"',
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
		let commands = [
			'exec-interrupt',
			'interpreter-exec console "monitor reset halt"',
			'exec-step-instruction'
		];

		if (this.args.swoConfig.enabled) {
			let swocommands = this.SWOConfigurationCommands();
			commands.push(...swocommands);
		}

		return commands;
	}

	private SWOConfigurationCommands(): string[] {
		return [];
	}

	public serverExecutable(): string {
		if (this.args.serverpath) { return this.args.serverpath; }
		else {
			return os.platform() === "win32" ? 'openocd.exe' : 'openocd';
		}
	}

	public serverArguments(): string[] {
		let gdbport = this.ports['gdbPort'];

		let serverargs = [];

		this.args.configFiles.forEach((cf, idx) => {
			serverargs.push('-f');
			serverargs.push(cf);
		});

		let commands = [`gdb_port ${gdbport}`];

		if(this.args.swoConfig.enabled) {
			if(os.platform() !== 'win32') { // Use FIFO on non-windows platforms
				
			}

			commands.push(`tpiu config internal ${this.swoPath} uart off ${this.args.swoConfig.cpuFrequency} ${this.args.swoConfig.swoFrequency}`);
		}

		serverargs.push('-c');
		serverargs.push(commands.join('; '));

		return serverargs;
	}

	public initMatch(): RegExp {
		return /Info\s:\s([^\n\.]*)\.cpu([^\n]*)/i;
	}

	public serverLaunchStarted(): void {
		if (os.platform() !== 'win32') {
			let mkfifoReturn = ChildProcess.spawnSync('mkfifo', [this.swoPath]);
			this.emit('event', new SWOConfigureEvent({ type: 'openocd', path: this.swoPath }));
		}
	}

	public serverLaunchCompleted(): void {
		if (os.platform() === 'win32') {
			this.emit('event', new SWOConfigureEvent({ type: 'openocd', path: this.swoPath }));
		}
	}

	public debuggerLaunchStarted(): void {}
	public debuggerLaunchCompleted(): void {}
}
