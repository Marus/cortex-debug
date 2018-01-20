import * as vscode from "vscode";
import { SWODecoder } from './common';
import { SWOAdvancedDecoderConfig, WebsocketDataMessage, AdvancedDecoder } from '../common';
import { decoders as DECODER_MAP } from './utils';
import { EventEmitter } from 'events';
import { decoders } from './utils';
import { Packet } from '../common';

export class SWOAdvancedProcessor extends EventEmitter implements SWODecoder {
	output: vscode.OutputChannel;
	format: string = 'advanced';
	ports: number[];
	decoder: AdvancedDecoder;
	
	constructor(config: SWOAdvancedDecoderConfig) {
		super();
		this.ports = [];

		let decoderPath = config.decoder;

		var decoderModule = require(decoderPath);

		if(decoderModule && decoderModule.default) {
			let decoderClass = decoderModule.default;

			try {
				this.decoder = new decoderClass(config.config, decoders, this.displayOutput.bind(this), this.graphData.bind(this));
			}
			catch(e) {
				vscode.window.showErrorMessage(`Error instantiating decoder class: ${e.toString()}`);
				return;
			}

			this.ports = config.ports;
			this.output = vscode.window.createOutputChannel(`SWO: ${this.decoder.outputLabel() || ''} [type: ${this.decoder.name}]`);
		}
		else {
			vscode.window.showErrorMessage(`Unable to load decoder class from: ${config.decoder}`);
		}
		
	}

	softwareEvent(packet: Packet) {
		// this.decoder.softwareEvent(buffer);
	}

	hardwareEvent(event: Packet) {}
	synchronized() {}
	lostSynchronization() {}

	displayOutput(output: string) {
		this.output.append(output);
	}

	graphData(data: number, id: string) {
		let message: WebsocketDataMessage = { type: 'data', timestamp: new Date().getTime(), data: data, id: id };
		this.emit('data', message);
	}

	dispose() {
		this.output.dispose();
	}
};