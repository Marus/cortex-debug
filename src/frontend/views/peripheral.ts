import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { ProviderResult } from 'vscode';
import { NodeSetting } from '../../common';
import reporting from '../../reporting';
import { PeripheralBaseNode } from './nodes/basenode';
import { PeripheralNode } from './nodes/peripheralnode';
import { SVDParser } from '../svd';
import { MessageNode } from './nodes/messagenode';

export class PeripheralTreeProvider implements vscode.TreeDataProvider<PeripheralBaseNode> {
    // tslint:disable-next-line:variable-name
    public _onDidChangeTreeData: vscode.EventEmitter<PeripheralBaseNode | undefined> = new vscode.EventEmitter<PeripheralBaseNode | undefined>();
    public readonly onDidChangeTreeData: vscode.Event<PeripheralBaseNode | undefined> = this._onDidChangeTreeData.event;
    public session: vscode.DebugSession = null;
    
    private peripherials: PeripheralNode[] = [];
    private loaded: boolean = false;
    private svdFileName: string | null;
    private gapThreshold: number = 16;
    
    constructor() {

    }

    private saveState(fspath: string): void {
        const state: NodeSetting[] = [];
        this.peripherials.forEach((p) => {
            state.push(... p.saveState());
        });
        
        try {
            fs.mkdirSync(path.dirname(fspath), { recursive: true });
            fs.writeFileSync(fspath, JSON.stringify(state), { encoding: 'utf8', flag: 'w' });
        }
        catch (e) {
            vscode.window.showWarningMessage(`Unable to save periperal preferences ${e}`);
        }
    }
    
    private loadSVD(SVDFile: string): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!path.isAbsolute(SVDFile)) {
                const fullpath = path.normalize(path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, SVDFile));
                SVDFile = fullpath;
            }

            this.svdFileName = SVDFile;
            try {
                return SVDParser.parseSVD(SVDFile, this.gapThreshold).then((peripherals) => {
                    this.peripherials = peripherals;
                    this.loaded = true;
                    resolve(true);
                }).catch ((e) => {
                    reject(e);
                });
            }
            catch (e) {
                reject(e);
            }
        });
    }

    private findNodeByPath(path: string): PeripheralBaseNode {
        const pathParts = path.split('.');
        const peripheral = this.peripherials.find((p) => p.name === pathParts[0]);
        if (!peripheral) { return null; }
        
        return peripheral.findByPath(pathParts.slice(1));
    }

    public refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    public getTreeItem(element: PeripheralBaseNode): vscode.TreeItem | Promise<vscode.TreeItem> {
        return element.getTreeItem();
    }

    public getChildren(element?: PeripheralBaseNode): ProviderResult<PeripheralBaseNode[]> {
        if (this.loaded && this.peripherials.length > 0) {
            if (element) {
                return element.getChildren();
            }
            else {
                return this.peripherials;
            }
        }
        else if (!this.loaded) {
            if (!vscode.debug.activeDebugSession) {
                return [new MessageNode('SVD: Debug session not active', null)];
            } else if (!this.svdFileName) {
                return [new MessageNode('SVD: No SVD file specified', null)];
            }
            return [new MessageNode(`Unable to load SVD file: ${this.svdFileName}`, null)];
        }
        else {
            return [];
        }
    }

    public debugSessionStarted(session: vscode.DebugSession, svdfile: string, thresh: any): Thenable<any> {
        return new Promise<void>((resolve, reject) => {
            this.peripherials = [];
            this._onDidChangeTreeData.fire(undefined);

            // Set the threshold between 0 and 32, with a default of 16 and a mukltiple of 8
            this.gapThreshold = ((((typeof thresh) === 'number') ? Math.max(0, Math.min(thresh, 32)) : 16) + 7) & ~0x7;
            
            if (svdfile && !this.session && !this.loaded) {
                setTimeout(() => {
                    this.loadSVD(svdfile).then(
                        () => {
                            this.session = session;
                            vscode.workspace.findFiles('.vscode/.cortex-debug.peripherals.state.json', null, 1).then((value) => {
                                if (value.length > 0) {
                                    const fspath = value[0].fsPath;
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

                                    this.peripherials.sort(PeripheralNode.compare);
                                    this._onDidChangeTreeData.fire(undefined);
                                }
                            }, (error) => {

                            });
                            this._onDidChangeTreeData.fire(undefined);
                            resolve(undefined);
                            reporting.sendEvent('Peripheral View', 'Used', svdfile);
                        },
                        (e) => {
                            this.peripherials = [];
                            this.loaded = false;
                            this._onDidChangeTreeData.fire(undefined);
                            const msg = `Unable to parse SVD file: ${e.toString()}`;
                            vscode.window.showErrorMessage(msg);
                            if (vscode.debug.activeDebugConsole) {
                                vscode.debug.activeDebugConsole.appendLine(msg);
                            }
                            resolve(undefined);
                            reporting.sendEvent('Peripheral View', 'Error', e.toString());
                        }
                    );
                }, 150);
            }
            else {
                resolve(undefined);
                reporting.sendEvent('Peripheral View', 'No SVD');
            }
        });
    }

    public debugSessionTerminated(session: vscode.DebugSession): Thenable<any> {
        if (this.session.id === session.id) {
            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                // Path should really be in the workspace storage but this is where we will live for now
                const fspath = path.join(
                    session.workspaceFolder.uri.fsPath,
                    /*vscode.workspace.workspaceFolders[0].uri.fsPath,*/
                    '.vscode', '.cortex-debug.peripherals.state.json');
                this.saveState(fspath);
            }
            this.session = null; 
            this.peripherials = [];
            this.loaded = false;
            this._onDidChangeTreeData.fire(undefined);
        }
        return Promise.resolve(true);
    }

    public debugStopped(session: vscode.DebugSession) {
        if (this.loaded && (session.id === this.session.id)) {
            const promises = this.peripherials.map((p) => p.updateData());
            Promise.all(promises).then((_) => { this._onDidChangeTreeData.fire(undefined); }, (_) => { this._onDidChangeTreeData.fire(undefined); });
        }
    }

    public debugContinued() {
        
    }

    public togglePinPeripheral(node: PeripheralBaseNode) {
        node.pinned = !node.pinned;
        this.peripherials.sort(PeripheralNode.compare);
    }
}
