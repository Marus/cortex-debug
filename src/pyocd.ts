import { DebugProtocol } from 'vscode-debugprotocol';
import { TelemetryEvent, ConfigurationArguments, GDBServerController } from './common';
import * as os from 'os';
import { EventEmitter } from 'events';

export class PyOCDServerController extends EventEmitter implements GDBServerController {
	name: string = 'PyOCD';
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
			'interpreter-exec console "monitor reset halt"',
			'target-download',
			'interpreter-exec console "monitor reset halt"',
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
			'interpreter-exec console "monitor reset"',
			'exec-step-instruction'
		];
	}

	public serverExecutable(): string {
		return this.args.serverpath ? this.args.serverpath : 'pyocd-gdbserver';
	}

	public serverArguments(): string[] {
		let gdbport = this.ports['gdbPort'];

		let serverargs = ['--persist', '--port', gdbport.toString(), '--reset-break'];

		if (this.args.boardId) {
			serverargs.push('--board');
			serverargs.push(this.args.boardId)
		}

		if (this.args.targetId) {
			serverargs.push('--target');
			serverargs.push(this.args.targetId);
		}

		return serverargs;
	}

	public initMatch(): RegExp {
		return /GDB server started at port/;
	}

	public serverLaunchStarted(): void {}
	public serverLaunchCompleted(): void {}
	public debuggerLaunchStarted(): void {}
	public debuggerLaunchCompleted(): void {}
}
