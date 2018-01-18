import * as vscode from "vscode";

import { SWODecoder } from './common';
import { parseUnsigned } from './utils';
import { SWOConsoleDecoderConfig } from "../common";

export class SWOConsoleProcessor implements SWODecoder {
	positionCount: number;
	output: vscode.OutputChannel;
	position: number = 0;
	timeout: any = null;
	format: string = 'console';
	port: number;
	
	constructor(config: SWOConsoleDecoderConfig) {
		this.port = config.port;
		this.output = vscode.window.createOutputChannel(`SWO: ${config.label || ''} [port: ${this.port}, type: console]`);
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