import * as vscode from 'vscode';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { PeripheralTreeProvider, TreeNode, FieldNode, RecordType, BaseNode } from './peripheral';
import { RegisterTreeProvider, TreeNode as RTreeNode, RecordType as RRecordType, BaseNode as RBaseNode } from './registers';
import { setTimeout } from 'timers';
import { SWOCore } from './swo/core';
import { SWOSource } from './swo/sources/common';
import { SWOConfigureEvent, NumberFormat } from '../common';
import { MemoryContentProvider } from './memory_content_provider';
import Reporting from '../reporting';

import * as CopyPaste from 'copy-paste';
import { DeprecatedDebugConfigurationProvider, CortexDebugConfigurationProvider } from './configprovider';
import { SocketSWOSource } from './swo/sources/socket';
import { FifoSWOSource } from './swo/sources/fifo';
import { FileSWOSource } from './swo/sources/file';
import { SerialSWOSource } from './swo/sources/serial';
import { DisassemblyContentProvider } from './disassembly_content_provider';
import { SymbolInformation, SymbolScope } from '../symbols';

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
            const dirPath = path.join(context.extensionPath, 'data', 'SVDMap.json');
            tmp = JSON.parse(fs.readFileSync(dirPath, 'utf8'));
        }
        catch (e) {}

        this.SVDDirectory = tmp.map((de) => {
            let exp = null;
            if (de.id) { exp = new RegExp('^' + de.id + '$', ''); }
            else { exp = new RegExp(de.expression, de.flags); }

            return { expression: exp, path: de.path };
        });

        Reporting.activate(context);

        context.subscriptions.push(
            vscode.workspace.registerTextDocumentContentProvider('examinememory', new MemoryContentProvider()),
            vscode.workspace.registerTextDocumentContentProvider('disassembly', new DisassemblyContentProvider()),
            vscode.commands.registerCommand('cortex-debug.peripherals.updateNode', this.peripheralsUpdateNode.bind(this)),
            vscode.commands.registerCommand('cortex-debug.peripherals.selectedNode', this.peripheralsSelectedNode.bind(this)),
            vscode.commands.registerCommand('cortex-debug.peripherals.copyValue', this.peripheralsCopyValue.bind(this)),
            vscode.commands.registerCommand('cortex-debug.peripherals.setFormat', this.peripheralsSetFormat.bind(this)),
            vscode.commands.registerCommand('cortex-debug.registers.selectedNode', this.registersSelectedNode.bind(this)),
            vscode.commands.registerCommand('cortex-debug.registers.copyValue', this.registersCopyValue.bind(this)),
            vscode.commands.registerCommand('cortex-debug.registers.setFormat', this.registersSetFormat.bind(this)),
            vscode.commands.registerCommand('cortex-debug.examineMemory', this.examineMemory.bind(this)),
            vscode.commands.registerCommand('cortex-debug.viewDisassembly', this.showDisassembly.bind(this)),
            vscode.commands.registerCommand('cortex-debug.setForceDisassembly', this.setForceDisassembly.bind(this)),
            vscode.window.registerTreeDataProvider('cortex-debug.peripherals', this.peripheralProvider),
            vscode.window.registerTreeDataProvider('cortex-debug.registers', this.registerProvider),
            vscode.debug.onDidReceiveDebugSessionCustomEvent(this.receivedCustomEvent.bind(this)),
            vscode.debug.onDidStartDebugSession(this.debugSessionStarted.bind(this)),
            vscode.debug.onDidTerminateDebugSession(this.debugSessionTerminated.bind(this)),
            vscode.window.onDidChangeActiveTextEditor(this.activeEditorChanged.bind(this)),
            vscode.debug.registerDebugConfigurationProvider('jlink-gdb', new DeprecatedDebugConfigurationProvider(context, 'jlink')),
            vscode.debug.registerDebugConfigurationProvider('openocd-gdb', new DeprecatedDebugConfigurationProvider(context, 'openocd')),
            vscode.debug.registerDebugConfigurationProvider('stutil-gdb', new DeprecatedDebugConfigurationProvider(context, 'stutil')),
            vscode.debug.registerDebugConfigurationProvider('pyocd-gdb', new DeprecatedDebugConfigurationProvider(context, 'pyocd')),
            vscode.debug.registerDebugConfigurationProvider('cortex-debug', new CortexDebugConfigurationProvider(context))
        );
    }

    private getSVDFile(device: string): string {
        const entry = this.SVDDirectory.find((de) => de.expression.test(device));
        return entry ? entry.path : null;
    }

    private activeEditorChanged(editor: vscode.TextEditor) {
        if (editor !== undefined && vscode.debug.activeDebugSession) {
            const uri = editor.document.uri;
            if (uri.scheme === 'file') {
                vscode.debug.activeDebugSession.customRequest('set-active-editor', { path: uri.path });
            }
            else {
                vscode.debug.activeDebugSession.customRequest('set-active-editor', { path: `${uri.scheme}://${uri.authority}${uri.path}` });
            }
        }
    }

    private async showDisassembly() {
        if (!vscode.debug.activeDebugSession) {
            vscode.window.showErrorMessage('No debugging session available');
            return;
        }

        if (!this.functionSymbols) {
            try {
                const resp = await vscode.debug.activeDebugSession.customRequest('load-function-symbols');
                this.functionSymbols = resp.functionSymbols;
            }
            catch (e) {
                vscode.window.showErrorMessage('Unable to load symbol table. Disassembly view unavailable.');
            }
        }

        try {
            const funcname: string = await vscode.window.showInputBox({
                placeHolder: 'main',
                ignoreFocusOut: true,
                prompt: 'Function Name to Disassemble'
            });

            const functions = this.functionSymbols.filter((s) => s.name === funcname);

            let url: string;

            if (functions.length === 0) {
                vscode.window.showErrorMessage(`No function with name ${funcname} found.`);
            }
            else if (functions.length === 1) {
                if (functions[0].scope === SymbolScope.Global) {
                    url = `disassembly:///${functions[0].name}.cdasm`;
                }
                else {
                    url = `disassembly:///${functions[0].file}::${functions[0].name}.cdasm`;
                }
            }
            else {
                const selected = await vscode.window.showQuickPick(functions.map((f) => {
                    return {
                        label: f.name,
                        name: f.name,
                        file: f.file,
                        scope: f.scope,
                        description: f.scope === SymbolScope.Global ? 'Global Scope' : `Static in ${f.file}`
                    };
                }), {
                    ignoreFocusOut: true
                });

                if (selected.scope === SymbolScope.Global) {
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

    private setForceDisassembly() {
        vscode.window.showQuickPick(
            [
                { label: 'Auto', description: 'Show disassembly for functions when source cannot be located.' },
                { label: 'Forced', description: 'Always show disassembly for functions.' }
            ],
            { matchOnDescription: true, ignoreFocusOut: true }
        ).then((result) => {
            const force = result.label === 'Forced';
            vscode.debug.activeDebugSession.customRequest('set-force-disassembly', { force: force });
        }, (error) => {});
    }

    private examineMemory() {
        function validateValue(address) {
            if (/^0x[0-9a-f]{1,8}$/i.test(address)) {
                return address;
            }
            else if (/^[0-9]+$/i.test(address)) {
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
            (address) => {
                if (!validateValue(address)) {
                    vscode.window.showErrorMessage('Invalid memory address entered');
                    Reporting.sendEvent('Examine Memory', 'Invalid Address', address);
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
                            Reporting.sendEvent('Examine Memory', 'Invalid Length', length);
                            return;
                        }

                        Reporting.sendEvent('Examine Memory', 'Valid', `${address}-${length}`);
                        const timestamp = new Date().getTime();
                        // tslint:disable-next-line:max-line-length
                        vscode.workspace.openTextDocument(vscode.Uri.parse(`examinememory:///Memory%20[${address}+${length}].cdmem?address=${address}&length=${length}&timestamp=${timestamp}`))
                                        .then((doc) => {
                                            vscode.window.showTextDocument(doc, { viewColumn: 2 })	;
                                        }, (error) => {
                                            vscode.window.showErrorMessage(`Failed to examine memory: ${error}`);
                                        });
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
    private peripheralsUpdateNode(node: TreeNode): void {
        node.node.performUpdate().then((result) => {
            if (result) {
                this.peripheralProvider.refresh();
            }
        }, (error) => {
            vscode.window.showErrorMessage(`Unable to update value: ${error.toString()}`);
        });
    }

    private peripheralsSelectedNode(node: BaseNode): void {
        if (node.recordType !== RecordType.Field) { node.expanded = !node.expanded; }

        node.selected().then((updated) => {
            if (updated) {
                this.peripheralProvider.refresh();
            }
        }, (error) => {});
    }

    private peripheralsCopyValue(tn: TreeNode): void {
        const cv = tn.node.getCopyValue();
        if (cv) {
            CopyPaste.copy(cv);
        }
    }

    private async peripheralsSetFormat(tn: TreeNode): Promise<void> {
        const result = await vscode.window.showQuickPick([
            { label: 'Auto', description: 'Automatically choose format (Inherits from parent)', value: NumberFormat.Auto },
            { label: 'Hex', description: 'Format value in hexidecimal', value: NumberFormat.Hexidecimal },
            { label: 'Decimal', description: 'Format value in decimal', value: NumberFormat.Decimal },
            { label: 'Binary', description: 'Format value in binary', value: NumberFormat.Binary }
        ]);

        tn.node.setFormat(result.value);
        this.peripheralProvider.refresh();
    }

    // Registers
    private registersSelectedNode(node: BaseNode): void {
        if (node.recordType !== RRecordType.Field) { node.expanded = !node.expanded; }
    }

    private registersCopyValue(tn: RTreeNode): void {
        const cv = tn.node.getCopyValue();
        if (cv) {
            CopyPaste.copy(cv);
        }
    }

    private async registersSetFormat(tn: RTreeNode): Promise<void> {
        const result = await vscode.window.showQuickPick([
            { label: 'Auto', description: 'Automatically choose format (Inherits from parent)', value: NumberFormat.Auto },
            { label: 'Hex', description: 'Format value in hexidecimal', value: NumberFormat.Hexidecimal },
            { label: 'Decimal', description: 'Format value in decimal', value: NumberFormat.Decimal },
            { label: 'Binary', description: 'Format value in binary', value: NumberFormat.Binary }
        ]);
        
        tn.node.setFormat(result.value);
        this.registerProvider.refresh();
    }

    // Debug Events
    private debugSessionStarted(session: vscode.DebugSession) {
        // Clean-up Old output channels
        if (this.swo) {
            this.swo.dispose();
            this.swo = null;
        }

        this.functionSymbols = null;

        session.customRequest('get-arguments').then((args) => {
            let svdfile = args.svdFile;
            if (!svdfile) {
                const basepath = this.getSVDFile(args.device);
                if (basepath) {
                    svdfile = path.join(this.context.extensionPath, basepath);
                }
            }

            const info = {
                type: args.servertype,
                swo: args.swoConfig.enabled ? 'enabled' : 'disabled',
                graphing: (args.graphConfig && args.graphConfig.length > 0) ? 'enabled' : 'disabled'
            };

            if (args.type === 'jlink-gdb' || (args.type === 'stutil-gdb' && args.device)) {
                info['device'] = args.device;
            }

            Reporting.beginSession();
            
            this.registerProvider.debugSessionStarted();
            this.peripheralProvider.debugSessionStarted(svdfile ? svdfile : null);

            if (this.swosource) { this.initializeSWO(args); }
        }, (error) => {
            // TODO: Error handling for unable to get arguments
        });
    }

    private debugSessionTerminated(session: vscode.DebugSession) {
        Reporting.endSession();

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

    private receivedCustomEvent(e: vscode.DebugSessionCustomEvent) {
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
            case 'record-event':
                this.receivedEvent(e);
                break;
            default:
                break;

        }
    }

    private receivedStopEvent(e) {
        this.peripheralProvider.debugStopped();
        this.registerProvider.debugStopped();
        if (this.swo) { this.swo.debugStopped(); }
    }

    private receivedContinuedEvent(e) {
        this.peripheralProvider.debugContinued();
        this.registerProvider.debugContinued();
        if (this.swo) { this.swo.debugContinued(); }
    }

    private receivedEvent(e) {
        Reporting.sendEvent(e.body.category, e.body.action, e.body.label, e.body.parameters);
    }

    private receivedSWOConfigureEvent(e) {
        if (e.body.type === 'socket') {
            this.swosource = new SocketSWOSource(e.body.port);
        }
        else if (e.body.type === 'fifo') {
            this.swosource = new FifoSWOSource(e.body.path);
        }
        else if (e.body.type === 'file') {
            this.swosource = new FileSWOSource(e.body.path);
        }
        else if (e.body.type === 'serial') {
            this.swosource = new SerialSWOSource(e.body.device, e.body.baudRate, this.context.extensionPath);
        }

        if (vscode.debug.activeDebugSession) {
            vscode.debug.activeDebugSession.customRequest('get-arguments').then((args) => {
                this.initializeSWO(args);
            });
        }
    }

    private receivedAdapterOutput(e) {
        if (!this.adapterOutputChannel) {
            this.adapterOutputChannel = vscode.window.createOutputChannel('Adapter Output');
        }

        let output = e.body.content;
        if (!output.endsWith('\n')) { output += '\n'; }
        this.adapterOutputChannel.append(output);
    }

    private initializeSWO(args) {
        if (!this.swosource) {
            vscode.window.showErrorMessage('Tried to initialize SWO Decoding without a SWO data source');
            return;
        }

        this.swo = new SWOCore(this.swosource, args, this.context.extensionPath);
    }
}

export function activate(context: vscode.ExtensionContext) {
    const extension = new CortexDebugExtension(context);
}
