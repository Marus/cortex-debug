import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { PeripheralTreeProvider } from './views/peripheral';
import { RegisterTreeProvider } from './views/registers';
import { BaseNode, PeripheralBaseNode } from './views/nodes/basenode';

import { RTTCore, SWOCore } from './swo/core';
import { NumberFormat, ConfigurationArguments,
    RTTCommonDecoderOpts, RTTConsoleDecoderOpts,
    CortexDebugKeys, ChainedEvents, ADAPTER_DEBUG_MODE } from '../common';
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
import { CDebugSession, CDebugChainedSessionItem } from './cortex_debug_session';
import { ServerConsoleLog } from '../backend/server';

const commandExistsSync = require('command-exists').sync;
interface SVDInfo {
    expression: RegExp;
    path: string;
}

export class CortexDebugExtension {
    private rttTerminals: RTTTerminal[] = [];

    private gdbServerConsole: GDBServerConsole = null;

    private peripheralProvider: PeripheralTreeProvider;
    private registerProvider: RegisterTreeProvider;
    private memoryProvider: MemoryContentProvider;

    private peripheralTreeView: vscode.TreeView<PeripheralBaseNode>;
    private registerTreeView: vscode.TreeView<BaseNode>;

    private SVDDirectory: SVDInfo[] = [];
    private functionSymbols: SymbolInformation[] = null;

    constructor(private context: vscode.ExtensionContext) {
        const config = vscode.workspace.getConfiguration('cortex-debug');
        this.startServerConsole(context, config.get(CortexDebugKeys.SERVER_LOG_FILE_NAME, '')); // Make this the first thing we do to be ready for the session
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
            vscode.commands.registerCommand('cortex-debug.varHexModeTurnOn', this.variablesNaturalMode.bind(this, false)),
            vscode.commands.registerCommand('cortex-debug.varHexModeTurnOff', this.variablesNaturalMode.bind(this, true)),
            vscode.commands.registerCommand('cortex-debug.toggleVariableHexFormat', this.toggleVariablesHexMode.bind(this)),

            vscode.commands.registerCommand('cortex-debug.examineMemory', this.examineMemory.bind(this)),
            vscode.commands.registerCommand('cortex-debug.viewDisassembly', this.showDisassembly.bind(this)),
            vscode.commands.registerCommand('cortex-debug.setForceDisassembly', this.setForceDisassembly.bind(this)),

            vscode.commands.registerCommand('cortex-debug.resetDevice', this.resetDevice.bind(this)),
            vscode.commands.registerCommand('cortex-debug.pvtEnableDebug', this.pvtCycleDebugMode.bind(this)),

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

    public static getActiveCDSession() {
        const session = vscode.debug.activeDebugSession;
        if (session?.type === 'cortex-debug') {
            return session;
        }
        return null;
    }

    private resetDevice() {
        const session = CortexDebugExtension.getActiveCDSession();
        if (session) {
            session.customRequest('reset-device', 'reset');
        }
    }

    private startServerConsole(context: vscode.ExtensionContext, logFName: string = ''): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const rptMsg = 'Please report this problem.';
            this.gdbServerConsole = new GDBServerConsole(context, logFName);
            this.gdbServerConsole.startServer().then(() => {
                console.log('GDB server console created');
                resolve(); // All worked out
            }).catch((e) => {
                this.gdbServerConsole.dispose();
                this.gdbServerConsole = null;
                vscode.window.showErrorMessage(`Could not create gdb-server-console. Will use old style console. Please report this problem. ${e.toString()}`);
            });
        });
    }

    private settingsChanged(e: vscode.ConfigurationChangeEvent) {
        if (e.affectsConfiguration(`cortex-debug.${CortexDebugKeys.REGISTER_DISPLAY_MODE}`)) {
            let count = 0;
            for (const s of CDebugSession.CurrentSessions) {
                // Session may not have actually started according to VSCode but we know of it
                if ((s.status === 'stopped') && this.isDebugging(s.session)) {
                    this.registerProvider.refresh(s.session);
                    count++;
                }
            }
            if (count !== CDebugSession.CurrentSessions.length) {
                const partial = count > 0 ? 'Some sessions updated. ' : '';
                const msg = `Cortex-Debug: ${partial}New format will take effect next time the session pauses`;
                vscode.window.showInformationMessage(msg);
            }
        }
        if (e.affectsConfiguration(`cortex-debug.${CortexDebugKeys.VARIABLE_DISPLAY_MODE}`)) {
            const config = vscode.workspace.getConfiguration('cortex-debug');
            const isHex = config.get(CortexDebugKeys.VARIABLE_DISPLAY_MODE, true) ? false : true;
            let foundStopped = false;
            for (const s of CDebugSession.CurrentSessions) {
                try {
                    // Session may not have actually started according to VSCode but we know of it
                    if (this.isDebugging(s.session)) {
                        s.session.customRequest('set-var-format', { hex: isHex });
                        if (s.status === 'stopped') {
                            foundStopped = true;
                        }
                    }
                }
                catch (e) {
                }
            }
            if (!foundStopped) {
                const fmt = isHex ? 'hex' : 'dec';
                const msg = `Cortex-Debug: Variables window format "${fmt}" will take effect next time the session pauses`;
                vscode.window.showInformationMessage(msg);
            }
        }
        if (e.affectsConfiguration(`cortex-debug.${CortexDebugKeys.SERVER_LOG_FILE_NAME}`)) {
            const config = vscode.workspace.getConfiguration('cortex-debug');
            const fName = config.get(CortexDebugKeys.SERVER_LOG_FILE_NAME, '');
            this.gdbServerConsole.createLogFile(fName);
        }
        if (e.affectsConfiguration(`cortex-debug.${CortexDebugKeys.DEV_DEBUG_MODE}`)) {
            const config = vscode.workspace.getConfiguration('cortex-debug');
            const dbgMode = config.get(CortexDebugKeys.DEV_DEBUG_MODE, ADAPTER_DEBUG_MODE.NONE);
            for (const s of CDebugSession.CurrentSessions) {
                try {
                    s.session.customRequest('set-debug-mode', { mode: dbgMode });
                }
                catch (e) {
                }
            }
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
        const session = CortexDebugExtension.getActiveCDSession();
        if (editor !== undefined && session) {
            const uri = editor.document.uri;
            if (uri.scheme === 'file') {
                // vscode.debug.activeDebugSession.customRequest('set-active-editor', { path: uri.path });
            }
            else if (uri.scheme === 'disassembly') {
                session.customRequest('set-active-editor', { path: `${uri.scheme}://${uri.authority}${uri.path}` });
            }
        }
    }

    private async showDisassembly() {
        const session = CortexDebugExtension.getActiveCDSession();
        if (!session) {
            vscode.window.showErrorMessage('No cortex-debug debugging session available');
            return;
        }

        if (!this.functionSymbols) {
            try {
                const resp = await session.customRequest('load-function-symbols');
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
        const session = CortexDebugExtension.getActiveCDSession();
        if (!session) {
            vscode.window.showErrorMessage('Command not valid when cortex-debug session not active');
            return;
        }
        vscode.window.showQuickPick(
            [
                { label: 'Auto', description: 'Show disassembly for functions when source cannot be located.' },
                { label: 'Forced', description: 'Always show disassembly for functions.' }
            ],
            { matchOnDescription: true, ignoreFocusOut: true }
        ).then((result) => {
            const force = result.label === 'Forced';
            session.customRequest('set-force-disassembly', { force: force });
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

        const session = CortexDebugExtension.getActiveCDSession();
        if (!session) {
            vscode.window.showErrorMessage('No cortex-debug session available');
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
        const session = CortexDebugExtension.getActiveCDSession();
        if (session && this.isDebugging(session)) {
            this.registerProvider.refresh(session);
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

    private toggleVariablesHexMode() {
        // 'cxt' contains the treeItem on which this menu was invoked. Maybe we can do something
        // with it later
        const config = vscode.workspace.getConfiguration('cortex-debug');
        const curVal = config.get(CortexDebugKeys.VARIABLE_DISPLAY_MODE, true);
        const newVal = !curVal;
        vscode.commands.executeCommand('setContext', `cortex-debug:${CortexDebugKeys.VARIABLE_DISPLAY_MODE}`, newVal);
        try {
            config.update(CortexDebugKeys.VARIABLE_DISPLAY_MODE, newVal);
        }
        catch (e) {
            console.error(e);
        }
    }

    private pvtCycleDebugMode() {
        const config = vscode.workspace.getConfiguration('cortex-debug');
        const curVal: ADAPTER_DEBUG_MODE = config.get(CortexDebugKeys.DEV_DEBUG_MODE, ADAPTER_DEBUG_MODE.NONE);
        const validVals = Object.values(ADAPTER_DEBUG_MODE);
        let ix = validVals.indexOf(curVal);
        ix = ix < 0 ? ix = 0 : ((ix + 1) % validVals.length);
        config.set(CortexDebugKeys.DEV_DEBUG_MODE, validVals[ix]);
    }

    // Debug Events
    private debugSessionStarted(session: vscode.DebugSession) {
        if (session.type !== 'cortex-debug') { return; }

        const newSession = CDebugSession.NewSessionStarted(session);

        this.functionSymbols = null;
        session.customRequest('get-arguments').then((args) => {
            newSession.config = args;
            let svdfile = args.svdFile;
            if (!svdfile) {
                svdfile = this.getSVDFile(args.device);
            }

            Reporting.beginSession(session.id, args as ConfigurationArguments);

            if (newSession.swoSource) {
                this.initializeSWO(session, args);
            }
            if (Object.keys(newSession.rttPortMap).length > 0) {
                this.initializeRTT(session, args);
            }

            if (this.isDebugging(session)) {
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
        const mySession = CDebugSession.FindSession(session);
        try {
            Reporting.endSession(session.id);

            if (this.isDebugging(session)) {
                this.registerProvider.debugSessionTerminated(session);
            }
            this.peripheralProvider.debugSessionTerminated(session);
            if (mySession?.swo) {
                mySession.swo.debugSessionTerminated();
            }
            if (mySession?.swoSource) {
                mySession.swoSource.dispose();
            }
            if (mySession?.rtt) {
                mySession.rtt.debugSessionTerminated();
            }
            if (mySession?.rttPortMap) {
                for (const ch of Object.keys(mySession.rttPortMap)) {
                    mySession.rttPortMap[ch].dispose();
                }
                mySession.rttPortMap = {};
            }
        }
        catch (e) {
            vscode.window.showInformationMessage(`Debug session did not terminate cleanly ${e}\n${e ? e.stackstrace : ''}. Please report this problem`);
        }
        finally {
            CDebugSession.RemoveSession(session);
        }
    }

    private receivedCustomEvent(e: vscode.DebugSessionCustomEvent) {
        const session = e.session;
        if (session.type !== 'cortex-debug') { return; }
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
            case 'record-event':
                this.receivedEvent(e);
                break;
            case 'custom-event-open-disassembly':
                vscode.commands.executeCommand('editor.debug.action.openDisassemblyView');
                break;
            case 'custom-event-post-start-server':
                this.startChainedConfigs(e, ChainedEvents.POSTSTART);
                break;
            case 'custom-event-post-start-gdb':
                this.startChainedConfigs(e, ChainedEvents.POSTINIT);
                break;
            case 'custom-event-session-terminating':
                ServerConsoleLog('Got event for sessions terminating', process.pid);
                this.endChainedConfigs(e);
                break;
            case 'custom-event-session-restart':
                this.resetOrResartChained(e, 'restart');
                break;
            case 'custom-event-session-reset':
                this.resetOrResartChained(e, 'reset');
                break;
            case 'custom-event-popup':
                const msg = e.body.info?.message;
                switch (e.body.info?.type) {
                    case 'warning':
                        vscode.window.showWarningMessage(msg);
                        break;
                    case 'error':
                        vscode.window.showErrorMessage(msg);
                        break;
                    default:
                        vscode.window.showInformationMessage(msg);
                        break;
                }
                break;
            default:
                break;
        }
    }

    private startChainedConfigs(e: vscode.DebugSessionCustomEvent, evType: ChainedEvents) {
        const adapterArgs = e?.body?.info as ConfigurationArguments;
        if (!adapterArgs || !adapterArgs.chainedConfigurations?.enabled) { return; }
        const cDbgParent = CDebugSession.GetSession(e.session, adapterArgs);
        const unique = adapterArgs.chainedConfigurations.launches.filter((x, ix) => {
            return ix === adapterArgs.chainedConfigurations.launches.findIndex((v, ix) => v.name === x.name);
        });
        let delay = 0;
        for (const launch of unique) {
            if (launch.enabled && (launch.waitOnEvent === evType) && launch.name) {
                const childOptions: vscode.DebugSessionOptions = {
                    consoleMode              : vscode.DebugConsoleMode.Separate,
                    noDebug                  : adapterArgs.noDebug,
                    compact                  : false
                };
                if (launch.lifecycleManagedByParent) {
                    // VSCode 'lifecycleManagedByParent' does not work as documented. The fact that there
                    // is a parent means it is managed and 'lifecycleManagedByParent' if ignored.
                    childOptions.lifecycleManagedByParent = true;
                    childOptions.parentSession = e.session;
                }
                delay += Math.max(launch.delayMs || 0, 0);
                const child = new CDebugChainedSessionItem(cDbgParent, launch, childOptions);
                const folder = this.getWsFolder(launch.folder, e.session.workspaceFolder);
                setTimeout(() => {
                    vscode.debug.startDebugging(folder, launch.name, childOptions).then((success) => {
                        if (!success) {
                            vscode.window.showErrorMessage('Failed to launch chained configuration ' + launch.name);
                        }
                        CDebugChainedSessionItem.RemoveItem(child);
                    });
                }, delay);
                delay += 5;
            }
        }
    }

    private endChainedConfigs(e: vscode.DebugSessionCustomEvent) {
        const mySession = CDebugSession.FindSession(e.session);
        if (mySession && mySession.hasChildren) {
            // Note that we may not be the root, but we have children. Also we do not modify the tree while iterating it
            const deathList: CDebugSession[] = [];
            const orphanList: CDebugSession[] = [];
            mySession.broadcastDFS((s) => {
                if (s === mySession) { return; }
                if (s.config.pvtMyConfigFromParent.lifecycleManagedByParent) {
                    deathList.push(s);      // Qualifies to be terminated
                } else {
                    orphanList.push(s);     // This child is about to get orphaned
                }
            }, false);

            // According to current scheme, there should not be any orphaned children.
            while (orphanList.length > 0) {
                const s = orphanList.pop();
                s.moveToRoot();     // Or should we move to our parent. TODO: fix for when we are going to have grand children
            }

            while (deathList.length > 0) {
                const s = deathList.pop();
                // We cannot actually use the following API. We have to do this ourselves. Probably because we own
                // the lifetime management.
                // vscode.debug.stopDebugging(s.session);
                ServerConsoleLog(`Sending custom-stop-debugging to ${s.session.name}`, process.pid);
                s.session.customRequest('custom-stop-debugging', e.body.info).then(() => {
                }, (reason) => {
                    vscode.window.showErrorMessage(`Cortex-Debug: Bug? session.customRequest('set-stop-debugging-type', ... failed ${reason}\n`);
                });
            }
            // Following does not work. Apparently, a customRequest cannot be sent probably because this session is already
            // terminating.
            // mySession.session.customRequest('notified-children-to-terminate');
        }
    }

    private resetOrResartChained(e: vscode.DebugSessionCustomEvent, type: 'reset' | 'restart') {
        const mySession = CDebugSession.FindSession(e.session);
        if (mySession && mySession.hasChildren) {
            mySession.broadcastDFS((s) => {
                if (s === mySession) { return; }
                if (s.config.pvtMyConfigFromParent.lifecycleManagedByParent) {
                    s.session.customRequest('reset-device', type).then(() => {
                    }, (reason) => {
                    });
                }
            }, false);
        }
    }

    private getWsFolder(folder: string, def: vscode.WorkspaceFolder): vscode.WorkspaceFolder {
        if (folder) {
            folder = path.normalize(folder);
            for (const f of vscode.workspace.workspaceFolders) {
                if ((f.uri.path === folder) || (f.uri.fsPath === folder) || (f.name === folder)) {
                    return f;
                }
            }
        }
        return def;
    }

    private getCurrentArgs(session: vscode.DebugSession): ConfigurationArguments | vscode.DebugConfiguration {
        if (!session) {
            session = vscode.debug.activeDebugSession;
            if (!session || (session.type !== 'cortex-debug') ) {
                return undefined;
            }
        }
        const ourSession = CDebugSession.FindSession(session);
        if (ourSession) {
            return ourSession.config;
        }
        return session.configuration;
    }

    private getCurrentProp(session: vscode.DebugSession, prop: string) {
        const args = this.getCurrentArgs(session);
        return args ? args[prop] : undefined;
    }

    // Assuming 'session' valid and it a cortex-debug session
    private isDebugging(session: vscode.DebugSession) {
        const noDebug = this.getCurrentProp(session, 'noDebug');
        return (noDebug !== true);       // If it is exactly equal to 'true' we are doing a 'run without debugging'
    }

    private receivedStopEvent(e: vscode.DebugSessionCustomEvent) {
        const mySession = CDebugSession.FindSession(e.session);
        mySession.status = 'stopped';
        this.peripheralProvider.debugStopped(e.session);
        if (this.isDebugging(e.session)) {
            this.registerProvider.debugStopped(e.session);
        }
        vscode.workspace.textDocuments.filter((td) => td.fileName.endsWith('.cdmem'))
            .forEach((doc) => { this.memoryProvider.update(doc); });
        if (mySession.swo) { mySession.swo.debugStopped(); }
        if (mySession.rtt) { mySession.rtt.debugStopped(); }
    }

    private receivedContinuedEvent(e: vscode.DebugSessionCustomEvent) {
        const mySession = CDebugSession.FindSession(e.session);
        mySession.status = 'running';
        this.peripheralProvider.debugContinued();
        if (this.isDebugging(e.session)) {
            this.registerProvider.debugContinued();
        }
        if (mySession.swo) { mySession.swo.debugContinued(); }
        if (mySession.rtt) { mySession.rtt.debugContinued(); }
    }

    private receivedEvent(e) {
        Reporting.sendEvent(e.body.category, e.body.action, e.body.label, e.body.parameters);
    }

    private receivedSWOConfigureEvent(e: vscode.DebugSessionCustomEvent) {
        const mySession = CDebugSession.GetSession(e.session);
        if (e.body.type === 'socket') {
            const src = new SocketSWOSource(e.body.port);
            mySession.swoSource = src;
            this.initializeSWO(e.session, e.body.args);
            src.start().then(() => {
                console.log(`Connected after ${src.nTries} tries`);
                // Do nothing...
            }, (e) => {
                vscode.window.showErrorMessage(`Could not open SWO TCP port ${e.body.port} ${e} after ${src.nTries} tries`);
            });
            Reporting.sendEvent('SWO', 'Source', 'Socket');
            return;
        }
        else if (e.body.type === 'fifo') {
            mySession.swoSource = new FifoSWOSource(e.body.path);
            Reporting.sendEvent('SWO', 'Source', 'FIFO');
        }
        else if (e.body.type === 'file') {
            mySession.swoSource = new FileSWOSource(e.body.path);
            Reporting.sendEvent('SWO', 'Source', 'File');
        }
        else if (e.body.type === 'serial') {
            mySession.swoSource = new SerialSWOSource(e.body.device, e.body.baudRate, this.context.extensionPath);
            Reporting.sendEvent('SWO', 'Source', 'Serial');
        }

        this.initializeSWO(e.session, e.body.args);
    }

    private receivedRTTConfigureEvent(e: vscode.DebugSessionCustomEvent) {
        if (e.body.type === 'socket') {
            const decoder: RTTCommonDecoderOpts = e.body.decoder;
            if ((decoder.type === 'console') || (decoder.type === 'binary')) {
                Reporting.sendEvent('RTT', 'Source', 'Socket: Console');
                this.rttCreateTerninal(e, decoder as RTTConsoleDecoderOpts);
            } else {
                Reporting.sendEvent('RTT', 'Source', `Socket: ${decoder.type}`);
                if (!decoder.ports) {
                    this.createRTTSource(e, decoder.tcpPort, decoder.port);
                } else {
                    for (let ix = 0; ix < decoder.ports.length; ix = ix + 1) {
                        // Hopefully ports and tcpPorts are a matched set
                        this.createRTTSource(e, decoder.tcpPorts[ix], decoder.ports[ix]);
                    }
                }
            }
        } else {
            console.error('receivedRTTConfigureEvent: unknown type: ' + e.body.type);
        }
    }

    // The returned value is a connection source. It may still be in disconnected
    // state.
    private createRTTSource(e: vscode.DebugSessionCustomEvent, tcpPort: string, channel: number): Promise<SocketRTTSource> {
        const mySession = CDebugSession.GetSession(e.session);
        return new Promise((resolve, reject) => {
            let src = mySession.rttPortMap[channel];
            if (src) {
                resolve(src);
                return;
            }
            src = new SocketRTTSource(tcpPort, channel);
            mySession.rttPortMap[channel] = src;     // Yes, we put this in the list even if start() can fail
            resolve(src);                       // Yes, it is okay to resolve it even though the connection isn't made yet
            src.start().then(() => {
                // Do nothing
            }).catch((e) => {
                vscode.window.showErrorMessage(`Could not connect to RTT TCP port ${tcpPort} ${e}`);
                reject(e);
            });
        });
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

    private rttCreateTerninal(e: vscode.DebugSessionCustomEvent, decoder: RTTConsoleDecoderOpts) {
        this.createRTTSource(e, decoder.tcpPort, decoder.port).then((src: SocketRTTSource) => {
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
        });
    }

    private terminalClosed(terminal: vscode.Terminal) {
        this.rttTerminals = this.rttTerminals.filter((t) => t.terminal !== terminal);
    }

    private initializeSWO(session: vscode.DebugSession, args) {
        const mySession = CDebugSession.FindSession(session);
        if (!mySession.swoSource) {
            vscode.window.showErrorMessage('Tried to initialize SWO Decoding without a SWO data source');
            return;
        }

        if (!mySession.swo) {
            mySession.swo = new SWOCore(session, mySession.swoSource, args, this.context.extensionPath);
        }
    }

    private initializeRTT(session: vscode.DebugSession, args) {
        const mySession = CDebugSession.FindSession(session);
        if (!mySession.rtt) {
            mySession.rtt = new RTTCore(mySession.rttPortMap, args, this.context.extensionPath);
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
    return new CortexDebugExtension(context);
}

export function deactivate() {}
