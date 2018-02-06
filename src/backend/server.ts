import * as ChildProcess from 'child_process';
import { EventEmitter } from 'events';
import * as portastic from 'portastic';
import { setTimeout } from 'timers';

export class GDBServer extends EventEmitter {
	private process: any;
	private outBuffer: string = "";
	private errBuffer: string = "";
	private initResolve: (result: boolean) => void;
	private initReject: (error: any) => void;

	constructor(private application: string, private args: string[], private initMatch: RegExp) {
		super();
	}

	init(): Thenable<any> {
		return new Promise((resolve, reject) => {
			if (this.application !== null) {
				this.initResolve = resolve;
				this.initReject = reject;

				this.process = ChildProcess.spawn(this.application, this.args, {});
				this.process.stdout.on('data', this.onStdout.bind(this));
				this.process.stderr.on('data', this.onStderr.bind(this));
				this.process.on('exit', this.onExit.bind(this));
				this.process.on('error', this.onError.bind(this));
			}
			resolve();
			// For servers like BMP that are always running directly on the probe
		});
	}

	exit(): void {
		if (this.process) {
			this.process.kill();
		}
	}

	onExit(code, signal) {
		console.log(`${this.application} exit with code: ${code}, signal: ${signal}`);
		this.emit('exit', code, signal);
	}

	onError(err) {
		if (this.initReject) {
			this.initReject(err);
			this.initReject = null;
			this.initResolve = null;
		}

		this.emit('launcherror', err);
	}

	onStdout(data) {
		if (typeof data == 'string') { this.outBuffer += data; }
		else { this.outBuffer += data.toString('utf8'); }

		let match: RegExpMatchArray;
		if (this.initResolve && this.initMatch.test(this.outBuffer)) {
			this.initResolve(true);
			this.initResolve = null;
			this.initReject = null;
		}

		let end = this.outBuffer.lastIndexOf('\n');
		if (end != -1) {
			this.emit('output', this.outBuffer.substring(0, end));
			this.outBuffer = this.outBuffer.substring(end + 1);
		}
	}

	onStderr(data) {
		if (typeof data == 'string') { this.errBuffer += data; }
		else { this.errBuffer += data.toString('utf8'); }

		let match: RegExpMatchArray;
		if (this.initResolve && this.initMatch.test(this.errBuffer)) {
			this.initResolve(true);
			this.initResolve = null;
			this.initReject = null;
		}

		let end = this.errBuffer.lastIndexOf('\n');
		if (end != -1) {
			this.emit('output', this.errBuffer.substring(0, end));
			this.errBuffer = this.errBuffer.substring(end + 1);
		}
	}
}