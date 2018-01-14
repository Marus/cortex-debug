import * as ChildProcess from 'child_process';
import { EventEmitter } from "events";
import * as portastic from 'portastic';
import * as os from 'os';

let infoRegex = /^Info\s:\s([^\n])$/i;
let cpuRegex = /^([^\n\.]*)\.cpu([^\n]*)$/i;

export class PyOCD extends EventEmitter {
	private process: any;
	private buffer: string;
	private errbuffer: string;

	constructor(public application: string, public gdb_port: number, public boardId: string, public targetId: string) {
		super();

		this.buffer = "";
		this.errbuffer = "";
	}

	init(): Thenable<any> {
		return new Promise((resolve, reject) => {
			let args = ['--persist', '--port', `${this.gdb_port}`, '--reset-break'];

			if (this.boardId) {
				args.push('--board');
				args.push(this.boardId)
			}

			if (this.targetId) {
				args.push('--target');
				args.push(this.targetId);
			}

			this.process = ChildProcess.spawn(this.application, args, {});
			this.process.stdout.on('data', this.stdout.bind(this));
			this.process.stderr.on('data', this.stderr.bind(this));
			this.process.on("exit", (() => { this.emit("quit"); }).bind(this));
			this.process.on("error", ((err) => { this.emit("launcherror", err); }).bind(this));
			
			setTimeout(_ => {
				console.log('Started PyOCD');
				resolve();
			}, 1000);
		});
	}

	exit() : void {
		this.process.kill();
	}

	error() : void {
		
	}

	close(code, signal) {
		console.log('Closed PyOCD with ', code, signal);
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
		let m = text.match(infoRegex);
		if(text.startsWith('INFO:')) {
			let infostring = text.substr(5);
			this.emit('pyocd-info', infostring);
			if (infostring.indexOf('GDB server started at port') != -1) {
				this.emit('pyocd-init');
			}
		}

		this.emit('pyocd-output', text);
	}

	onErrOutput(text: string) {
		this.emit('pyocd-stderr', text);
	}
}