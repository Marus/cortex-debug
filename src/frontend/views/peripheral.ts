import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TreeItem, TreeDataProvider, EventEmitter, Event, TreeItemCollapsibleState, debug, workspace, ProviderResult} from 'vscode';
import { NodeSetting } from '../../common';
import reporting from '../../reporting';
import { BaseNode, PeripheralBaseNode } from './nodes/basenode';
import { PeripheralNode } from './nodes/peripheralnode';
import { SVDParser } from '../svd';
import { MessageNode } from './nodes/messagenode';
import { AddrRange } from '../addrranges';
import { CortexDebugExtension } from '../extension';

export class PeripheralTreeForSession extends PeripheralBaseNode {
    public myTreeItem: TreeItem;
    private peripherials: PeripheralNode[] = [];
    private loaded: boolean = false;
    private svdFileName: string;
    private gapThreshold: number = 16;
    private errMessage: string = 'No SVD file loaded';
    private wsFolderPath: string;
    
    constructor(
        public session: vscode.DebugSession,
        public state: vscode.TreeItemCollapsibleState,
        private fireCb: () => void) {
        super();
        try {
            // Remember the path as it may not be available when session ends
            this.wsFolderPath = this.session.workspaceFolder.uri.fsPath;
        } catch {}
        this.myTreeItem = new TreeItem(this.session.name, this.state);
    }

    public saveState(fspath: string): NodeSetting[] {
        const state: NodeSetting[] = [];
        this.peripherials.forEach((p) => {
            state.push(... p.saveState());
        });
        
        try {
            if (fspath) {
                fs.mkdirSync(path.dirname(fspath), { recursive: true });
                fs.writeFileSync(fspath, JSON.stringify(state), { encoding: 'utf8', flag: 'w' });
            }
        }
        catch (e) {
            vscode.window.showWarningMessage(`Unable to save periperal preferences ${e}`);
        }
        return state;
    }
    
    private loadSVD(): Promise<any> {
        return new Promise((resolve, reject) => {
            try {
                this.errMessage = `Loading ${this.svdFileName}`;
                SVDParser.parseSVD(this.session, this.svdFileName, this.gapThreshold).then((peripherals) => {
                    this.peripherials = peripherals;
                    this.loaded = true;
                    this.errMessage = '';
                    resolve(true);
                }).catch ((e) => {
                    this.peripherials = [];
                    this.loaded = false;
                    reject(e);
                });
            }
            catch (e) {
                reject(e);
            }
        });
    }

    public performUpdate(): Thenable<any> {
        throw new Error('Method not implemented.');
    }
    public updateData(): Thenable<boolean> {
        if (this.loaded) {
            const promises = this.peripherials.map((p) => p.updateData());
            Promise.all(promises).then((_) => { this.fireCb(); }, (_) => { this.fireCb(); });
        }
        return Promise.resolve(true);
    }
    public getPeripheral(): PeripheralBaseNode {
        throw new Error('Method not implemented.');
    }
    public collectRanges(ary: AddrRange[]): void {
        throw new Error('Method not implemented.');
    }
    public findByPath(path: string[]): PeripheralBaseNode {
        throw new Error('Method not implemented.');     // Shouldn't be called
    }

    private findNodeByPath(path: string): PeripheralBaseNode {
        const pathParts = path.split('.');
        const peripheral = this.peripherials.find((p) => p.name === pathParts[0]);
        if (!peripheral) { return null; }
        
        return peripheral.findByPath(pathParts.slice(1));
    }

    public refresh(): void {
        this.fireCb();
    }

    public getTreeItem(element?: BaseNode): TreeItem | Promise<TreeItem> {
        return element ? element.getTreeItem() : this.myTreeItem;
    }

    public getChildren(element?: PeripheralBaseNode): PeripheralBaseNode[] | Promise<PeripheralBaseNode[]> {
        if (this.loaded) {
            return element ? element.getChildren() : this.peripherials;
        } else if (!this.loaded) {
            return [new MessageNode(this.errMessage)];
        } else {
            return this.peripherials;
        }
    }
    public getCopyValue(): string {
        return undefined;
    }

    public sessionStarted(SVDFile: string, thresh: any): Thenable<any> {
        this.svdFileName = SVDFile;
        if (!path.isAbsolute(this.svdFileName) && this.wsFolderPath) {
            const fullpath = path.normalize(path.join(this.wsFolderPath, this.svdFileName));
            this.svdFileName = fullpath;
        }

        if (((typeof thresh) === 'number') && (thresh < 0)) {
            this.gapThreshold = -1;     // Never merge register reads even if adjacent
        } else {
            // Set the threshold between 0 and 32, with a default of 16 and a mukltiple of 8
            this.gapThreshold = ((((typeof thresh) === 'number') ? Math.max(0, Math.min(thresh, 32)) : 16) + 7) & ~0x7;
        }

        return new Promise<void>((resolve, reject) => {
            this.peripherials = [];
            this.fireCb();
            
            this.loadSVD().then(() => {
                const fspath = this.stateFileName();
                if (fspath && fs.existsSync(fspath)) {
                    const data = fs.readFileSync(fspath, 'utf8');
                    const settings = JSON.parse(data);
                    settings.forEach((s: NodeSetting) => {
                        const node = this.findNodeByPath(s.node);
                        if (node) {
                            node.expanded = s.expanded || false;
                            node.pinned = s.pinned || false;
                            node.format = s.format;
                        }
                    });
                }
                this.peripherials.sort(PeripheralNode.compare);
                this.fireCb();
                resolve(undefined);
                reporting.sendEvent('Peripheral View', 'Used', this.svdFileName);
            }, (e) => {
                this.errMessage = `Unable to parse SVD file ${this.svdFileName}: ${e.toString()}`;
                vscode.window.showErrorMessage(this.errMessage);
                if (vscode.debug.activeDebugConsole) {
                    vscode.debug.activeDebugConsole.appendLine(this.errMessage);
                }
                this.fireCb();
                resolve(undefined);
                reporting.sendEvent('Peripheral View', 'Error', e.toString());
            });
        });
    }

    public stateFileName(): string {
        const fspath = this.wsFolderPath ?
            path.join(this.wsFolderPath, '.vscode', '.cortex-debug.peripherals.state.json') : undefined;
        return fspath;
    }

    public sessionTerminated() {
        this.saveState(this.stateFileName());
    }

    public togglePinPeripheral(node: PeripheralBaseNode) {
        node.pinned = !node.pinned;
        this.peripherials.sort(PeripheralNode.compare);
    }
}
export class PeripheralTreeProvider implements vscode.TreeDataProvider<PeripheralBaseNode> {
    // tslint:disable-next-line:variable-name
    public _onDidChangeTreeData: vscode.EventEmitter<PeripheralBaseNode | undefined> = new vscode.EventEmitter<PeripheralBaseNode | undefined>();
    public readonly onDidChangeTreeData: vscode.Event<PeripheralBaseNode | undefined> = this._onDidChangeTreeData.event;
    protected sessionPeripheralsMap = new Map <string, PeripheralTreeForSession>();
    protected oldState = new Map <string, vscode.TreeItemCollapsibleState>();

    constructor() {
    }

    public refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    public getTreeItem(element: PeripheralBaseNode): vscode.TreeItem | Promise<vscode.TreeItem> {
        return element?.getTreeItem();
    }

    public getChildren(element?: PeripheralBaseNode): ProviderResult<PeripheralBaseNode[]> {
        const values = Array.from(this.sessionPeripheralsMap.values());
        if (element) {
            return element.getChildren();
        } else if (values.length === 0) {
            return [new MessageNode('SVD: No active debug sessions or no SVD files specified')];
        } else if (values.length === 1) {
            return values[0].getChildren();     // Don't do root nodes at top-level if there is only one root
        } else {
            return values;
        }
    }

    public debugSessionStarted(session: vscode.DebugSession, svdfile: string, thresh: any): Thenable<any> {
        return new Promise<void>((resolve, reject) => {
            if (!svdfile) {
                resolve(undefined);
                return;
            }
            if (!this.sessionPeripheralsMap.get(session.id)) {
                let state =  this.oldState.get(session.name);
                if (state === undefined) {
                    state = this.sessionPeripheralsMap.size === 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
                }
                const regs = new PeripheralTreeForSession(session, state, () => {
                    this._onDidChangeTreeData.fire(undefined);
                });
                this.sessionPeripheralsMap.set(session.id, regs);
                regs.sessionStarted(svdfile, thresh).then(() => {
                    this._onDidChangeTreeData.fire(undefined);
                }, (e) => {
                    this._onDidChangeTreeData.fire(undefined);
                });
            } else {
                this._onDidChangeTreeData.fire(undefined);
            }
        });
    }

    public debugSessionTerminated(session: vscode.DebugSession): Thenable<any> {
        const regs = this.sessionPeripheralsMap.get(session.id);
        if (regs) {
            this.oldState.set(session.name, regs.myTreeItem.collapsibleState);
            this.sessionPeripheralsMap.delete(session.id);
            regs.sessionTerminated();
            this._onDidChangeTreeData.fire(undefined);
        }
        return Promise.resolve(true);
    }

    public debugStopped(session: vscode.DebugSession) {
        const regs = this.sessionPeripheralsMap.get(session.id);
        if (regs) {     // We are called even before the session has started, as part of reset
            regs.updateData();
        }
    }

    public debugContinued() {
    }

    public togglePinPeripheral(node: PeripheralBaseNode) {
        const session = CortexDebugExtension.getActiveCDSession();
        const regs = this.sessionPeripheralsMap.get(session.id);
        if (regs) {
            regs.togglePinPeripheral(node);
            this._onDidChangeTreeData.fire(undefined);
        }
    }
}
