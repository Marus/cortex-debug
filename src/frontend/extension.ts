import * as vscode from "vscode";
import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { PeripheralTreeProvider, TreeNode, FieldNode, RecordType, BaseNode } from './peripheral';
import { RegisterTreeProvider, TreeNode as RTreeNode, RecordType as RRecordType, BaseNode as RBaseNode } from './registers';
var adapterOutputChannel: vscode.OutputChannel = null;
export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.getFileNameNoExt", () => {
	let ext = vscode.extensions.getExtension('marus.cortex-debug');
	
	const peripheralProvider = new PeripheralTreeProvider(vscode.workspace.rootPath, ext.extensionPath);
	const registerProvider = new RegisterTreeProvider(vscode.workspace.rootPath, ext.extensionPath);
	vscode.commands.registerCommand('cortexPerhiperals.refresh', () => console.log('Clicked Refresh'));
	vscode.commands.registerCommand('cortexPerhiperals.refreshNode', (node) => console.log('Refresh: ', node));
	vscode.commands.registerCommand('cortexPerhiperals.updateNode', (node: TreeNode) => {
		if(node.node.recordType == RecordType.Field) {
			let fn : FieldNode = node.node as FieldNode;
			fn.performUpdate().then(newval => {
				peripheralProvider._onDidChangeTreeData.fire();
				
			}, reason => {
			});
		}
	});
	vscode.commands.registerCommand('cortexPerhiperals.selectedNode', (node: BaseNode) => {
		if(node.recordType != RecordType.Field) {
			node.expanded = !node.expanded;
		}

		node.selected().then(updated => { if(updated) { peripheralProvider._onDidChangeTreeData.fire(); } }, error => { console.log('Error: ', error); });
	});
	
	context.subscriptions.push(vscode.window.registerTreeDataProvider('cortexPerhiperals', peripheralProvider));
	context.subscriptions.push(vscode.window.registerTreeDataProvider('cortexRegisters', registerProvider));
		if (!vscode.window.activeTextEditor || !vscode.window.activeTextEditor.document || !vscode.window.activeTextEditor.document.fileName) {
			vscode.window.showErrorMessage("No editor with valid file name active");
			return;
		}
		var fileName = vscode.window.activeTextEditor.document.fileName;
		var ext = path.extname(fileName);
		return fileName.substr(0, fileName.length - ext.length);
	}));
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.getFileBasenameNoExt", () => {
		if (!vscode.window.activeTextEditor || !vscode.window.activeTextEditor.document || !vscode.window.activeTextEditor.document.fileName) {
			vscode.window.showErrorMessage("No editor with valid file name active");
			return;
		}
		var fileName = path.basename(vscode.window.activeTextEditor.document.fileName);
		var ext = path.extname(fileName);
		return fileName.substr(0, fileName.length - ext.length);
	}));

	context.subscriptions.push(vscode.debug.onDidReceiveDebugSessionCustomEvent(e => {
		switch(e.event) {
			case 'jlink-output':
				if(e.body.type == 'err') { handleJLinkErrorOutput(e.body.content); }
				else { handleJLinkOutput(e.body.content); }
				break;
		}
	}));
	context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(session => {
		if(adapterOutputChannel) {
			adapterOutputChannel.dispose();
			adapterOutputChannel = null;
		}
	}));
}

function handleJLinkOutput(output: string) {
	if(adapterOutputChannel === null) {
		adapterOutputChannel = vscode.window.createOutputChannel('Adapter Output');
	}

	if(!output.endsWith('\n')) { output += '\n'; }
	adapterOutputChannel.append(output);
}

function handleJLinkErrorOutput(output) {
	if(adapterOutputChannel === null) {
		adapterOutputChannel = vscode.window.createOutputChannel('Adapter Output');
	}

	if(!output.endsWith('\n')) { output += '\n'; }
	adapterOutputChannel.append(output);
}


