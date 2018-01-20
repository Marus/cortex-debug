import * as vscode from "vscode";
import { SWODecoder } from './common';
import { decoders as DECODER_MAP } from './utils';
import { EventEmitter } from 'events';
import { SWOGraphDecoderConfig, WebsocketDataMessage } from '../common';
import { Packet } from '../common';

function parseEncoded(buffer: Buffer, encoding: string) {
	return DECODER_MAP[encoding] ? DECODER_MAP[encoding](buffer) : DECODER_MAP.unsigned(buffer);
}

export class SWOGraphProcessor extends EventEmitter implements SWODecoder {
	format: string = 'graph';
	port: number;
	scale: number;
	encoding: string;
	graphId: string;

	constructor(config: SWOGraphDecoderConfig) {
		super();
		// core.socketServer.registerProcessor(this);
		this.port = config.port;
		this.encoding = config.encoding || 'unsigned';
		this.scale = config.scale || 1;
		this.graphId = config.graphId;
	}

	softwareEvent(packet: Packet) {
		if (packet.port != this.port) { return; }

		let raw = packet.data.toString('hex');
		let decodedValue = parseEncoded(packet.data, this.encoding);
		let scaledValue = decodedValue * this.scale;

		let message: WebsocketDataMessage = { type: 'data', timestamp: new Date().getTime(), data: scaledValue, id: this.graphId };
		this.emit('message', message);
	}

	hardwareEvent(event: Packet) {}
	synchronized() {}
	lostSynchronization() {}

	dispose() {
	}
}