import * as vscode from "vscode";

import { SWOProcessor } from './common';
import { parseUnsigned } from './utils';
import { SWOConsolePortConfig } from "../common";

export class SWOConsoleProcessor implements SWOProcessor {
	positionCount: number;
	output: vscode.OutputChannel;
	position: number = 0;
	timeout: any = null;
	format: string = 'console';
	port: number;
	
	constructor(config: SWOConsolePortConfig) {
		this.port = config.number;
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