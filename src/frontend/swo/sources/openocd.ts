import * as fs from 'fs';
import { EventEmitter } from 'events';
import { SWOSource } from './common';

export class OpenOCDSWOSource extends EventEmitter implements SWOSource  {
	stream: fs.ReadStream;
	connected: boolean = false;

	constructor(private SWOPath: string) {
		super();
		this.stream = fs.createReadStream(this.SWOPath, { highWaterMark: 128, encoding: null, autoClose: false })
		this.stream.on('data', (buffer) => { this.emit('data', buffer); });
		this.stream.on('close', (buffer) => { this.emit('disconnected'); });
		this.connected = true;
	}

	dispose() {
		this.stream.close();
	}
}

export class OpenOCDFileSWOSource extends EventEmitter implements SWOSource {
	connected: boolean = false;
	fd: number = null;
	interval: any = null;

	constructor(private SWOPath: string) {
		super();
		fs.open(SWOPath, 'r', (err, fd) => {
			if(err) {
				console.log('Error Opening File')
			}
			else {
				this.fd = fd;
				this.interval = setInterval(this.read.bind(this), 2);
				this.connected = true;
				this.emit('connected');
			}
		})
	}

	read() {
		let buf: Buffer = new Buffer(64);
		fs.read(this.fd, buf, 0, 64, null, (err, bytesRead, buffer) => {
			if(bytesRead > 0) {
				this.emit('data', buffer.slice(0, bytesRead));
			}
		});
	}

	dispose() {
		this.emit('disconnected');
		clearInterval(this.interval);
		fs.closeSync(this.fd);
	}
}