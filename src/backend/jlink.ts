import * as ChildProcess from 'child_process';
import { EventEmitter } from "events";
import * as portastic from 'portastic';

export class JLink extends EventEmitter {
	private process: any;
	private buffer: string;
	private errbuffer: string;

	constructor(public application: string, public device: string, public gdb_port: number, public swo_raw_port: number, public swo_port: number, procEnv: any) {
		super();

		this.buffer = "";
		this.errbuffer = "";
	}

	init(): Thenable<any> {
		return new Promise((resolve, reject) => {
			let args = ['-if', 'swd', '-port', this.gdb_port.toString(), '-swoport', this.swo_raw_port.toString(), '-telnetport', this.swo_port.toString(), '-device', this.device];

			this.process = ChildProcess.spawn(this.application, args, {});
			this.process.stdout.on('data', this.stdout.bind(this));
			this.process.stderr.on('data', this.stderr.bind(this));
			this.process.on("exit", (() => { this.emit("quit"); }).bind(this));
			this.process.on("error", ((err) => { this.emit("launcherror", err); }).bind(this));
			setTimeout(resolve, 50);
		});
	}

	exit() : void {
		this.process.exit();
	}

	error() : void {
		
	}

	close(code, signal) {
		console.log('Closed JLink with ', code, signal);
	}

	stdout(data) {
		if(typeof data =="string")
			this.buffer += data;
		else
			this.buffer += data.toString("utf8");
		
		let end = this.buffer.lastIndexOf('\n');
		if(end != -1) {
			this.onOutput(this.buffer.substr(0, end));
			this.buffer = this.buffer.substr(end + 1);
		}
	}

	stderr(data) {
		if(typeof data =="string")
			this.errbuffer += data;
		else
			this.errbuffer += data.toString("utf8");
		
		let end = this.errbuffer.lastIndexOf('\n');
		if(end != -1) {
			this.onOutput(this.errbuffer.substr(0, end));
			this.errbuffer = this.errbuffer.substr(end + 1);
		}
	}

	stop() {
		this.process.kill();
	}

	onOutput(text: string) {
		this.emit('jlink-output', text);
	}

	onErrOutput(text: string) {
		this.emit('jlink-stderr', text);
	}
}