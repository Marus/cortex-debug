import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from "vscode";
import { hexFormat } from './utils';
import { clearTimeout, setTimeout } from 'timers';
import * as portastic from 'portastic';

var WebSocket = require('ws');
var CircularBuffer = require('cbarrick-circular-buffer');

interface SWOProcessor {
	port: number;
	format: string;

	processMessage(data: number);
	dispose();
}

interface SWOWebsocketProcessor extends SWOProcessor {
	getMessages();
}

interface WebsocketMessage {
	timestamp: Date;
	data: number;
	port: number;
}

interface SWOPortConfig {
	number: number;
	format: string;
};

class SWOBinaryProcessor implements SWOProcessor {
	output: vscode.OutputChannel;
	format: string = 'binary';

	constructor(public port: number, private core: SWOCore) {
		this.port = port;
		this.output = vscode.window.createOutputChannel(`SWO Output [port: ${this.port}, format: Binary]`);
	}

	processMessage(data: number) {
		let date = new Date();
		let value = hexFormat(data, 8);

		this.output.appendLine(`[${date.toISOString()}]   ${value}`);
	}

	dispose() {
		this.output.dispose();
	}
}

class SWOConsoleProcessor implements SWOProcessor {
	positionCount: number;
	output: vscode.OutputChannel;
	position: number = 0;
	timeout: any = null;
	format: string = 'console';
	
	constructor(public port: number, private core: SWOCore) {
		this.port = port;
		this.output = vscode.window.createOutputChannel(`SWO Output [port: ${this.port}, format: Console]`);
	}

	processMessage(data: number) {
		if(this.timeout) { clearTimeout(this.timeout); this.timeout = null; }

		let letter = String.fromCharCode(data);
		if(letter == '\n') {
			this.output.append('\n');
			this.position = 0;
			return;
		}

		if(this.position == 0) {
			let date = new Date();
			let header = `[${date.toISOString()}]   `;
			this.output.append(header);
		}

		this.output.append(letter);
		this.position += 1;

		if(this.position >= 80) {
			this.output.append('\n');
			this.position = 0;
		}
		else {
			this.timeout = setTimeout(() => {
				this.output.append('\n');
				this.position = 0;
				this.timeout = null;
			}, 5000);
		}
	}

	dispose() {
		this.output.dispose();
	}
}

class SWOGraphProcessor implements SWOWebsocketProcessor {
	// buffer: CircularBuffer;
	format: string = 'graph';

	constructor(public port: number, private core: SWOCore) {
		// this.buffer = new CircularBuffer(5000);
		core.socketServer.registerProcessor(this);
	}

	processMessage(data: number) {
		let message = { timestamp: new Date(), data: data, port: this.port };
		// if(this.buffer.size() == this.buffer.capcity()) { this.buffer.deq(); }
		// this.buffer.enq(message);
		this.core.socketServer.broadcastMessage(message);
	}

	dispose() {
		
	}

	getMessages(): WebsocketMessage[] {
		return [];
	}
}

const PROCESSOR_MAP = {
	"console": SWOConsoleProcessor,
	"binary": SWOBinaryProcessor,
	"graph": SWOGraphProcessor
};

class SWOSocketServer {
	processors: SWOWebsocketProcessor[];
	socket: any;

	constructor(serverPort: number) {
		this.processors = [];
		this.socket = new WebSocket.Server({ port: serverPort });
		this.socket.on('connection', this.connected.bind(this));
	}

	connected(client) {
		client.on('message', (message) => this.message(client, message));
		let activePorts = this.processors.map(p => { return { 'port': p.port, 'format': p.format }; });
		client.send(JSON.stringify({ 'activePorts': activePorts }));
	}

	message(client, message) {
	}

	registerProcessor(processor: SWOWebsocketProcessor) {
		this.processors.push(processor);
	}

	broadcastMessage(message: WebsocketMessage) {
		let encoded = JSON.stringify(message);
		this.socket.clients.forEach(client => {
			if(client.readyState == WebSocket.OPEN) {
				client.send(encoded);
			}
		});
	}

	dispose() {
		console.log('Disposing WebSocket Server')
		this.socket.close();
	}
}

export class SWOCore {
	processors: SWOProcessor[] = [];;
	socketServer: SWOSocketServer;
	client: net.Socket;
	connected: boolean = false;

	buffer = null;

	LENGTH_MASK = 0x03;
	SPECIAL_MASK = 0x0F;
	PORT_MASK = 0xF8;

	constructor(SWOPort: number, cpuFreq: number, swoFreq: number, configuration: SWOPortConfig[], extensionPath: string) {
		this.buffer = new CircularBuffer({ size: 250, encoding: null });

		this.client = net.createConnection({ port: SWOPort, host: 'localhost' }, () => { this.connected = true; });
		this.client.on('data', this.handleData.bind(this));
		this.client.on('end', () => {
			this.connected = false;
		});

		portastic.find({ min: 53333, max: 54333, retrieve: 1 }).then(ports => {
			let port = ports[0];
			this.socketServer = new SWOSocketServer(port);
			var hasGraph = configuration.filter(c => c.format == 'graph').length > 0;

			if(hasGraph) {
				var grapherURL = `file://${extensionPath}/grapher/index.html?port=${port}`;
				let grapherURI = vscode.Uri.parse(grapherURL);

				vscode.commands.executeCommand('vscode.previewHtml', grapherURI, vscode.ViewColumn.Two, 'SWO Graphs').then(e => {
					console.log('Preview HTML: ', e);
				},
				error => {
					console.log('Preview HTML Error: ', error);
				});
			}
		}).then(result => {
			configuration.forEach(conf => {
				let pc = PROCESSOR_MAP[conf.format];
				if(pc) {
					let processor = new pc(conf.number, this);
					this.processors.push(processor);
				}
			});
		});
	}

	handleData(data) {
		this.buffer.write(data);
		this._processBuffer();
	}

	_processBuffer() {
		while(this.buffer.length > 0) {
			let headerbuf = this.buffer.peek(1, null);
			let header = headerbuf[0];
			if((header & this.SPECIAL_MASK) === 0) {
				// this._processTimestamp();
				console.log("Invalid Content - dropping buffer");
				this.buffer.read(this.buffer.length, null);
				continue;
			}
			if((header & 0x4) !== 0) {
				console.log("Invalid Content - dropping buffer");
				this.buffer.read(this.buffer.length, null);
				continue;
			}

			let lh = header & this.LENGTH_MASK;
			let length = (lh == 0x3 ? 4 : lh);
			let port = (header & this.PORT_MASK) >>> 3;

			if(this.buffer.length < length + 1) { break; } // Not enough bytes to process yet
			
			let buf = this.buffer.read(length + 1, null);
			let value = 0;

			for(var i = 0; i < length; i++) {
				value = value << 8;
				let tmp = buf[length - i];
				value = (value | tmp) >>> 0;
			}

			this._processSWIT(port, value);
		}
	}

	_processSWIT(port: number, data: number) {
		this.processors.forEach(p => { if(p.port == port) { p.processMessage(data); } });
	}

	_processTimestamp() {

	}

	calculatePortMask(configuration: SWOPortConfig[]) {
		let mask: number = 0;
		configuration.forEach(c => {
			mask = (mask | (1 << c.number)) >>> 0;
		});
		return mask;
	}
	
	dispose() {
		this.client.destroy();
		this.client = null;
		this.socketServer.dispose();
		this.socketServer = null;
		this.processors = null;
		this.connected = false;
	}

}