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
import { SWOConfigureEvent, NumberFormat } from "../common";
import { MemoryContentProvider } from './memory_content_provider';
import Reporting from '../reporting';

import * as CopyPaste from 'copy-paste';
import { DeprecatedDebugConfigurationProvider, CortexDebugConfigurationProvider } from "./configprovider";
import { SocketSWOSource } from "./swo/sources/socket";
import { FifoSWOSource } from "./swo/sources/fifo";
import { FileSWOSource } from "./swo/sources/file";
import { SerialSWOSource } from "./swo/sources/serial";
import { DisassemblyContentProvider } from "./disassembly_content_provider";
import { SymbolInformation, SymbolScope } from "../symbols";

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
	private functionSymbols: SymbolInformation[] = null;

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
		context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('disassembly', new DisassemblyContentProvider()));

		context.subscriptions.push(vscode.commands.registerCommand('cortex-debug.peripherals.updateNode', this.peripheralsUpdateNode.bind(this)));
		context.subscriptions.push(vscode.commands.registerCommand('cortex-debug.peripherals.selectedNode', this.peripheralsSelectedNode.bind(this)));
		context.subscriptions.push(vscode.commands.registerCommand('cortex-debug.peripherals.copyValue', this.peripheralsCopyValue.bind(this)));
		context.subscriptions.push(vscode.commands.registerCommand('cortex-debug.peripherals.setFormat', this.peripheralsSetFormat.bind(this)));
		context.subscriptions.push(vscode.commands.registerCommand('cortex-debug.registers.copyValue', this.registersCopyValue.bind(this)));
		context.subscriptions.push(vscode.commands.registerCommand('cortex-debug.registers.setFormat', this.registersSetFormat.bind(this)));
		context.subscriptions.push(vscode.commands.registerCommand('cortex-debug.examineMemory', this.examineMemory.bind(this)));
		context.subscriptions.push(vscode.commands.registerCommand('cortex-debug.viewDisassembly', this.showDisassembly.bind(this)));
		context.subscriptions.push(vscode.commands.registerCommand('cortex-debug.setForceDisassembly', this.setForceDisassembly.bind(this)));
		
		context.subscriptions.push(vscode.window.registerTreeDataProvider('cortex-debug.peripherals', this.peripheralProvider));
		context.subscriptions.push(vscode.window.registerTreeDataProvider('cortex-debug.registers', this.registerProvider));	
		
		context.subscriptions.push(vscode.debug.onDidReceiveDebugSessionCustomEvent(this.receivedCustomEvent.bind(this)));
		context.subscriptions.push(vscode.debug.onDidStartDebugSession(this.debugSessionStarted.bind(this)));
		context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(this.debugSessionTerminated.bind(this)));
		context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(this.activeEditorChanged.bind(this)));

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

	activeEditorChanged(editor: vscode.TextEditor) {
		if (editor !== undefined && vscode.debug.activeDebugSession) {
			let uri = editor.document.uri;
			if (uri.scheme == 'file') {
				vscode.debug.activeDebugSession.customRequest('set-active-editor', { path: uri.path });
			}
			else {
				vscode.debug.activeDebugSession.customRequest('set-active-editor', { path: `${uri.scheme}://${uri.authority}${uri.path}` });
			}
		}
	}

	async showDisassembly() {
		if (!vscode.debug.activeDebugSession) {
			vscode.window.showErrorMessage('No debugging session available');
			return;
		}

		if (!this.functionSymbols) {
			try {
				let resp = await vscode.debug.activeDebugSession.customRequest('load-function-symbols');
				this.functionSymbols = resp.functionSymbols;
			}
			catch (e) {
				vscode.window.showErrorMessage('Unable to load symbol table. Disassembly view unavailable.');
			}
		}

		try {
			let funcname: string = await vscode.window.showInputBox({
				placeHolder: 'main',
				ignoreFocusOut: true,
				prompt: 'Function Name to Disassemble'
			});

			let functions = this.functionSymbols.filter(s => s.name == funcname);

			let url: string;

			if (functions.length === 0) {
				vscode.window.showErrorMessage(`No function with name ${funcname} found.`);
			}
			else if (functions.length === 1) {
				if (functions[0].scope == SymbolScope.Global) {
					url = `disassembly:///${functions[0].name}.cdasm`;
				}
				else {
					url = `disassembly:///${functions[0].file}::${functions[0].name}.cdasm`;
				}
			}
			else {
				let selected = await vscode.window.showQuickPick(functions.map(f => {
					return {
						label: f.name,
						name: f.name,
						file: f.file,
						scope: f.scope,
						description: f.scope == SymbolScope.Global ? 'Global Scope' : `Static in ${f.file}`
					};
				}), {
					ignoreFocusOut: true
				});

				if (selected.scope == SymbolScope.Global) {
					url = `disassembly:///${selected.name}.cdasm`;
				}
				else {
					url = `disassembly:///${selected.file}::${selected.name}.cdasm`;
				}
			}

			vscode.window.showTextDocument(vscode.Uri.parse(url));
		}
		catch (e) {
			vscode.window.showErrorMessage('Unable to show disassembly.');
		}
	}

	setForceDisassembly() {
		vscode.window.showQuickPick(
			[
				{ label: 'Auto', description: 'Show disassembly for functions when source cannot be located.' },
				{ label: 'Forced', description: 'Always show disassembly for functions.' }
			], 
			{ matchOnDescription: true, ignoreFocusOut: true }
		).then((result) => {
			let force = result.label == 'Forced';
			vscode.debug.activeDebugSession.customRequest('set-force-disassembly', { force: force });
		}, error => {});
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

		if (!vscode.debug.activeDebugSession) {
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
						vscode.workspace.openTextDocument(vscode.Uri.parse(`examinememory:///Memory%20[${address}+${length}].cdmem?address=${address}&length=${length}&timestamp=${timestamp}`))
										.then((doc) => {
											vscode.window.showTextDocument(doc, { viewColumn: 2 })	;
										}, (error) => {
											vscode.window.showErrorMessage(`Failed to examine memory: ${error}`);
										})
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

	async peripheralsSetFormat(tn: TreeNode): Promise<void> {
		let result = await vscode.window.showQuickPick([
			{ label: "Auto", description: "Automatically choose format (Inherits from parent otherwise binary for fields that are 3 bits or less, hexidecimal otherwise)", value: NumberFormat.Auto },
			{ label: "Hex", description: "Format value in hexidecimal", value: NumberFormat.Hexidecimal },
			{ label: "Decimal", description: "Format value in decimal", value: NumberFormat.Decimal },
			{ label: "Binary", description: "Format value in binary", value: NumberFormat.Binary }
		]);

		tn.node.setFormat(result.value);
		this.peripheralProvider.refresh();
	}

	// Registers
	registersCopyValue(tn: RTreeNode): void {
		let cv = tn.node.getCopyValue();
		if (cv) {
			CopyPaste.copy(cv);
		}
	}

	async registersSetFormat(tn: RTreeNode): Promise<void> {
		let result = await vscode.window.showQuickPick([
			{ label: "Auto", description: "Automatically choose format (Inherits from parent otherwise binary for fields that are 3 bits or less, hexidecimal otherwise)", value: NumberFormat.Auto },
			{ label: "Hex", description: "Format value in hexidecimal", value: NumberFormat.Hexidecimal },
			{ label: "Decimal", description: "Format value in decimal", value: NumberFormat.Decimal },
			{ label: "Binary", description: "Format value in binary", value: NumberFormat.Binary }
		]);
		

	}

	// Debug Events
	debugSessionStarted(session: vscode.DebugSession) {
		// Clean-up Old output channels
		if (this.swo) {
			this.swo.dispose();
			this.swo = null;
		}

		this.functionSymbols = null;

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
		if (e.body.type == 'socket') {
			this.swosource = new SocketSWOSource(e.body.port);
		}
		else if (e.body.type == 'fifo') {
			this.swosource = new FifoSWOSource(e.body.path);
		}
		else if (e.body.type == 'file') {
			this.swosource = new FileSWOSource(e.body.path);
		}
		else if (e.body.type == 'serial') {
			this.swosource = new SerialSWOSource(e.body.device, e.body.baudRate, this.context.extensionPath);
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

		this.swo = new SWOCore(this.swosource, args, this.context.extensionPath);
	}
}

export function activate(context: vscode.ExtensionContext) {
	let extension = new CortexDebugExtension(context);
}
