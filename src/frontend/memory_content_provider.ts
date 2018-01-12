import * as vscode from "vscode";
import { hexFormat } from './utils';

export class MemoryContentProvider implements vscode.TextDocumentContentProvider {
	provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): Thenable<string> {
		return new Promise((resolve, reject) => {
			let highlightAt = -1;
			let query = this.parseQuery(uri.query);
			
			let address: number = query['address'].startsWith('0x') ? parseInt(query['address'].substring(2), 16) : parseInt(query['address'], 10);
			let length: number = query['length'].startsWith('0x') ? parseInt(query['length'].substring(2), 16) : parseInt(query['length'], 10);
			
			vscode.debug.activeDebugSession.customRequest('read-memory', { address: address, length: length || 32 }).then((data) => {
				let bytes = data.bytes;
				
				let lineAddress = address & 0xFFFFFFF0;
				let lineLength = 16;
				let offset = address - lineAddress;

				let output = '';

				output += hexFormat(lineAddress, 8) + '\t\t';

				for (let i = 0; i < offset; i++) { output += '   '; }

				for (let i = 0; i < length; i++) {
					output += hexFormat(bytes[i], 2, false) + ' ';
					if ((address + i) % 16 === 15 && i < length - 1) {
						output += '\n';
						lineAddress += 16;
						output += hexFormat(lineAddress, 8) + '\t\t';
					}
				}

				output += '\n';

				resolve(output);
			}, (error) => {
				vscode.window.showErrorMessage(`Unable to read memory at ${address}`);
				reject(error.toString());
			});
		});
	}

	private parseQuery(queryString) {
		var query = {};
		var pairs = (queryString[0] === '?' ? queryString.substr(1) : queryString).split('&');
		for (var i = 0; i < pairs.length; i++) {
			var pair = pairs[i].split('=');
			query[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || '');
		}
		return query;
	}
}