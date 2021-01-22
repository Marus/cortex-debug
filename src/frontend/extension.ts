import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { PeripheralTreeProvider } from './views/peripheral';
import { RegisterTreeProvider } from './views/registers';
import { BaseNode, PeripheralBaseNode } from './views/nodes/basenode';

import { SWOCore } from './swo/core';
import { SWOSource } from './swo/sources/common';
import { NumberFormat, ConfigurationArguments } from '../common';
import { MemoryContentProvider } from './memory_content_provider';
import Reporting from '../reporting';

import { CortexDebugConfigurationProvider } from './configprovider';
import { SocketSWOSource } from './swo/sources/socket';
import { FifoSWOSource } from './swo/sources/fifo';
import { FileSWOSource } from './swo/sources/file';
import { SerialSWOSource } from './swo/sources/serial';
import { DisassemblyContentProvider } from './disassembly_content_provider';
import { SymbolInformation, SymbolScope } from '../symbols';
import { Cluster } from 'cluster';

interface SVDInfo {
    expression: RegExp;
    path: string;
}

export class CortexDebugExtension {
    private adapterOutputChannel: vscode.OutputChannel = null;
    private clearAdapterOutputChannel = false;
    private swo: SWOCore = null;
    private swosource: SWOSource = null;

    private peripheralProvider: PeripheralTreeProvider;
    private registerProvider: RegisterTreeProvider;
    private memoryProvider: MemoryContentProvider;

    private peripheralTreeView: vscode.TreeView<PeripheralBaseNode>;
    private registerTreeView: vscode.TreeView<BaseNode>;

    private SVDDirectory: SVDInfo[] = [];
    private functionSymbols: SymbolInformation[] = null;

    constructor(private context: vscode.ExtensionContext) {
        this.peripheralProvider = new PeripheralTreeProvider();
        this.registerProvider = new RegisterTreeProvider();
        this.memoryProvider = new MemoryContentProvider();

        let tmp = [];
        try {
            const dirPath = path.join(context.extensionPath, 'data', 'SVDMap.json');
            tmp = JSON.parse(fs.readFileSync(dirPath, 'utf8'));
        }
        catch (e) {}

        Reporting.activate(context);

        this.peripheralTreeView = vscode.window.createTreeView('cortex-debug.peripherals', {
            treeDataProvider: this.peripheralProvider
        });

        this.registerTreeView = vscode.window.createTreeView('cortex-debug.registers', {
            treeDataProvider: this.registerProvider
        });

        context.subscriptions.push(
            vscode.workspace.registerTextDocumentContentProvider('examinememory', this.memoryProvider),
            vscode.workspace.registerTextDocumentContentProvider('disassembly', new DisassemblyContentProvider()),

            vscode.commands.registerCommand('cortex-debug.peripherals.updateNode', this.peripheralsUpdateNode.bind(this)),
            vscode.commands.registerCommand('cortex-debug.peripherals.copyValue', this.peripheralsCopyValue.bind(this)),
            vscode.commands.registerCommand('cortex-debug.peripherals.setFormat', this.peripheralsSetFormat.bind(this)),
            vscode.commands.registerCommand('cortex-debug.peripherals.forceRefresh', this.peripheralsForceRefresh.bind(this)),
            vscode.commands.registerCommand('cortex-debug.peripherals.pin', this.peripheralsTogglePin.bind(this)),
            vscode.commands.registerCommand('cortex-debug.peripherals.unpin', this.peripheralsTogglePin.bind(this)),
            
            vscode.commands.registerCommand('cortex-debug.registers.copyValue', this.registersCopyValue.bind(this)),
            
            vscode.commands.registerCommand('cortex-debug.examineMemory', this.examineMemory.bind(this)),
            vscode.commands.registerCommand('cortex-debug.viewDisassembly', this.showDisassembly.bind(this)),
            vscode.commands.registerCommand('cortex-debug.setForceDisassembly', this.setForceDisassembly.bind(this)),

            vscode.debug.onDidReceiveDebugSessionCustomEvent(this.receivedCustomEvent.bind(this)),
            vscode.debug.onDidStartDebugSession(this.debugSessionStarted.bind(this)),
            vscode.debug.onDidTerminateDebugSession(this.debugSessionTerminated.bind(this)),
            vscode.window.onDidChangeActiveTextEditor(this.activeEditorChanged.bind(this)),
            vscode.window.onDidChangeTextEditorSelection((e: vscode.TextEditorSelectionChangeEvent) => {
                if (e && e.textEditor.document.fileName.endsWith('.cdmem')) { this.memoryProvider.handleSelection(e); }
            }),

            vscode.debug.registerDebugConfigurationProvider('cortex-debug', new CortexDebugConfigurationProvider(context)),

            this.registerTreeView,
            this.registerTreeView.onDidCollapseElement((e) => {
                e.element.expanded = false;
            }),
            this.registerTreeView.onDidExpandElement((e) => {
                e.element.expanded = true;
            }),
            this.peripheralTreeView,
            this.peripheralTreeView.onDidExpandElement((e) => {
                e.element.expanded = true;
                e.element.getPeripheral().updateData();
                this.peripheralProvider.refresh();
            }),
            this.peripheralTreeView.onDidCollapseElement((e) => {
                e.element.expanded = false;
            })
        );
    }

    private getSVDFile(device: string): string {
        const entry = this.SVDDirectory.find((de) => de.expression.test(device));
        return entry ? entry.path : null;
    }

    public registerSVDFile(expression: RegExp | string, path: string): void {
        if (typeof expression === 'string') {
            expression = new RegExp(`^${expression}$`, '');
        }

        this.SVDDirectory.push({ expression: expression, path: path });
    }

    private activeEditorChanged(editor: vscode.TextEditor) {
        if (editor !== undefined && vscode.debug.activeDebugSession && vscode.debug.activeDebugSession.type === 'cortex-debug') {
            const uri = editor.document.uri;
            if (uri.scheme === 'file') {
                // vscode.debug.activeDebugSession.customRequest('set-active-editor', { path: uri.path });
            }
            else if (uri.scheme === 'disassembly') {
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
            let funcname: string = await vscode.window.showInputBox({
                placeHolder: 'main',
                ignoreFocusOut: true,
                prompt: 'Function Name (exact or a regexp) to Disassemble.'
            });
            
            funcname = funcname ? funcname.trim() : null;
            if (!funcname) { return ; }

            let functions = this.functionSymbols.filter((s) => s.name === funcname);
            if (functions.length === 0) {
                let regExp = new RegExp(funcname);
                if (funcname.endsWith('/i')) {
                    // This is not the best way or UI. But this is the only flag that makes sense
                    regExp = new RegExp(funcname.substring(0, funcname.length - 2), 'i');
                }
                functions = this.functionSymbols.filter((s) => regExp.test(s.name));
            }

            let url: string;

            if (functions.length === 0) {
                vscode.window.showErrorMessage(`No function matching name/regexp '${funcname}' found.`);
            }
            else if (functions.length === 1) {
                if (!functions[0].file || (functions[0].scope === SymbolScope.Global)) {
                    url = `disassembly:///${functions[0].name}.cdasm`;
                }
                else {
                    url = `disassembly:///${functions[0].file}:::${functions[0].name}.cdasm`;
                }
            }
            else if (functions.length > 31) { /* arbitrary limit. 31 is prime! */
                vscode.window.showErrorMessage(`Too many(${functions.length}) functions matching '${funcname}' found.`);
            }
            else {
                const selected = await vscode.window.showQuickPick(functions.map((f) => {
                    return {
                        label: f.name,
                        name: f.name,
                        file: f.file,
                        scope: f.scope,
                        description: (!f.file || (f.scope === SymbolScope.Global)) ? 'Global Scope' : `Static in ${f.file}`
                    };
                }), {
                    ignoreFocusOut: true
                });

                if (!selected.file || (selected.scope === SymbolScope.Global)) {
                    url = `disassembly:///${selected.name}.cdasm`;
                }
                else {
                    url = `disassembly:///${selected.file}:::${selected.name}.cdasm`;
                }
            }

            if (url) {
                vscode.window.showTextDocument(vscode.Uri.parse(url));
            }
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
            Reporting.sendEvent('Force Disassembly', 'Set', force ? 'Forced' : 'Auto');
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

        function validateAddress(address: string) {
            if (address === '') {
                return null;
            }
            return address;
        }

        if (!vscode.debug.activeDebugSession) {
            vscode.window.showErrorMessage('No debugging session available');
            return;
        }

        vscode.window.showInputBox({
            placeHolder: 'Enter a valid C/gdb expression. Use 0x prefix for hexidecimal numbers',
            ignoreFocusOut: true,
            prompt: 'Memory Address'
        }).then(
            (address) => {
                address = address.trim();
                if (!validateAddress(address)) {
                    vscode.window.showErrorMessage('Invalid memory address entered');
                    Reporting.sendEvent('Examine Memory', 'Invalid Address', address);
                    return;
                }

                vscode.window.showInputBox({
                    placeHolder: 'Enter a constant value. Prefix with 0x for hexidecimal format.',
                    ignoreFocusOut: true,
                    prompt: 'Length'
                }).then(
                    (length) => {
                        length = length.trim();
                        if (!validateValue(length)) {
                            vscode.window.showErrorMessage('Invalid length entered');
                            Reporting.sendEvent('Examine Memory', 'Invalid Length', length);
                            return;
                        }

                        Reporting.sendEvent('Examine Memory', 'Valid', `${address}-${length}`);
                        const timestamp = new Date().getTime();
                        const addrEnc = encodeURIComponent(`${address}`);
                        // tslint:disable-next-line:max-line-length
                        vscode.workspace.openTextDocument(vscode.Uri.parse(`examinememory:///Memory%20[${addrEnc},${length}].cdmem?address=${addrEnc}&length=${length}&timestamp=${timestamp}`))
                            .then((doc) => {
                                vscode.window.showTextDocument(doc, { viewColumn: 2, preview: false });
                                Reporting.sendEvent('Examine Memory', 'Used');
                            }, (error) => {
                                vscode.window.showErrorMessage(`Failed to examine memory: ${error}`);
                                Reporting.sendEvent('Examine Memory', 'Error', error.toString());
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
    private peripheralsUpdateNode(node: PeripheralBaseNode): void {
        node.performUpdate().then((result) => {
            if (result) {
                this.peripheralProvider.refresh();
                Reporting.sendEvent('Peripheral View', 'Update Node');
            }
        }, (error) => {
            vscode.window.showErrorMessage(`Unable to update value: ${error.toString()}`);
        });
    }

    private peripheralsCopyValue(node: PeripheralBaseNode): void {
        const cv = node.getCopyValue();
        if (cv) {
            vscode.env.clipboard.writeText(cv).then(() => {
                Reporting.sendEvent('Peripheral View', 'Copy Value');
            });
        }
    }

    private async peripheralsSetFormat(node: PeripheralBaseNode): Promise<void> {
        const result = await vscode.window.showQuickPick([
            { label: 'Auto', description: 'Automatically choose format (Inherits from parent)', value: NumberFormat.Auto },
            { label: 'Hex', description: 'Format value in hexidecimal', value: NumberFormat.Hexidecimal },
            { label: 'Decimal', description: 'Format value in decimal', value: NumberFormat.Decimal },
            { label: 'Binary', description: 'Format value in binary', value: NumberFormat.Binary }
        ]);
        if (result === undefined)
            return;

        node.format = result.value;
        this.peripheralProvider.refresh();
        Reporting.sendEvent('Peripheral View', 'Set Format', result.label);
    }

    private async peripheralsForceRefresh(node: PeripheralBaseNode): Promise<void> {
        node.getPeripheral().updateData().then((e) => {
            this.peripheralProvider.refresh();
        });
    }

    private async peripheralsTogglePin(node: PeripheralBaseNode): Promise<void> {
        this.peripheralProvider.togglePinPeripheral(node);
        this.peripheralProvider.refresh();
    }

    // Registers
    private registersCopyValue(node: BaseNode): void {
        const cv = node.getCopyValue();
        if (cv) {
            vscode.env.clipboard.writeText(cv).then(() => {
                Reporting.sendEvent('Register View', 'Copy Value');
            });
        }
    }

    // Debug Events
    private debugSessionStarted(session: vscode.DebugSession) {
        if (session.type !== 'cortex-debug') { return; }

        // Clean-up Old output channels
        if (this.swo) {
            this.swo.dispose();
            this.swo = null;
        }

        this.functionSymbols = null;

        session.customRequest('get-arguments').then((args) => {
            let svdfile = args.svdFile;
            if (!svdfile) {
                svdfile = this.getSVDFile(args.device);
            }

            Reporting.beginSession(args as ConfigurationArguments);
            
            this.registerProvider.debugSessionStarted();
            this.peripheralProvider.debugSessionStarted(svdfile ? svdfile : null);

            if (this.swosource) { this.initializeSWO(args); }
        }, (error) => {
            // TODO: Error handling for unable to get arguments
        });
    }

    private debugSessionTerminated(session: vscode.DebugSession) {
        if (session.type !== 'cortex-debug') { return; }

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
        this.clearAdapterOutputChannel = true;
    }

    private receivedCustomEvent(e: vscode.DebugSessionCustomEvent) {
        if (vscode.debug.activeDebugSession && vscode.debug.activeDebugSession.type !== 'cortex-debug') { return; }
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
        vscode.workspace.textDocuments.filter((td) => td.fileName.endsWith('.cdmem'))
            .forEach((doc) => { this.memoryProvider.update(doc); });
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
            Reporting.sendEvent('SWO', 'Source', 'Socket');
        }
        else if (e.body.type === 'fifo') {
            this.swosource = new FifoSWOSource(e.body.path);
            Reporting.sendEvent('SWO', 'Source', 'FIFO');
        }
        else if (e.body.type === 'file') {
            this.swosource = new FileSWOSource(e.body.path);
            Reporting.sendEvent('SWO', 'Source', 'File');
        }
        else if (e.body.type === 'serial') {
            this.swosource = new SerialSWOSource(e.body.device, e.body.baudRate, this.context.extensionPath);
            Reporting.sendEvent('SWO', 'Source', 'Serial');
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
            this.adapterOutputChannel.show();
        } else if (this.clearAdapterOutputChannel) {
            this.adapterOutputChannel.clear();
        }
        this.clearAdapterOutputChannel = false;

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
    return new CortexDebugExtension(context);
}

export function deactivate() {}
