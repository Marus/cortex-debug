import * as vscode from "vscode";
import { hexFormat } from './utils';
import { DisassemblyInstruction } from "../common";

export class DisassemblyContentProvider implements vscode.TextDocumentContentProvider {
	provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): Thenable<string> {
		return new Promise((resolve, reject) => {
			let funcName: string;
			let file: string;
			let path = uri.path;
			let pathParts = path.substring(1, path.length - 6).split('::');
			
			if (pathParts.length === 1) {
				file = null;
				funcName = pathParts[0];
			}
			else {
				file = pathParts[0];
				funcName = pathParts[1];
			}
			
			vscode.debug.activeDebugSession.customRequest('disassemble', { function: funcName, file: file }).then((data) => {
				let instructions: DisassemblyInstruction[] = data.instructions;

				let output = '';
				instructions.forEach(i => {
					output += `${i.address}: ${this.padEnd(15, i.opcodes)} \t${i.instruction}\n`;
				});

				resolve(output);
			}, (error) => {
				vscode.window.showErrorMessage(error.message);
				reject(error.message);
			});
		});
	}

	private padEnd(len: number, value: string): string {
		for (let i = value.length; i < len; i++) { value += ' '; }
		return value;
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