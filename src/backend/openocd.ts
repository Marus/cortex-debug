import * as ChildProcess from 'child_process';
import { EventEmitter } from "events";
import * as portastic from 'portastic';
import * as os from 'os';

let infoRegex = /^Info\s:\s([^\n])$/i;
let cpuRegex = /^([^\n\.]*)\.cpu([^\n]*)$/i;

export interface SWOConfig {
	enabled: boolean;
	cpuFrequency?: number;
	swoFrequency?: number;
	swoFIFOPath?: string;
}

export class OpenOCD extends EventEmitter {
	private process: any;
	private buffer: string;
	private errbuffer: string;

	constructor(public application: string, public configFiles: string[], public gdb_port: number, public swoConfig: SWOConfig) {
		super();

		this.buffer = "";
		this.errbuffer = "";
	}

	init(): Thenable<any> {
		return new Promise((resolve, reject) => {
			let args = [];
			this.configFiles.forEach((cf,idx) => { args.push('-f'); args.push(cf) });

			let commands = [`gdb_port ${this.gdb_port}`];
			if(this.swoConfig.enabled) {
				if(os.platform() !== 'win32') { // Use FIFO on non-windows platforms
					let mkfifoReturn = ChildProcess.spawnSync('mkfifo', [this.swoConfig.swoFIFOPath]);
				}

				commands.push(`tpiu config internal ${this.swoConfig.swoFIFOPath} uart off ${this.swoConfig.cpuFrequency} ${this.swoConfig.swoFrequency}`);
			}

			args.push('-c');
			args.push(commands.join('; '));

			this.process = ChildProcess.spawn(this.application, args, {});
			this.process.stdout.on('data', this.stdout.bind(this));
			this.process.stderr.on('data', this.stderr.bind(this));
			this.process.on("exit", (() => { this.emit("quit"); }).bind(this));
			this.process.on("error", ((err) => { this.emit("launcherror", err); }).bind(this));
			
			setTimeout(_ => {
				console.log('Started OpenOCD');
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
		console.log('Closed OpenOCD with ', code, signal);
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
		if(text.startsWith('Info :')) {
			let infostring = text.substr(6);
			this.emit('openocd-info', infostring);
			let m2 = infostring.match(cpuRegex);
			if(m2) {
				let cpuid = m2[1];
				this.emit('openocd-init', cpuid);
			}
		}

		this.emit('openocd-output', text);
	}

	onErrOutput(text: string) {
		this.emit('openocd-stderr', text);
	}
}