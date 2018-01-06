import * as vscode from "vscode";
import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { PeripheralTreeProvider, TreeNode, FieldNode, RecordType, BaseNode } from './peripheral';
import { RegisterTreeProvider, TreeNode as RTreeNode, RecordType as RRecordType, BaseNode as RBaseNode } from './registers';
import { setTimeout } from "timers";
import { SWOCore, JLinkSWOSource, OpenOCDSWOSource, SWOSource, OpenOCDFileSWOSource } from './swo';
import { SWOConfigureEvent } from "../common";


interface SVDInfo {
	expression: RegExp;
	path: string;
}

var SVDDirectory: SVDInfo[] = [];

function getSVDFile(device: string): string {
	let entry = SVDDirectory.find(de => de.expression.test(device));
	return entry ? entry.path : null;	
}

class CortexDebugExtension {
	private adapterOutputChannel: vscode.OutputChannel = null;
	private swo: SWOCore = null;
	private swosource: SWOSource = null;

	private peripheralProvider: PeripheralTreeProvider;
	private registerProvider: RegisterTreeProvider;

	private SVDDirectory: SVDInfo[] = [];

	constructor(private context: vscode.ExtensionContext) {
		this.peripheralProvider = new PeripheralTreeProvider();
		this.registerProvider = new RegisterTreeProvider();

		let tmp = [];
		try {
			let dirPath = path.join(context.extensionPath, "data", "SVDMap.json");
			tmp = JSON.parse(fs.readFileSync(dirPath, 'utf8'));
		}
		catch(e) {}

		this.SVDDirectory = tmp.map(de => {
			let exp = null;
			if (de.id) { exp = new RegExp('^' + de.id + '$', ''); }
			else { exp = new RegExp(de.expression, de.flags) }

			return { expression: exp, path: de.path };
		});

		context.subscriptions.push(vscode.commands.registerCommand('cortexPeripherals.updateNode', this.peripheralsUpdateNode.bind(this)));
		context.subscriptions.push(vscode.commands.registerCommand('cortexPeripherals.selectedNode', this.peripheralsSelectedNode.bind(this)));

		context.subscriptions.push(vscode.window.registerTreeDataProvider('cortexPeripherals-jlink', this.peripheralProvider));
		context.subscriptions.push(vscode.window.registerTreeDataProvider('cortexPeripherals-openocd', this.peripheralProvider));
		context.subscriptions.push(vscode.window.registerTreeDataProvider('cortexRegisters-jlink', this.registerProvider));	
		context.subscriptions.push(vscode.window.registerTreeDataProvider('cortexRegisters-openocd', this.registerProvider));

		context.subscriptions.push(vscode.debug.onDidReceiveDebugSessionCustomEvent(this.receivedCustomEvent.bind(this)));
		context.subscriptions.push(vscode.debug.onDidStartDebugSession(this.debugSessionStarted.bind(this)));
		context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(this.debugSessionTerminated.bind(this)));
	}

	getSVDFile(device: string): string {
		return '';
	}

	// Peripherals
	peripheralsUpdateNode(node: TreeNode): void {
		node.node.performUpdate().then((result) => {
			if (result) {
				this.peripheralProvider.refresh();
			}
		}, (error) => {
			vscode.window.showErrorMessage(`Unable to update value: ${error.toString()}`);
		});
	}

	peripheralsSelectedNode(node: BaseNode): void {
		if (node.recordType != RecordType.Field) { node.expanded = !node.expanded }

		node.selected().then((updated) => {
			if (updated) {
				this.peripheralProvider.refresh();
			}
		}, (error) => {
			console.log('Error Selecting Node: ', error.toString());
		});
	}

	// Registers

	// Debug Events
	debugSessionStarted(session: vscode.DebugSession) {
		// Clean-up Old output channels
		if (this.adapterOutputChannel) {
			this.adapterOutputChannel.dispose();
			this.adapterOutputChannel = null;
		}

		if (this.swo) {
			this.swo.dispose();
			this.swo = null;
		}

		session.customRequest('get-arguments').then(args => {
			let svdfile = args.SVDFile;
			if (!svdfile) {
				let basepath = this.getSVDFile(args.device);
				if(basepath) {
					svdfile = path.join(this.context.extensionPath, basepath);
				}
			}

			this.registerProvider.debugSessionStarted();
			this.peripheralProvider.debugSessionStarted(svdfile ? svdfile : null);

			if(this.swosource) { this.initializeSWO(args); }
		}, error => {
			//TODO: Error handling for unable to get arguments
		});
	}

	debugSessionTerminated(session: vscode.DebugSession) {
		this.registerProvider.debugSessionTerminated();
		this.peripheralProvider.debugSessionTerminated();

		if (this.swosource) {
			this.swosource.dispose();
			this.swosource = null;
		}
	}

	receivedCustomEvent(e: vscode.DebugSessionCustomEvent) {
		switch (e.event) {
			case 'custom-stop':
				this.receivedStopEvent(e);
				break;
			case 'custom-continued':
				this.receivedContinuedEvent(e);
				break;
			case 'swo-configure':
				this.receivedSWOConfigureEvent(e);
				break;
			case 'adapter-output':
				this.receivedAdapterOutput(e);
				break;
			default:
				break;

		}
	}

	receivedStopEvent(e) {
		this.peripheralProvider.debugStopped();
		this.registerProvider.debugStopped();
		if(this.swo) { this.swo.debugStopped(); }
	}

	receivedContinuedEvent(e) {
		this.peripheralProvider.debugContinued();
		this.registerProvider.debugContinued();
		if (this.swo) { this.swo.debugContinued(); }
	}

	receivedSWOConfigureEvent(e) {
		if (e.body.type == 'jlink') {
			this.swosource = new JLinkSWOSource(e.body.port);
		}
		else if (e.body.type == 'openocd') {
			// Use filesystem on windows; fifo on other operating systems.
			if(os.platform() === 'win32') {
				this.swosource = new OpenOCDFileSWOSource(e.body.path);
			}
			else {
				this.swosource = new OpenOCDSWOSource(e.body.path);
			}
		}

		if(vscode.debug.activeDebugSession) {
			vscode.debug.activeDebugSession.customRequest('get-arguments').then(args => {
				this.initializeSWO(args);
			});
		}
	}

	receivedAdapterOutput(e) {
		if (!this.adapterOutputChannel) {
			this.adapterOutputChannel = vscode.window.createOutputChannel('Adapter Output');
		}

		let output = e.body.content;
		if (!output.endsWith('\n')) { output += '\n'; }
		this.adapterOutputChannel.append(output);
	}

	initializeSWO(args) {
		if (!this.swosource) {
			vscode.window.showErrorMessage('Tried to initialize SWO Decoding without a SWO data source');
			return;
		}

		this.swo = new SWOCore(this.swosource, args.SWOConfig.ports, args.GraphConfig, this.context.extensionPath);
	}
}

export function activate(context: vscode.ExtensionContext) {
	let extension = new CortexDebugExtension(context);
}
