import * as vscode from "vscode";

import * as portastic from 'portastic';
import * as os from 'os';

import { SWOConsoleProcessor } from './decoders/console';
import { SWOBinaryProcessor } from './decoders/binary';
import { SWOGraphProcessor } from './decoders/graph';
import { SWODecoder } from './decoders/common';
import { SWOSource } from './sources/common';
import { SWOSocketServer } from './websocket_server';
import { SWODecoderConfig, GraphConfiguration, WebsocketStatusMessage, SWOAdvancedDecoderConfig, SWOBinaryDecoderConfig, SWOConsoleDecoderConfig, SWOGraphDecoderConfig, WebsocketProgramCounterMessage, SWOBasicDecoderConfig } from './common';
import { SWOAdvancedProcessor } from "./decoders/advanced";
import { EventEmitter } from "events";
import { PacketType, Packet, TimestampType, TimestampPacket } from './common';
import { parseUnsigned } from './decoders/utils';
import { hexFormat } from "../utils";
import { SymbolInformation, SymbolTable } from './symbols';

var RingBuffer = require('ringbufferjs');

enum Status {
	IDLE = 1,
	UNSYNCED,
	TIMESTAMP,
	HARDWARE_EVENT,
	SOFTWARE_EVENT,
	RESERVED,
};


const LENGTH_MASK = 0b00000011;
const OVERFLOW_MASK = 0b01110000;
const HARDWARE_MASK = 0b00000100;
const PORT_MASK = 0b11111000;
const TIMESTAMP_MASK = 0b00001111;

class ITMDecoder extends EventEmitter {
	private syncBuffer = new RingBuffer(6);
	private status: Status = Status.IDLE;
	
	private rxCount: number = 0;
	private rxBuffer: Buffer;
	private rxPort: number;
	private rxTargetLength: number;
	private rxPacketType: PacketType;
	private timestamp: number = 0;

	constructor() {
		super();

		this.syncBuffer.enq(0xFF); this.syncBuffer.enq(0xFF); this.syncBuffer.enq(0xFF); this.syncBuffer.enq(0xFF); this.syncBuffer.enq(0xFF); this.syncBuffer.enq(0xFF);
	}

	private resetRxPacket(port: number, length: number, type: PacketType) {
		this.rxBuffer = new Buffer(length);
		this.rxBuffer.fill(0);

		this.rxTargetLength = length;
		this.rxPacketType = type;
		this.rxPort = port;
		this.rxCount = 0;
	}

	private rxWriteByte(byte: number): boolean {
		this.rxBuffer.writeUInt8(byte, this.rxCount);
		this.rxCount++;
		return this.rxCount == this.rxTargetLength;
	}

	private getRxPacket(): Packet {
		return {
			type: this.rxPacketType,
			port: this.rxPort,
			size: this.rxCount,
			data: this.rxBuffer
		};
	}

	private checkSync(byte: number) {
		this.syncBuffer.enq(byte);
		let bytes: number[] = this.syncBuffer.peekN(6);
		return (bytes[5] === 0x80 && bytes[4] === 0x00 && bytes[3] === 0x00 && bytes[2] === 0x00 && bytes[1] === 0x00 && bytes[0] === 0x00);
	}

	public processByte(byte: number) {
		let newStatus: Status = this.status;

		if (this.checkSync(byte)) { // check for completed sync
			newStatus = Status.IDLE;
			this.emit('synchronized');
		}
		else {
			switch (this.status) {
				case Status.IDLE:
					if (byte === 0x00) break; // Sync Packet
					else if (byte === 0b01110000) { this.emit('overflow'); }
					else if ((byte & TIMESTAMP_MASK) === 0x00) {
						this.timestamp = 0;
						this.resetRxPacket(-1, 5, PacketType.TIMESTAMP);
						this.rxWriteByte(byte);
												
						if (byte & 0x80) {
							newStatus = Status.TIMESTAMP;
						}
						else {
							this.emit('timestamp', this.getRxPacket());
						}
					} 
					else if ((byte & LENGTH_MASK) !== 0x00) {
						let count = byte & 0x03;
						if (count === 3) { count = 4; }

						let port = (byte & PORT_MASK) >>> 3;
						
						if ((byte & HARDWARE_MASK) !== 0) {
							this.resetRxPacket(port, count, PacketType.HARDWARE);
							newStatus = Status.HARDWARE_EVENT;
						}
						else {
							this.resetRxPacket(port, count, PacketType.SOFTWARE);
							newStatus = Status.SOFTWARE_EVENT;
						}
					}
					else {
						console.log('Reserved byte received: ', hexFormat(byte, 2));
						newStatus = Status.RESERVED;
						this.emit('lost-synchronization');
					}
					break;
				case Status.TIMESTAMP:
					this.rxWriteByte(byte)
					if ((byte & 0x80) == 0x00) {
						this.emit('timestamp', this.getRxPacket());
						newStatus = Status.IDLE;
					}
					break;
				case Status.UNSYNCED:
					break;
				case Status.SOFTWARE_EVENT:
					if (this.rxWriteByte(byte)) {
						this.emit('software-event', this.getRxPacket());
						newStatus = Status.IDLE;
					}
					break;
				case Status.HARDWARE_EVENT:
					if (this.rxWriteByte(byte)) {
						this.emit('hardware-event', this.getRxPacket());
						newStatus = Status.IDLE;
					}
					break;
				case Status.RESERVED:
					if ((byte & 0x80) === 0x00) {
						newStatus = Status.IDLE;
					}
					break;
			}
		}

		this.status = newStatus;
	}
}

interface ConfigurationArguments {
	executable: string;
	swoConfig: {
		enabled: boolean,
		decoders: SWODecoderConfig[]
	},
	graphConfig: GraphConfiguration[]
}

export class SWOCore {
	processors: SWODecoder[] = [];;
	socketServer: SWOSocketServer;
	connected: boolean = false;
	itmDecoder: ITMDecoder;
	symbolTable: SymbolTable;

	constructor(private source: SWOSource, args: ConfigurationArguments, extensionPath: string) {
		this.itmDecoder = new ITMDecoder();
		this.symbolTable = new SymbolTable(args.executable);
		this.symbolTable.loadSymbols();

		if(this.source.connected) { this.connected = true; }
		else { this.source.on('connected', () => { this.connected = true; }); }
		this.source.on('data', this.handleData.bind(this));
		this.source.on('disconnected', () => { this.connected = false; });
		
		portastic.find({ min: 53333, max: 54333, retrieve: 1 }).then(ports => {
			let port = ports[0];
			this.socketServer = new SWOSocketServer(port, args.graphConfig);

			if(args.graphConfig.length >= 1) {
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
			args.swoConfig.decoders.forEach(conf => {
				let processor;

				switch (conf.type) {	
					case 'console':
						this.processors.push(new SWOConsoleProcessor(conf as SWOConsoleDecoderConfig));
						break;
					case 'binary':
						this.processors.push(new SWOBinaryProcessor(conf as SWOBinaryDecoderConfig));
						break;
					case 'graph':
						processor = new SWOGraphProcessor(conf as SWOGraphDecoderConfig);
						this.socketServer.registerProcessor(processor);
						this.processors.push(processor);
						break;
					case 'advanced':
						processor = new SWOAdvancedProcessor(conf as SWOAdvancedDecoderConfig);
						this.socketServer.registerProcessor(processor);
						this.processors.push(processor);
						break;
					default:
						console.log(`Unrecognized SWO Processor: ${conf.type}`);
						break;
				}
			});
		});

		this.itmDecoder.on('software-event', this.processPacket.bind(this));
		this.itmDecoder.on('hardware-event', this.processPacket.bind(this));
		this.itmDecoder.on('synchronized', this.synchronized.bind(this));
		this.itmDecoder.on('lost-synchronization', this.lostSynchronization.bind(this));
		this.itmDecoder.on('timestamp', this.processTimestampPacket.bind(this));
		this.itmDecoder.on('overflow', this.overflow.bind(this));
	}

	handleData(data: Buffer) {
		for (let i = 0; i < data.length; i++) {
			let byte = data.readUInt8(i);
			this.itmDecoder.processByte(byte);
		}
	}

	processPacket(packet: Packet) {
		if (packet.type == PacketType.SOFTWARE) {
			this.processors.forEach(p => p.softwareEvent(packet));
		}
		else if(packet.type == PacketType.HARDWARE) {
			this.processors.forEach(p => p.hardwareEvent(packet));
			if(packet.port == 2) {
				let pc = parseUnsigned(packet.data);
				let symbol = this.symbolTable.getFunctionAtAddress(pc);

				let message: WebsocketProgramCounterMessage = {
					type: 'program-counter',
					timestamp: new Date().getTime(),
					counter: pc,
					function: symbol ? symbol.name : '**Unknown**'
				};
				if (this.socketServer) {
					this.socketServer.broadcastMessage(message);
				}
			}
			else {
				console.log('Received Other Hardware Packet: ', packet);
			}
		}
	}

	processTimestampPacket(packet: Packet) {
		console.log('Received Timestamp Packet: ', packet);
		let timestamp = 0;
		for (let i = 1; i < packet.size; i++) {
			timestamp = timestamp << 7;
			let bits = packet.data.readUInt8(i) & 0x7F;
			timestamp = timestamp | bits;
		}

		console.log('Decoded Timestamp: ', timestamp);
	}

	overflow() {
		console.log('Overflow');
	}

	lostSynchronization() {
		console.log('Lost Synchronization: ', new Date());
		this.processors.forEach(p => p.lostSynchronization());
	}

	synchronized() {
		console.log('Synchronized: ', new Date());
		this.processors.forEach(p => p.synchronized());
	}

	calculatePortMask(configuration: SWODecoderConfig[]) {
		let mask: number = 0;
		configuration.forEach(c => {
			if (c.type == 'advanced') {
				let ac = c as SWOAdvancedDecoderConfig;
				for (let port of ac.ports) {
					mask = (mask | (1 << port)) >>> 0;
				}
			}
			else {
				let bc = c as SWOBasicDecoderConfig;
				mask = (mask | (1 << bc.port)) >>> 0;
			}			
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