import { DebugProtocol } from 'vscode-debugprotocol';
import { TelemetryEvent,  GDBServerController, ConfigurationArguments } from './common';
import * as os from 'os';
import { EventEmitter } from 'events';

export class STUtilServerController extends EventEmitter implements GDBServerController {
	name: string = 'ST-Util';
	portsNeeded: string[] = ['gdbPort'];

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
			`target-select extended-remote localhost:${gdbport}`,
			'interpreter-exec console "monitor halt"',
			'interpreter-exec console "monitor reset"',
			'target-download',
			'interpreter-exec console "monitor reset"',
			'enable-pretty-printing'
		];

		return commands;
	}

	public attachCommands(): string[] {
		let gdbport = this.ports['gdbPort'];

		let commands = [
			`target-select extended-remote localhost:${gdbport}`,
			'interpreter-exec console "monitor halt"',
			'enable-pretty-printing'
		];

		return commands;
	}

	public restartCommands(): string[] {
		return [
			'exec-interrupt',
			'interpreter-exec console "monitor halt"',
			'interpreter-exec console "monitor reset"',
			'exec-step-instruction'
		];
	}

	public serverExecutable(): string {
		if (this.args.serverpath) { return this.args.serverpath; }
		else { return os.platform() == 'win32' ? 'st-util.exe' : 'st-util'; }
	}

	public serverArguments(): string[] {
		let gdbport = this.ports['gdbPort'];

		let serverargs = ["-p", gdbport.toString(), '-v', '--no-reset'];
		if (this.args.v1) {
			serverargs.push('--stlinkv1');
		}

		return serverargs;
	}

	public initMatch(): RegExp {
		return /Listening at \*/g;
	}

	public serverLaunchStarted(): void {}
	public serverLaunchCompleted(): void {}
	public debuggerLaunchStarted(): void {}
	public debuggerLaunchCompleted(): void {}
}
