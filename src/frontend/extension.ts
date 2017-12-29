import * as vscode from "vscode";
import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { PeripheralTreeProvider, TreeNode, FieldNode, RecordType, BaseNode } from './peripheral';
import { RegisterTreeProvider, TreeNode as RTreeNode, RecordType as RRecordType, BaseNode as RBaseNode } from './registers';
import { setTimeout } from "timers";
import { SWOCore, JLinkSWOSource, OpenOCDSWOSource, SWOSource } from './swo';

var adapterOutputChannel: vscode.OutputChannel = null;
var swoOutputChannels: { [swoPort: number]: vscode.OutputChannel } = {};

var swo: SWOCore = null;

interface SVDInfo {
	expression: RegExp;
	path: string;
}

var SVDDirectory: SVDInfo[] = [];

function getSVDFile(device: string): string {
	let entry = SVDDirectory.find(de => de.expression.test(device));
	return entry ? entry.path : null;	
}

export function activate(context: vscode.ExtensionContext) {
	let ext = vscode.extensions.getExtension('marus.cortex-debug');
	
	const peripheralProvider = new PeripheralTreeProvider(vscode.workspace.rootPath, ext.extensionPath);
	const registerProvider = new RegisterTreeProvider(vscode.workspace.rootPath, ext.extensionPath);

	let dirPath = path.join(ext.extensionPath, "data", "SVDMap.json");

	let tmp = JSON.parse(fs.readFileSync(dirPath, 'utf8'));

	let swosource: SWOSource = null;

	SVDDirectory = tmp.map(de => {
		let exp = null;
		if(de.id) { exp = new RegExp('^' + de.id + '$', ''); }
		else { exp = new RegExp(de.expression, de.flags); }

		return { 'expression': exp, 'path': de.path };
	});

	context.subscriptions.push(vscode.commands.registerCommand('cortexPeripherals.updateNode', (node: TreeNode) => {
		node.node.performUpdate().then(
			(result) => {
				if (result) {
					peripheralProvider._onDidChangeTreeData.fire();
				}
			},
			(error) => {
				vscode.window.showErrorMessage(`Unable to update value: ${error.toString()}`);
			}
		);
	}));
	vscode.commands.registerCommand('cortexPeripherals.selectedNode', (node: BaseNode) => {
		if(node.recordType != RecordType.Field) {
			node.expanded = !node.expanded;
		}

		node.selected().then(updated => { if(updated) { peripheralProvider._onDidChangeTreeData.fire(); } }, error => { console.log('Error: ', error); });
	});
	
	context.subscriptions.push(vscode.window.registerTreeDataProvider('cortexPeripherals-jlink', peripheralProvider));
	context.subscriptions.push(vscode.window.registerTreeDataProvider('cortexRegisters-jlink', registerProvider));
	context.subscriptions.push(vscode.window.registerTreeDataProvider('cortexPeripherals-openocd', peripheralProvider));
	context.subscriptions.push(vscode.window.registerTreeDataProvider('cortexRegisters-openocd', registerProvider));

	context.subscriptions.push(vscode.debug.onDidReceiveDebugSessionCustomEvent(e => {
		switch(e.event) {
			case 'custom-stop':
				peripheralProvider.debugStopped();
				registerProvider.debugStopped();
				swo.debugStopped();
				break;
			case 'custom-continued':
				peripheralProvider.debugContinued();
				registerProvider.debugContinued();
				swo.debugContinued();
				break;
			case 'swo-configure':
				if(e.body.type == 'jlink') {
					swosource = new JLinkSWOSource(e.body.port);
				}
				else if(e.body.type == 'openocd') {
					if(os.platform() != 'win32') {
						swosource = new OpenOCDSWOSource(e.body.path);
					}
				}
				break;
			case 'adapter-output':
				handleAdapterOutput(e.body.content);
				break;
		}
	}));

	context.subscriptions.push(vscode.debug.onDidStartDebugSession(session => {
		session.customRequest('get-arguments').then(args => {
			let svdfile = args.SVDFile;
			if(!svdfile) {
				let basepath = getSVDFile(args.device);
				if(basepath) {
					svdfile = path.join(ext.extensionPath, basepath);
				}
			}

			registerProvider.debugSessionStarted();
			if (svdfile) {
				peripheralProvider.debugSessionStarted({
					SVDFile: svdfile
				});
			}
			else {
				peripheralProvider.debugSessionStarted({ disable: true });
			}

			if (args.SWOConfig.enabled && swosource) {
				swo = new SWOCore(swosource, args.SWOConfig.ports, args.GraphConfig, ext.extensionPath);
			}
			if(args.SWOConfig.enabled && os.platform() == 'win32' && args.type == 'openocd') {
				vscode.window.showErrorMessage('SWO Decoding is not support using OpenOCD on Windows');
			}
			else if (args.SWOConfig.enabled && !swosource) {
				vscode.window.showErrorMessage('SWO is Enabled - but extension did not get an SWO Source Configuration Event');
			}
		});
	}));

	context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(session => {
		if(adapterOutputChannel) {
			adapterOutputChannel.dispose();
			adapterOutputChannel = null;
		}
		for(var key in swoOutputChannels) {
			swoOutputChannels[key].dispose();
		}
		swoOutputChannels = {};

		registerProvider.debugSessionTerminated();
		peripheralProvider.debugSessionTerminated();

		if(swo) {
			swo.dispose();
			swo = null;
		}
		if(swosource) {
			swosource.dispose();
			swo = null;
		}
	}));
}

function handleAdapterOutput(output) {
	if(adapterOutputChannel === null) {
		adapterOutputChannel = vscode.window.createOutputChannel('Adapter Output');
	}

	if(!output.endsWith('\n')) { output += '\n'; }
	adapterOutputChannel.append(output);
}


