import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { PeripheralTreeProvider } from './views/peripheral';
import { RegisterTreeProvider } from './views/registers';
import { BaseNode, PeripheralBaseNode } from './views/nodes/basenode';

import { RTTCore, SWOCore } from './swo/core';
import { SWORTTSource } from './swo/sources/common';
import { NumberFormat, ConfigurationArguments,
    RTTCommonDecoderOpts, RTTConsoleDecoderOpts,
    CortexDebugKeys, ChainedEvents } from '../common';
import { MemoryContentProvider } from './memory_content_provider';
import Reporting from '../reporting';

import { CortexDebugConfigurationProvider } from './configprovider';
import { SocketRTTSource, SocketSWOSource } from './swo/sources/socket';
import { FifoSWOSource } from './swo/sources/fifo';
import { FileSWOSource } from './swo/sources/file';
import { SerialSWOSource } from './swo/sources/serial';
import { DisassemblyContentProvider } from './disassembly_content_provider';
import { SymbolInformation, SymbolScope } from '../symbols';
import { RTTTerminal } from './rtt_terminal';
import { GDBServerConsole } from './server_console';

const commandExistsSync = require('command-exists').sync;
interface SVDInfo {
    expression: RegExp;
    path: string;
}

export class CortexDebugExtension {
    private adapterOutputChannel: vscode.OutputChannel = null;
    private clearAdapterOutputChannel = false;
    private swo: SWOCore = null;
    private rtt: RTTCore = null;
    private swoSource: SWORTTSource = null;
    private rttTerminals: RTTTerminal[] = [];
    private rttPortMap: { [channel: number]: SocketRTTSource} = {};
    private gdbServerConsole: GDBServerConsole = null;
    private finishedTerminalSetup = false;

    private peripheralProvider: PeripheralTreeProvider;
    private registerProvider: RegisterTreeProvider;
    private memoryProvider: MemoryContentProvider;

    private peripheralTreeView: vscode.TreeView<PeripheralBaseNode>;
    private registerTreeView: vscode.TreeView<BaseNode>;

    private SVDDirectory: SVDInfo[] = [];
    private functionSymbols: SymbolInformation[] = null;
    private debuggerStatus: 'started' | 'stopped' | 'running' | 'none';
    private currentArgs: any = null;

    constructor(private context: vscode.ExtensionContext) {
        const config = vscode.workspace.getConfiguration('cortex-debug');
        this.startServerConsole(context, config.get(CortexDebugKeys.SERVER_LOG_FILE_NAME, '')); // Make this the first thing we do to be ready for the session
        this.peripheralProvider = new PeripheralTreeProvider();
        this.registerProvider = new RegisterTreeProvider();
        this.memoryProvider = new MemoryContentProvider();

        this.debuggerStatus = 'none';
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

        vscode.commands.executeCommand('setContext', `cortex-debug:${CortexDebugKeys.REGISTER_DISPLAY_MODE}`,
            config.get(CortexDebugKeys.REGISTER_DISPLAY_MODE, true));
        vscode.commands.executeCommand('setContext', `cortex-debug:${CortexDebugKeys.VARIABLE_DISPLAY_MODE}`,
            config.get(CortexDebugKeys.VARIABLE_DISPLAY_MODE, true));
                  
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
            vscode.commands.registerCommand('cortex-debug.registers.refresh', this.registersRefresh.bind(this)),
            vscode.commands.registerCommand('cortex-debug.registers.regHexModeTurnOn', this.registersNaturalMode.bind(this, false)),
            vscode.commands.registerCommand('cortex-debug.registers.regHexModeTurnOff', this.registersNaturalMode.bind(this, true)),
            vscode.commands.registerCommand('cortex-debug.registers.varHexModeTurnOn', this.variablesNaturalMode.bind(this, false)),
            vscode.commands.registerCommand('cortex-debug.registers.varHexModeTurnOff', this.variablesNaturalMode.bind(this, true)),

            vscode.commands.registerCommand('cortex-debug.examineMemory', this.examineMemory.bind(this)),
            vscode.commands.registerCommand('cortex-debug.viewDisassembly', this.showDisassembly.bind(this)),
            vscode.commands.registerCommand('cortex-debug.setForceDisassembly', this.setForceDisassembly.bind(this)),

            vscode.commands.registerCommand('cortex-debug.resetDevice', this.resetDevice.bind(this)),

            vscode.workspace.onDidChangeConfiguration(this.settingsChanged.bind(this)),
            vscode.debug.onDidReceiveDebugSessionCustomEvent(this.receivedCustomEvent.bind(this)),
            vscode.debug.onDidStartDebugSession(this.debugSessionStarted.bind(this)),
            vscode.debug.onDidTerminateDebugSession(this.debugSessionTerminated.bind(this)),
            vscode.window.onDidChangeActiveTextEditor(this.activeEditorChanged.bind(this)),
            vscode.window.onDidCloseTerminal(this.terminalClosed.bind(this)),
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

    private resetDevice() {
        if (vscode.debug.activeDebugSession) {
            vscode.debug.activeDebugSession.customRequest('reset-device');
        }
    }

    private startServerConsole(context: vscode.ExtensionContext, logFName: string = ''): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const rptMsg = 'Please report this problem.';
            this.gdbServerConsole = new GDBServerConsole(context, logFName);
            this.gdbServerConsole.startServer().then(() => {
                console.log('GDB server console created');
                this.finishedTerminalSetup = true;
                resolve(); // All worked out
            }).catch((e) => {
                this.gdbServerConsole.dispose();
                this.gdbServerConsole = null;
                vscode.window.showErrorMessage(`Could not create gdb-server-console. Will use old style console. Please report this problem. ${e.toString()}`);
            });
        });
    }

    private settingsChanged(e: vscode.ConfigurationChangeEvent) {
        const msg = 'New format will take effect next time the program pauses';
        if (e.affectsConfiguration(`cortex-debug.${CortexDebugKeys.REGISTER_DISPLAY_MODE}`)) {
            if (vscode.debug.activeDebugSession) {
                if (this.debuggerStatus === 'running') {
                    vscode.window.showInformationMessage(msg);
                } else {
                    if (this.currentArgs && !this.currentArgs.noDebug) {
                        this.registerProvider.refresh();
                    }
                }
            }
        }
        if (e.affectsConfiguration(`cortex-debug.${CortexDebugKeys.VARIABLE_DISPLAY_MODE}`)) {
            if (vscode.debug.activeDebugSession) {
                const config = vscode.workspace.getConfiguration('cortex-debug');
                const isHex = config.get(CortexDebugKeys.VARIABLE_DISPLAY_MODE, true) ? false : true;
                vscode.debug.activeDebugSession.customRequest('set-var-format', { hex: isHex });
                if (this.debuggerStatus === 'running') {
                    vscode.window.showInformationMessage(msg);
                }
            }
        }
        if (e.affectsConfiguration(`cortex-debug.${CortexDebugKeys.SERVER_LOG_FILE_NAME}`)) {
            const config = vscode.workspace.getConfiguration('cortex-debug');
            const fName = config.get(CortexDebugKeys.SERVER_LOG_FILE_NAME, '');
            this.gdbServerConsole.createLogFile(fName);
        }
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
                vscode.window.showInformationMessage(`No function matching name/regexp '${funcname}' found.\n` +
                    'Please report this problem if you think it in error. We will need your executable to debug.');
                url = `disassembly:///${funcname}.cdasm`;
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
            placeHolder: 'Enter a valid C/gdb expression. Use 0x prefix for hexadecimal numbers',
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
                    placeHolder: 'Enter a constant value. Prefix with 0x for hexadecimal format.',
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
            { label: 'Hex', description: 'Format value in hexadecimal', value: NumberFormat.Hexadecimal },
            { label: 'Decimal', description: 'Format value in decimal', value: NumberFormat.Decimal },
            { label: 'Binary', description: 'Format value in binary', value: NumberFormat.Binary }
        ]);
        if (result === undefined) {
            return;
        }

        node.format = result.value;
        this.peripheralProvider.refresh();
        Reporting.sendEvent('Peripheral View', 'Set Format', result.label);
    }

    private async peripheralsForceRefresh(node: PeripheralBaseNode): Promise<void> {
        if (node) {
            node.getPeripheral().updateData().then((e) => {
                this.peripheralProvider.refresh();
            });
        } else {
            this.peripheralProvider.refresh();
        }
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

    private registersRefresh(): void {
        if (this.currentArgs && !this.currentArgs.noDebug) {
            this.registerProvider.refresh();
        }
    }

    // Settings changes
    private registersNaturalMode(newVal: any) {
        const config = vscode.workspace.getConfiguration('cortex-debug');

        vscode.commands.executeCommand('setContext', `cortex-debug:${CortexDebugKeys.REGISTER_DISPLAY_MODE}`, newVal);
        try {
            config.update(CortexDebugKeys.REGISTER_DISPLAY_MODE, newVal);
        }
        catch (e) {
            console.error(e);
        }
    }

    private variablesNaturalMode(newVal: boolean, cxt?: any) {
        // 'cxt' contains the treeItem on which this menu was invoked. Maybe we can do something
        // with it later
        const config = vscode.workspace.getConfiguration('cortex-debug');

        vscode.commands.executeCommand('setContext', `cortex-debug:${CortexDebugKeys.VARIABLE_DISPLAY_MODE}`, newVal);
        try {
            config.update(CortexDebugKeys.VARIABLE_DISPLAY_MODE, newVal);
        }
        catch (e) {
            console.error(e);
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
        if (this.rtt) {
            this.rtt.dispose();
            this.rtt = null;
        }

        this.functionSymbols = null;
        this.debuggerStatus = 'started';

        session.customRequest('get-arguments').then((args) => {
            this.currentArgs = args;
            let svdfile = args.svdFile;
            if (!svdfile) {
                svdfile = this.getSVDFile(args.device);
            }

            Reporting.beginSession(args as ConfigurationArguments);

            if (this.swoSource) { this.initializeSWO(args); }
            if (Object.keys(this.rttPortMap).length > 0) { this.initializeRTT(args); }

            if (!this.currentArgs.noDebug) {
                this.registerProvider.debugSessionStarted(session);
            }
            this.peripheralProvider.debugSessionStarted(session, (svdfile && !args.noDebug) ? svdfile : null, args.svdAddrGapThreshold);
            this.cleanupRTTTerminals();
        }, (error) => {
            // TODO: Error handling for unable to get arguments
        });
    }

    private debugSessionTerminated(session: vscode.DebugSession) {
        if (session.type !== 'cortex-debug') { return; }

        try {
            Reporting.endSession();

            this.debuggerStatus = 'none';
            if (!this.currentArgs.noDebug) {
                this.registerProvider.debugSessionTerminated(session);
            }
            this.peripheralProvider.debugSessionTerminated(session);
            if (this.swo) {
                this.swo.debugSessionTerminated();
            }
            if (this.swoSource) {
                this.swoSource.dispose();
                this.swoSource = null;
            }
            if (this.rtt) {
                this.rtt.debugSessionTerminated();
            }
            for (const term of this.rttTerminals) {
                // All though they mark themselves as unused when socket closes, that won't happen
                // if a connection never happened.
                term.inUse = false;
            }
            // tslint:disable-next-line: forin
            for (const ch in this.rttPortMap) {
                this.rttPortMap[ch].dispose();
            }
            this.rttPortMap = {};

            this.clearAdapterOutputChannel = true;
            this.currentArgs = null;
        }
        catch (e) {
            vscode.window.showInformationMessage(`Debug session did not terminate cleanly ${e}\n${e ? e.stackstrace : ''}. Please report this problem`);
        }
        
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
            case 'rtt-configure':
                this.receivedRTTConfigureEvent(e);
                break;
            case 'adapter-output':
                this.receivedAdapterOutput(e);
                break;
            case 'record-event':
                this.receivedEvent(e);
                break;
            case 'custom-event-post-start-server':
                this.startChainedLaunches(e, ChainedEvents.POSTSTART);
                break;
            case 'custom-event-post-start-gdb':
                this.startChainedLaunches(e, ChainedEvents.POSTINIT);
                break;
            default:
                break;
        }
    }

    private startChainedLaunches(e: vscode.DebugSessionCustomEvent, evType: ChainedEvents) {
        const adapterArtgs = e?.body as ConfigurationArguments;
        if (!adapterArtgs || !adapterArtgs.chainedLaunches?.enabled) { return; }
        let delay = 0;
        for (const launch of adapterArtgs.chainedLaunches.launches) {
            if (launch.enabled && (launch.waitOnEvent === evType) && launch.name) {
                const childOptions: vscode.DebugSessionOptions = {
                    parentSession            : vscode.debug.activeDebugSession,
                    lifecycleManagedByParent : launch.detached ? false : true,
                    consoleMode              : launch.detached ? vscode.DebugConsoleMode.Separate : vscode.DebugConsoleMode.MergeWithParent,
                    noDebug                  : adapterArtgs.noDebug,
                    compact                  : false
                };
                delay += Math.max(launch.delayMs || 1, 1);
                setTimeout(() => {
                    vscode.debug.startDebugging(undefined, launch.name, childOptions);
                }, delay);
            }
        }
    }

    private receivedStopEvent(e) {
        this.debuggerStatus = 'stopped';
        this.peripheralProvider.debugStopped(vscode.debug.activeDebugSession);
        if (this.currentArgs && !this.currentArgs.noDebug) {
            this.registerProvider.debugStopped();
        }
        vscode.workspace.textDocuments.filter((td) => td.fileName.endsWith('.cdmem'))
            .forEach((doc) => { this.memoryProvider.update(doc); });
        if (this.swo) { this.swo.debugStopped(); }
        if (this.rtt) { this.rtt.debugStopped(); }
    }

    private receivedContinuedEvent(e) {
        this.debuggerStatus = 'running';
        this.peripheralProvider.debugContinued();
        if (this.currentArgs && !this.currentArgs.noDebug) {
            this.registerProvider.debugContinued();
        }
        if (this.swo) { this.swo.debugContinued(); }
        if (this.rtt) { this.rtt.debugContinued(); }
    }

    private receivedEvent(e) {
        Reporting.sendEvent(e.body.category, e.body.action, e.body.label, e.body.parameters);
    }

    private receivedSWOConfigureEvent(e) {
        if (e.body.type === 'socket') {
            const src = new SocketSWOSource(e.body.port);
            src.start().then(() => {
                this.swoSource = src;
            }).catch((e) => {
                vscode.window.showErrorMessage(`Could not open SWO TCP port ${e.body.port} ${e}`);
            });
            Reporting.sendEvent('SWO', 'Source', 'Socket');
        }
        else if (e.body.type === 'fifo') {
            this.swoSource = new FifoSWOSource(e.body.path);
            Reporting.sendEvent('SWO', 'Source', 'FIFO');
        }
        else if (e.body.type === 'file') {
            this.swoSource = new FileSWOSource(e.body.path);
            Reporting.sendEvent('SWO', 'Source', 'File');
        }
        else if (e.body.type === 'serial') {
            this.swoSource = new SerialSWOSource(e.body.device, e.body.baudRate, this.context.extensionPath);
            Reporting.sendEvent('SWO', 'Source', 'Serial');
        }

        // I don't think the following is needed as we already initialize SWO when the session finally starts
        if (vscode.debug.activeDebugSession) {
            vscode.debug.activeDebugSession.customRequest('get-arguments').then((args) => {
                this.initializeSWO(args);
            });
        }
    }

    private receivedRTTConfigureEvent(e: any) {
        if (e.body.type === 'socket') {
            const decoder: RTTCommonDecoderOpts = e.body.decoder;
            if ((decoder.type === 'console') || (decoder.type === 'binary')) {
                Reporting.sendEvent('RTT', 'Source', 'Socket: Console');
                this.rttCreateTerninal(decoder as RTTConsoleDecoderOpts);
            } else {
                Reporting.sendEvent('RTT', 'Source', `Socket: ${decoder.type}`);
                if (!decoder.ports) {
                    this.createRTTSource(decoder.tcpPort, decoder.port);
                } else {
                    for (let ix = 0; ix < decoder.ports.length; ix = ix + 1) {
                        // Hopefully ports and tcpPorts are a matched set
                        this.createRTTSource(decoder.tcpPorts[ix], decoder.ports[ix]);
                    }
                }
            }
        } else {
            console.error('receivedRTTConfigureEvent: unknown type: ' + e.body.type);
        }
    }

    // The retured value is a connection source. It may still be in disconnected
    // state.
    private createRTTSource(tcpPort: string, channel: number): SocketRTTSource {
        let src = this.rttPortMap[channel];
        if (!src) {
            src = new SocketRTTSource(tcpPort, channel);
            this.rttPortMap[channel] = src;     // Yes, we put this in the list even if start() can fail
            src.start().then(() => {
                // Nothing to do
            }).catch ((e) => {
                vscode.window.showErrorMessage(`Could not open to RTT channel ${channel}, TCP Port ${tcpPort}. ${e}`);
            });
        }
        return src;
    }

    private cleanupRTTTerminals() {
        this.rttTerminals = this.rttTerminals.filter((t) => {
            if (!t.inUse) {
                t.dispose();
                return false;
            }
            return true;
        });
    }

    private async rttCreateTerninal(decoder: RTTConsoleDecoderOpts) {
        const src = this.createRTTSource(decoder.tcpPort, decoder.port);
        for (const terminal of this.rttTerminals) {
            const success = !terminal.inUse && terminal.tryReuse(decoder, src);
            if (success) {
                if (vscode.debug.activeDebugConsole) {
                    vscode.debug.activeDebugConsole.appendLine(
                        `Reusing RTT terminal for channel ${decoder.port} on tcp port ${decoder.tcpPort}`
                    );
                }
                return;
            }
        }
        const newTerminal = new RTTTerminal(this.context, decoder, src);
        this.rttTerminals.push(newTerminal);
        if (vscode.debug.activeDebugConsole) {
            vscode.debug.activeDebugConsole.appendLine(
                `Created RTT terminal for channel ${decoder.port} on tcp port ${decoder.tcpPort}`
            );
        }
    }

    private terminalClosed(terminal: vscode.Terminal) {
        this.rttTerminals = this.rttTerminals.filter((t) => t.terminal !== terminal);
    }

    private receivedAdapterOutput(e) {
        let output = e.body.content;
        if (!output.endsWith('\n')) { output += '\n'; }
        if (!this.adapterOutputChannel) {
            this.adapterOutputChannel = vscode.window.createOutputChannel('Adapter Output');
            this.adapterOutputChannel.appendLine('DEPRECATED: Please check the \'TERMINALS\' tab for \'gdb-server\' output. ' +
                'This \'Adapter Output\' will not appear in future releases');
            // this.adapterOutputChannel.show();
        } else if (this.clearAdapterOutputChannel) {
            this.adapterOutputChannel.clear();
        }
        this.clearAdapterOutputChannel = false;

        this.adapterOutputChannel.append(output);
    }

    private initializeSWO(args) {
        if (!this.swoSource) {
            vscode.window.showErrorMessage('Tried to initialize SWO Decoding without a SWO data source');
            return;
        }

        if (!this.swo) {
            this.swo = new SWOCore(this.swoSource, args, this.context.extensionPath);
        }
    }

    private initializeRTT(args) {
        if (!this.rtt) {
            this.rtt = new RTTCore(this.rttPortMap, args, this.context.extensionPath);
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
    return new CortexDebugExtension(context);
}

export function deactivate() {}
