import * as vscode from "vscode";
import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { PeripheralTreeProvider, TreeNode, FieldNode, RecordType, BaseNode } from './peripheral';
import { RegisterTreeProvider, TreeNode as RTreeNode, RecordType as RRecordType, BaseNode as RBaseNode } from './registers';
import { setTimeout } from "timers";
import { SWOCore } from './swo/core';
import { SWOSource } from './swo/sources/common';
import { JLinkSWOSource } from './swo/sources/jlink';
import { OpenOCDSWOSource, OpenOCDFileSWOSource } from './swo/sources/openocd';
import { SWOConfigureEvent } from "../common";
import { MemoryContentProvider } from './memory_content_provider';
import Reporting from '../reporting';

import * as CopyPaste from 'copy-paste';
import { DeprecatedDebugConfigurationProvider, CortexDebugConfigurationProvider } from "./configprovider";

interface SVDInfo {
	expression: RegExp;
	path: string;
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

		Reporting.activate(context);

		context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('examinememory', new MemoryContentProvider()));

		context.subscriptions.push(vscode.commands.registerCommand('cortex-debug.peripherals.updateNode', this.peripheralsUpdateNode.bind(this)));
		context.subscriptions.push(vscode.commands.registerCommand('cortex-debug.peripherals.selectedNode', this.peripheralsSelectedNode.bind(this)));
		context.subscriptions.push(vscode.commands.registerCommand('cortex-debug.peripherals.copyValue', this.peripheralsCopyValue.bind(this)));
		context.subscriptions.push(vscode.commands.registerCommand('cortex-debug.registers.copyValue', this.registersCopyValue.bind(this)));
		context.subscriptions.push(vscode.commands.registerCommand('cortex-debug.examineMemory', this.examineMemory.bind(this)));
		
		context.subscriptions.push(vscode.window.registerTreeDataProvider('cortex-debug.peripherals', this.peripheralProvider));
		context.subscriptions.push(vscode.window.registerTreeDataProvider('cortex-debug.registers', this.registerProvider));	
		
		context.subscriptions.push(vscode.debug.onDidReceiveDebugSessionCustomEvent(this.receivedCustomEvent.bind(this)));
		context.subscriptions.push(vscode.debug.onDidStartDebugSession(this.debugSessionStarted.bind(this)));
		context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(this.debugSessionTerminated.bind(this)));

		context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('jlink-gdb', new DeprecatedDebugConfigurationProvider(context, 'jlink')));
		context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('openocd-gdb', new DeprecatedDebugConfigurationProvider(context, 'openocd')));
		context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('stutil-gdb', new DeprecatedDebugConfigurationProvider(context, 'stutil')));
		context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('pyocd-gdb', new DeprecatedDebugConfigurationProvider(context, 'pyocd')));
		context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('cortex-debug', new CortexDebugConfigurationProvider(context)));
	}

	getSVDFile(device: string): string {
		let entry = this.SVDDirectory.find(de => de.expression.test(device));
		return entry ? entry.path : null;
	}

	examineMemory() {
		function validateValue(address) {
			if(/^0x[0-9a-f]{1,8}$/i.test(address)) {
				return address;
			}
			else if(/^[0-9]+$/i.test(address)) {
				return address;
			}
			else {
				return null;
			}
		}

		if(!vscode.debug.activeDebugSession) {
			vscode.window.showErrorMessage('No debugging session available');
			return;
		}

		vscode.window.showInputBox({
			placeHolder: 'Prefix with 0x for hexidecimal format',
			ignoreFocusOut: true,
			prompt: 'Memory Address'			
		}).then(
			address => {
				if (!validateValue(address)) {
					vscode.window.showErrorMessage('Invalid memory address entered');
					Reporting.sendEvent('examine-memory-invalid-address', { address: address }, {});
					return;
				}

				vscode.window.showInputBox({
					placeHolder: 'Prefix with 0x for hexidecimal format',
					ignoreFocusOut: true,
					prompt: 'Length'
				}).then(
					(length) => {
						if (!validateValue(length)) {
							vscode.window.showErrorMessage('Invalid length entered');
							Reporting.sendEvent('examine-memory-invalid-length', { length: length }, {});
							return;
						}

						Reporting.sendEvent('examine-memory', {}, {});
						let timestamp = new Date().getTime();
						vscode.window.showTextDocument(vscode.Uri.parse(`examinememory:///Memory%20[${address}+${length}]?address=${address}&length=${length}&timestamp=${timestamp}`), { viewColumn: 2 });
					},
					(error) => {

					}
				);
			},
			(error) => {

			}
		);
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

	peripheralsCopyValue(tn: TreeNode): void {
		let cv = tn.node.getCopyValue();
		if (cv) {
			CopyPaste.copy(cv);
		}
	}

	// Registers
	registersCopyValue(tn: RTreeNode): void {
		let cv = tn.node.getCopyValue();
		if (cv) {
			CopyPaste.copy(cv);
		}
	}

	// Debug Events
	debugSessionStarted(session: vscode.DebugSession) {
		// Clean-up Old output channels
		if (this.swo) {
			this.swo.dispose();
			this.swo = null;
		}

		session.customRequest('get-arguments').then(args => {
			let svdfile = args.svdFile;
			if (!svdfile) {
				let basepath = this.getSVDFile(args.device);
				if(basepath) {
					svdfile = path.join(this.context.extensionPath, basepath);
				}
			}

			let info = {
				type: args.servertype,
				swo: args.swoConfig.enabled ? 'enabled' : 'disabled',
				graphing: (args.graphConfig && args.graphConfig.length > 0) ? 'enabled' : 'disabled'
			};

			if (args.type == 'jlink-gdb' || (args.type == 'stutil-gdb' && args.device)) {
				info['device'] = args.device;
			}

			Reporting.sendEvent('debug-session-started', info, {});
			
			this.registerProvider.debugSessionStarted();
			this.peripheralProvider.debugSessionStarted(svdfile ? svdfile : null);

			if(this.swosource) { this.initializeSWO(args); }
		}, error => {
			//TODO: Error handling for unable to get arguments
		});
	}

	debugSessionTerminated(session: vscode.DebugSession) {
		Reporting.sendEvent('debug-session-terminated', {}, {});

		this.registerProvider.debugSessionTerminated();
		this.peripheralProvider.debugSessionTerminated();
		if (this.swo) {
			this.swo.debugSessionTerminated();
		}
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
			case 'record-telemetry-event':
				this.receivedTelemetryEvent(e);
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

	receivedTelemetryEvent(e) {
		Reporting.sendEvent(e.body.event, e.body.properties || {}, e.body.measures || {});
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

		this.swo = new SWOCore(this.swosource, args.swoConfig.decoders, args.graphConfig, this.context.extensionPath);
	}
}

export function activate(context: vscode.ExtensionContext) {
	let extension = new CortexDebugExtension(context);
}
