import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from "vscode";
import { hexFormat } from './utils';
import { clearTimeout, setTimeout } from 'timers';
import * as portastic from 'portastic';
import { Parser } from 'binary-parser';
import { EventEmitter } from 'events';

var WebSocket = require('ws');
var CircularBuffer = require('cbarrick-circular-buffer');

let SignedParser = new Parser().endianess('little').int32('value');
let UnsignedParser = new Parser().endianess('little').uint32('value');
let FloatParser = new Parser().endianess('little').floatle('value');

function parseFloat(buffer: Buffer) {
	if(buffer.length < 4) {
		let tmp = new Buffer(4);
		buffer.copy(tmp);
		buffer = tmp;
	}

	let result = FloatParser.parse(buffer);
	return result.value;
}

function parseSigned(buffer: Buffer) {
	if(buffer.length < 4) {
		let tmp = new Buffer(4);
		buffer.copy(tmp);
		buffer = tmp;
	}

	let result = SignedParser.parse(buffer);
	return result.value;
}

function parseUnsigned(buffer: Buffer) {
	if(buffer.length < 4) {
		let tmp = new Buffer(4);
		buffer.copy(tmp);
		buffer = tmp;
	}

	let result = UnsignedParser.parse(buffer);
	return result.value;
}

function parseQ(buffer: Buffer, mask: number, shift: number) {
	let value = parseSigned(buffer);

	var fractional = value & mask;
	var integer = value >> shift;

	return integer + (fractional / mask);
}

function parseUQ(buffer: Buffer, mask: number, shift: number) {
	let value = parseUnsigned(buffer);

	var fractional = value & mask;
	var integer = value >>> shift;

	return integer + (fractional / mask);
}

let DECODER_MAP = {
	'signed': parseSigned,
	'float': parseFloat,
	'Q8.24': (buffer) => parseQ(buffer, 0xFFFFFF, 24),
	'Q16.16': (buffer) => parseQ(buffer, 0xFFFF, 16),
	'Q24.8': (buffer) => parseQ(buffer, 0xFF, 8),
	'UQ8.24': (buffer) => parseUQ(buffer, 0xFFFFFF, 24),
	'UQ16.16': (buffer) => parseUQ(buffer, 0xFFFF, 16),
	'UQ24.8': (buffer) => parseUQ(buffer, 0xFF, 8),
	'unsigned': parseUnsigned
};

function parseEncoded(buffer: Buffer, encoding: string) {
	return DECODER_MAP[encoding] ? DECODER_MAP[encoding](buffer) : parseUnsigned(buffer);
}

interface SWOProcessor {
	port: number;
	format: string;

	processMessage(buffer: Buffer);
	dispose();
}

interface SWOWebsocketProcessor extends SWOProcessor {
	getMessages();
}

interface WebsocketMessage {
	type: string;
}

interface WebsocketDataMessage extends WebsocketMessage {
	timestamp: number;
	data: number;
	port: number;
	raw: string;
}

interface WebsocketStatusMessage extends WebsocketMessage {
	status: string;
}

interface SWOPortConfig {
	number: number;
	format: string;
	encoding: string;
	scale: number;
	label: string;
};

interface GraphConfiguration {
	type: string;
	label: string;
};

interface RealtimeGraphConfiguration extends GraphConfiguration {
	minimum: number;
	maximum: number;
	ports: {
		number: number,
		label: string,
		color: string
	}[];
};

interface XYGraphConfiguration extends GraphConfiguration {
	xPort: number;
	yPort: number;
	xMinimum: number;
	xMaximum: number;
	yMinimum: number;
	yMaximum: number;
}

class SWOBinaryProcessor implements SWOProcessor {
	output: vscode.OutputChannel;
	format: string = 'binary';
	port: number;
	scale: number;
	encoding: string;

	constructor(config: SWOPortConfig, private core: SWOCore) {
		this.port = config.number;
		this.scale = config.scale || 1;
		this.encoding = config.encoding || 'unsigned';

		this.output = vscode.window.createOutputChannel(`SWO: ${config.label || ''} [port: ${this.port}, encoding: ${this.encoding}]`);
	}

	processMessage(buffer: Buffer) {
		let date = new Date();
		
		let hexvalue = buffer.toString('hex');
		let decodedValue = parseEncoded(buffer, this.encoding);
		let scaledValue = decodedValue * this.scale;
		
		this.output.appendLine(`[${date.toISOString()}]   ${hexvalue} - ${decodedValue} - ${scaledValue}`);
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
	port: number;
	
	constructor(config: SWOPortConfig, private core: SWOCore) {
		this.port = config.number;
		this.output = vscode.window.createOutputChannel(`SWO: ${config.label || ''} [port: ${this.port}, format: console]`);
	}

	processMessage(buffer: Buffer) {
		if(this.timeout) { clearTimeout(this.timeout); this.timeout = null; }

		var data = parseUnsigned(buffer);

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
	port: number;
	scale: number;
	encoding: string;

	constructor(config: SWOPortConfig, private core: SWOCore) {
		core.socketServer.registerProcessor(this);
		this.port = config.number;
		this.encoding = config.encoding || 'unsigned';
		this.scale = config.scale || 1;
	}

	processMessage(buffer: Buffer) {
		let raw = buffer.toString('hex');
		let decodedValue = parseEncoded(buffer, this.encoding);
		let scaledValue = decodedValue * this.scale;

		let message = { type: 'data', timestamp: new Date().getTime(), data: scaledValue, port: this.port, raw: raw };
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

	constructor(serverPort: number, public graphs: GraphConfiguration[]) {
		this.processors = [];
		this.socket = new WebSocket.Server({ port: serverPort });
		this.socket.on('connection', this.connected.bind(this));
	}

	connected(client) {
		client.on('message', (message) => this.message(client, message));
		let activePorts = this.processors.map(p => { return { 'port': p.port }; });
		client.send(JSON.stringify({ type: 'configure', 'activePorts': activePorts, 'graphs': this.graphs }));
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
		this.socket.close();
	}
}

export interface SWOSource extends EventEmitter {
	connected: boolean;
	dispose();
}

export class JLinkSWOSource extends EventEmitter implements SWOSource {
	client: net.Socket = null;
	connected: boolean = false;

	constructor(private SWOPort: number) {
		super();
		this.client = net.createConnection({ port: this.SWOPort, host: 'localhost' }, () => { this.connected = true; this.emit('connected'); });
		this.client.on('data', (buffer) => { this.emit('data', buffer); });
		this.client.on('end', () => { this.emit('disconnected'); });
	}

	dispose() {
		this.client.destroy();
	}
}

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

export class SWOCore {
	processors: SWOProcessor[] = [];;
	socketServer: SWOSocketServer;
	connected: boolean = false;

	buffer = null;

	LENGTH_MASK = 0x03;
	SPECIAL_MASK = 0x0F;
	PORT_MASK = 0xF8;

	constructor(private source: SWOSource, configuration: SWOPortConfig[], graphs: GraphConfiguration[], extensionPath: string) {
		this.buffer = new CircularBuffer({ size: 250, encoding: null });

		if(this.source.connected) { this.connected = true; }
		else { this.source.on('connected', () => { this.connected = true; }); }
		this.source.on('data', this.handleData.bind(this));
		this.source.on('disconnected', () => { this.connected = false; });
		
		portastic.find({ min: 53333, max: 54333, retrieve: 1 }).then(ports => {
			let port = ports[0];
			this.socketServer = new SWOSocketServer(port, graphs);
			var hasGraph = configuration.filter(c => c.format == 'graph').length > 0 && graphs.length > 1;

			console.log('WebSocket Server Opened on Port: ', port);

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
					let processor = new pc(conf, this);
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
			
			this.buffer.read(1, null);
			
			let buf = this.buffer.read(length, null);
			this._processSWIT(port, buf);
		}
	}

	_processSWIT(port: number, data: Buffer) {
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

	debugSessionTerminated() {
		let message : WebsocketStatusMessage = { type: 'status', status: 'terminated' };
		this.socketServer.broadcastMessage(message);
	}

	debugStopped() {
		let message : WebsocketStatusMessage = { type: 'status', status: 'stopped' };
		this.socketServer.broadcastMessage(message);
	}

	debugContinued() {
		let message : WebsocketStatusMessage = { type: 'status', status: 'continued' };
		this.socketServer.broadcastMessage(message);
	}
	
	dispose() {
		this.socketServer.dispose();
		this.socketServer = null;
		this.processors.forEach(p => p.dispose());
		this.processors = null;
		this.connected = false;
	}
}