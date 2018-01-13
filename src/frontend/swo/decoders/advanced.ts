import * as vscode from "vscode";
import { SWOProcessor } from './common';
import { SWOAdvancedPortConfig, WebsocketDataMessage, AdvancedDecoder } from '../common';
import { decoders as DECODER_MAP } from './utils';
import { EventEmitter } from 'events';
import { decoders } from './utils';


export class SWOAdvancedProcessor extends EventEmitter implements SWOProcessor {
	output: vscode.OutputChannel;
	format: string = 'advanced';
	port: number;
	decoder: AdvancedDecoder;
	
	constructor(config: SWOAdvancedPortConfig) {
		super();
		this.port = -1;

		let decoderPath = config.decoder;
		if(decoderPath == 'protobuf') {
			let extension = vscode.extensions.getExtension('marus25.cortex-debug');
			decoderPath = `${extension.extensionPath}/out/src/frontend/swo/decoders/protobuf.js`;
		}
		
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

			this.port = config.number;
			this.output = vscode.window.createOutputChannel(`SWO: ${this.decoder.outputLabel() || ''} [port: ${this.port}, type: ${this.decoder.name}]`);
		}
		else {
			vscode.window.showErrorMessage(`Unable to load decoder class from: ${config.decoder}`);
		}
		
	}

	processMessage(buffer: Buffer) {
		this.decoder.processData(buffer);
	}

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