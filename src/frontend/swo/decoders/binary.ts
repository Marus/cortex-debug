import * as vscode from "vscode";
import { SWODecoder } from './common';
import { SWOBinaryDecoderConfig } from '../common';
import { decoders as DECODER_MAP } from './utils';
import { Packet } from '../common';

function parseEncoded(buffer: Buffer, encoding: string) {
	return DECODER_MAP[encoding] ? DECODER_MAP[encoding](buffer) : DECODER_MAP.unsigned(buffer);
}

export class SWOBinaryProcessor implements SWODecoder {
	output: vscode.OutputChannel;
	format: string = 'binary';
	port: number;
	scale: number;
	encoding: string;

	constructor(config: SWOBinaryDecoderConfig) {
		this.port = config.port;
		this.scale = config.scale || 1;
		this.encoding = (config.encoding || 'unsigned').replace('.', '_');

		this.output = vscode.window.createOutputChannel(`SWO: ${config.label || ''} [port: ${this.port}, encoding: ${this.encoding}]`);
	}

	softwareEvent(packet: Packet) {
		if(packet.port != this.port) { return; }

		let date = new Date();
		
		let hexvalue = packet.data.toString('hex');
		let decodedValue = parseEncoded(packet.data, this.encoding);
		let scaledValue = decodedValue * this.scale;
		
		this.output.appendLine(`[${date.toISOString()}]   ${hexvalue} - ${decodedValue} - ${scaledValue}`);
	}

	hardwareEvent(event: Packet) {}
	synchronized() {}
	lostSynchronization() {}

	dispose() {
		this.output.dispose();
	}
}