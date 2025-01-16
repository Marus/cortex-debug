// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { openStdin } from 'process';
import * as vscode from 'vscode';
import * as os from 'os';
import {Server} from './server';
import * as Interfaces from './interfaces';

export class CortexDebugRemote {
	private server: Server;
	private port: number = -1;

	constructor(public context: vscode.ExtensionContext) {
		console.log('in CortexDebugRemote::constructor');
		vscode.window.showInformationMessage('cortex-debug-remote activated!');
		let disposable = vscode.commands.registerCommand('cortex-debug-remote.helloWorld', this.hello.bind(this));

		context.subscriptions.push(disposable);
		this.server = new Server(context);
		this.server.startServer().then((p) => {
			vscode.window.showInformationMessage(`CortexDebugRemote: Started server @ ${this.server.ipAddr}:${p}`);
			this.port = p;
		}), (e: any) => {
			vscode.window.showErrorMessage(`CortexDebugRemote: Error starting server: ${e.toString()}`);
		};
	}

	public hello(arg: string): Interfaces.helloReturn {
		const str = `in Hello() from cortex-debug-remote! arg: ${arg}`;
		const ret = this.server.hello(arg);
		vscode.window.showInformationMessage(str + JSON.stringify(ret, undefined, 4));
		console.log(str, ret);
		return ret;
	}
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	return new CortexDebugRemote(context);
}

// this method is called when your extension is deactivated
export function deactivate() {}
