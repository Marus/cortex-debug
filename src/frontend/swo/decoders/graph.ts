import * as vscode from "vscode";
import { SWODecoder } from './common';
import { decoders as DECODER_MAP } from './utils';
import { EventEmitter } from 'events';
import { SWOGraphDecoderConfig, WebsocketDataMessage } from '../common';

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

	processMessage(buffer: Buffer) {
		let raw = buffer.toString('hex');
		let decodedValue = parseEncoded(buffer, this.encoding);
		let scaledValue = decodedValue * this.scale;

		let message: WebsocketDataMessage = { type: 'data', timestamp: new Date().getTime(), data: scaledValue, id: this.graphId };
		this.emit('message', message);
	}

	dispose() {
		
	}
}