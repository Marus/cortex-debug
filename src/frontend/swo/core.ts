import * as vscode from "vscode";

import * as portastic from 'portastic';
import * as os from 'os';

import { SWOConsoleProcessor } from './decoders/console';
import { SWOBinaryProcessor } from './decoders/binary';
import { SWOGraphProcessor } from './decoders/graph';
import { SWOProcessor } from './decoders/common';
import { SWOSource } from './sources/common';
import { SWOSocketServer } from './websocket_server';
import { SWOPortConfig, GraphConfiguration, WebsocketStatusMessage, SWOAdvancedPortConfig, SWOGraphPortConfig, SWOBinaryPortConfig, SWOConsolePortConfig } from './common';
import { SWOAdvancedProcessor } from "./decoders/advanced";

var CircularBuffer = require('cbarrick-circular-buffer');

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

			if(graphs.length > 1) {
				let now = new Date();
				let timestamp = now.getTime();
				let time = now.toTimeString();
				var grapherURL = `file://${extensionPath}/grapher/index.html?port=${port}&timestamp=${timestamp}`;
				if(os.platform() == 'win32') {
					let ep = extensionPath.replace(/\\/g, '/');
					grapherURL = `file:///${ep}/grapher/index.html?port=${port}&timestamp=${timestamp}`;
				}

				vscode.commands.executeCommand('vscode.previewHtml', grapherURL, vscode.ViewColumn.Two, `SWO Graphs [${time}]`).then(e => {
					console.log('Preview HTML: ', e);
				},
				error => {
					console.log('Preview HTML Error: ', error);
				});
			}
		}).then(result => {
			configuration.forEach(conf => {
				let processor;

				switch (conf.type) {	
					case 'console':
						this.processors.push(new SWOConsoleProcessor(conf as SWOConsolePortConfig));
						break;
					case 'binary':
						this.processors.push(new SWOBinaryProcessor(conf as SWOBinaryPortConfig));
						break;
					case 'graph':
						processor = new SWOGraphProcessor(conf as SWOGraphPortConfig);
						this.socketServer.registerProcessor(processor);
						this.processors.push(processor);
						break;
					case 'advanced':
						processor = new SWOAdvancedProcessor(conf as SWOAdvancedPortConfig);
						this.socketServer.registerProcessor(processor);
						this.processors.push(processor);
						break;
					default:
						console.log(`Unrecognized SWO Processor: ${conf.type}`);
						break;
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
		this.socketServer.currentStatus = 'terminated';
		setTimeout(() => {
			this.socketServer.dispose();
			this.socketServer = null;
		}, 250);
	}

	debugStopped() {
		let message : WebsocketStatusMessage = { type: 'status', status: 'stopped' };
		this.socketServer.broadcastMessage(message);
		this.socketServer.currentStatus = 'stopped';
	}

	debugContinued() {
		let message : WebsocketStatusMessage = { type: 'status', status: 'continued' };
		this.socketServer.broadcastMessage(message);
		this.socketServer.currentStatus = 'continued';
	}
	
	dispose() {
		if(this.socketServer) {
			this.socketServer.dispose();
			this.socketServer = null;
		}		
		this.processors.forEach(p => p.dispose());
		this.processors = null;
		this.connected = false;
	}
}