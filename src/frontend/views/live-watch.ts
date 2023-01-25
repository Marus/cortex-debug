import { TreeItem, TreeDataProvider, EventEmitter, Event, TreeItemCollapsibleState, debug, workspace, ProviderResult} from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { CortexDebugKeys, LiveWatchConfig, NodeSetting, ResettableInterval } from '../../common';
import { MessageNode } from './nodes/messagenode';
import { BaseNode } from './nodes/basenode';
import { DebugProtocol } from '@vscode/debugprotocol';

export class VariableNode extends BaseNode {
    protected session: vscode.DebugSession | undefined;        // This is transient
    private children: VariableNode[] | undefined;
    private prevValue: string = '';
    constructor(
        parent: VariableNode | undefined,
        private name: string,
        private expr: string,       // Any string for top level ars but lower level ones are actual children's simple names
        private value = '',         // Current value
        private type = '',          // C/C++ Type if any
        private variablesReference = 0) {   // Variable reference returned by the debugger (only valid per-session)
        super(parent);
    }

    public getExpr(): string {
        return this.expr;
    }
    
    public getChildren(): VariableNode[] {
        return this.children ?? [];
    }

    public isRootChild(): boolean {
        const node = this.parent;
        return node && (node.getParent() === undefined);
    }

    public getTreeItem(): TreeItem | Promise<TreeItem> {
        const state = this.children && this.children.length > 0 ?
            (this.expanded ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed)
            : TreeItemCollapsibleState.None;
        
        const label: vscode.TreeItemLabel = {
            label: this.name + ': ' + (this.value || 'not available')
        };
        if (this.prevValue && (this.prevValue !== this.value)) {
            label.highlights = [[this.name.length + 2, label.label.length]];
        }
        this.prevValue = this.value;
        
        const item = new TreeItem(label, state);
        item.contextValue = this.isRootChild() ? 'expression' : 'field';
        item.tooltip = this.type + ' ' + this.expr || this.name;
        return item;
    }

    public getCopyValue(): string {
        throw new Error('Method not implemented.');
    }

    public addChild(name: string, expr: string = '', value = '', type = '', reference = 0): VariableNode {
        if (!this.children) {
            this.children = [];
        }
        const child = new VariableNode(this, name, expr || name, value, type, reference);
        this.children.push(child);
        return child;
    }

    public removeChild(obj: any) {
        const node = obj as VariableNode;
        let ix = 0;
        for (const child of this.children || []) {
            if (child.name === node.name) {
                this.children.splice(ix, 1);
                return true;
            }
            ix++;
        }
        return false;
    }

    public reset() {
        this.session = undefined;
        this.value = this.type = this.prevValue = '';
        this.variablesReference = 0;
        for (const child of this.children || []) {
            child.reset();
        }
    }

    private namedVariables: number = 0;
    private indexedVariables: number = 0;
    private refreshChildren(resolve: () => void) {
        if (this.session !== LiveWatchTreeProvider.session) {
            resolve();
            return;
        }
        if (this.expanded && (this.variablesReference > 0)) {
            const varg: DebugProtocol.VariablesArguments = {
                variablesReference: this.variablesReference
                // filter: this.namedVariables > 0 ? 'named' : 'indexed'
            };
            this.session.customRequest('liveVariables', varg).then((result) => {
                if (result) {
                    if (!result.variables || !result.variables.length) {
                        this.children = undefined;
                    } else {
                        const newChildren = [];
                        for (const variable of result.variables || []) {
                            const ch = new VariableNode(
                                this,
                                variable.name,
                                variable.evaluateName || variable.name,
                                variable.value || '',
                                variable.type || '',
                                variable.variablesReference ?? 0);
                            newChildren.push();
                        }
                    }
                }
                resolve();
            }, (e) => {
                resolve();
            });
        } else {
            resolve();
        }
    }

    public refresh(session: vscode.DebugSession): Promise<void> {
        return new Promise<void>((resolve) => {
            this.session = session;
            if (session !== LiveWatchTreeProvider.session) {
                resolve();
                return;
            }
            if (this.expr) {
                const arg: DebugProtocol.EvaluateArguments = {
                    expression: this.expr,
                    context: 'hover'
                };
                session.customRequest('liveEvaluate', arg).then((result) => {
                    if (result && result.result !== undefined) {
                        const oldType = this.type;
                        this.value = result.result;
                        this.type = result.type;
                        this.variablesReference = result.variablesReference ?? 0;
                        this.namedVariables = result.namedVariables ?? 0;
                        this.indexedVariables = result.indexedVariables ?? 0;
                        if (oldType !== this.type) {
                            this.children = this.variablesReference ? [] : undefined;
                        }
                        this.refreshChildren(resolve);
                    } else {
                        this.value = `<Failed to evaluate ${this.expr}>`;
                        this.children = undefined;
                        resolve();
                    }
                }, () => {
                    resolve();
                });
            } else if (this.children && !this.parent) {
                // This is the root node
                const promises = [];
                for (const child of this.children) {
                    promises.push(child.refresh(session));
                }
                Promise.allSettled(promises).finally(() => {
                    resolve();
                });
            } else {
                this.refreshChildren(resolve);
            }
        });
    }

    public addNewExpr(expr: string): boolean {
        if (this.parent) {
            // You can't add new expressions unless at the root
            return false;
        }
        for (const child of this.children || []) {
            if (expr === child.expr) {
                return false;
            }
        }
        this.addChild(expr, expr);
        return true;
    }
}

const VERSION_ID = 'livewatch.version';
const WATCH_LIST_ID = 'livewatch.watchlist';

export class LiveWatchTreeProvider implements TreeDataProvider<VariableNode> {
    // tslint:disable-next-line:variable-name
    public _onDidChangeTreeData: EventEmitter<VariableNode | undefined> = new EventEmitter<VariableNode | undefined>();
    public readonly onDidChangeTreeData: Event<VariableNode | undefined> = this._onDidChangeTreeData.event;

    private static stateVersion = 1;
    private variables: VariableNode;
    public static session: vscode.DebugSession | undefined;
    public state: vscode.TreeItemCollapsibleState;
    private timeout: NodeJS.Timeout | undefined;
    private timeoutMs: number = 250;

    protected oldState = new Map <string, vscode.TreeItemCollapsibleState>();
    constructor(private context: vscode.ExtensionContext) {
        this.variables = new VariableNode(undefined, '', '');
        try {
            const state = context.workspaceState;
            const ver = state.get(VERSION_ID) ?? LiveWatchTreeProvider.stateVersion;
            if (ver === LiveWatchTreeProvider.stateVersion) {
                const obj = state.get(WATCH_LIST_ID);
                const saved = obj as string[];
                for (const expr of saved || []) {
                    this.variables.addChild(expr);
                }
            }
        } catch {}
    }

    private saveState() {
        const state = this.context.workspaceState;
        const children = this.variables.getChildren();
        const names = children.map((child) => child.getExpr());
        state.update(VERSION_ID, LiveWatchTreeProvider.stateVersion);
        state.update(WATCH_LIST_ID, names);
        // TODO: Save expanded state
    }

    private isSameSession(session: vscode.DebugSession): boolean {
        if (session && LiveWatchTreeProvider.session && (session.id === LiveWatchTreeProvider.session.id)) {
            return true;
        }
        return false;
    }

    public refresh(session: vscode.DebugSession, restarTimer = false): void {
        if (this.isSameSession(session)) {
            const start = Date.now();
            session.customRequest('liveCacheRefresh', {
                deleteAll: false       // Delete gdb-vars?
            }).then(() => {
                this.variables.refresh(session).finally(() => {
                    const elapsed = Date.now() - start;
                    // console.log(`Refreshed in ${elapsed} ms`);
                    this.fire();
                    if (restarTimer && LiveWatchTreeProvider.session) {
                        this.startTimer(((elapsed < 0) || (elapsed > this.timeoutMs)) ? 0 : elapsed);
                    }
                });
            });
        }
    }

    public getTreeItem(element: VariableNode): TreeItem | Promise<TreeItem> {
        return element?.getTreeItem();
    }

    public getChildren(element?: VariableNode): ProviderResult<VariableNode[]> {
        return element ? element.getChildren() : this.variables.getChildren();
    }

    private startTimer(subtract: number = 0) {
        // console.error('Starting Timer');
        this.killTimer();
        this.timeout = setTimeout(() => {
            this.timeout = undefined;
            if (LiveWatchTreeProvider.session) {
                this.refresh(LiveWatchTreeProvider.session, true);
            }
        }, this.timeoutMs - subtract);
    }

    private killTimer() {
        if (this.timeout) {
            // console.error('Killing Timer');
            clearTimeout(this.timeout);
            this.timeout = undefined;
        }
    }

    public debugSessionTerminated(session: vscode.DebugSession) {
        if (this.isSameSession(session)) {
            this.killTimer();
            LiveWatchTreeProvider.session = undefined;
            this.fire();
        }
    }

    public debugSessionStarted(session: vscode.DebugSession) {
        const liveWatch = session.configuration.liveWatch as LiveWatchConfig;
        if (!liveWatch?.enabled) {
            return;
        }
        if (LiveWatchTreeProvider.session) {
            // For now, we can't handle more than one session (all variables needs to be relevant to the core being debugged)
            // Technically, it is not an issue but is problematic on how to specify in the UI, which watch expression belongs
            // to which session. Same as breakpoints or Watch variables.
            vscode.window.showErrorMessage(
                'Error: You can have live-watch enabled to only one debug session at a time. Live Watch is already enabled for ' +
                LiveWatchTreeProvider.session.name);
            return;
        }
        LiveWatchTreeProvider.session = session;
        this.variables.reset();
        const updatesPerSecond = Math.max(1, Math.min(10, liveWatch.updatesPerSecond ?? 4));
        this.timeoutMs = 1000 / updatesPerSecond;
        this.startTimer();
    }

    public debugStopped(session: vscode.DebugSession) {
        if (this.isSameSession(session)) {
            this.killTimer();
            // There are some pauses that are very brief, so lets not refresh when stopped. Lets
            // wait and see if the a refresh is needed or else it will already be performed if the
            // program has already continued
            setTimeout(() => {
                if (!this.timeout) {
                    this.refresh(LiveWatchTreeProvider.session);
                }
            }, 250);
        }
    }

    public debugContinued(session: vscode.DebugSession) {
        if (this.isSameSession(session)) {
            this.startTimer();
        }
    }

    public addWatchExpr(expr: string, session: vscode.DebugSession) {
        expr = expr.trim();
        if (expr && this.variables.addNewExpr(expr)) {
            this.saveState();
            this.refresh(LiveWatchTreeProvider.session);
        }
    }

    public removeWatchExpr(node: any) {
        if (this.variables.removeChild(node)) {
            this.fire();
        }
    }

    public fire() {
        this._onDidChangeTreeData.fire(undefined);
    }
}
