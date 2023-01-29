import { TreeItem, TreeDataProvider, EventEmitter, Event, TreeItemCollapsibleState, ProviderResult} from 'vscode';
import * as vscode from 'vscode';

import { LiveWatchConfig } from '../../common';
import { BaseNode } from './nodes/basenode';
import { DebugProtocol } from '@vscode/debugprotocol';

interface SaveVarState {
    expanded: boolean;
    value: string;
    children: LiveVariableNode[] | undefined;
}

interface SaveVarStateMap {
     [name: string]: SaveVarState;
}
export class LiveVariableNode extends BaseNode {
    protected session: vscode.DebugSession | undefined;        // This is transient
    private children: LiveVariableNode[] | undefined;
    private prevValue: string = '';
    constructor(
        parent: LiveVariableNode | undefined,
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
    
    public getChildren(): LiveVariableNode[] {
        return this.children ?? [];
    }

    public isRootChild(): boolean {
        const node = this.parent;
        return node && (node.getParent() === undefined);
    }

    public getTreeItem(): TreeItem | Promise<TreeItem> {
        const state = this.variablesReference || (this.children?.length > 0) ?
            (this.children?.length > 0 ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed) : TreeItemCollapsibleState.None;
        
        const label: vscode.TreeItemLabel = {
            label: this.name + ': ' + (this.value || 'not available')
        };
        if (this.prevValue && (this.prevValue !== this.value)) {
            label.highlights = [[this.name.length + 2, label.label.length]];
        }
        this.prevValue = this.value;
        
        const item = new TreeItem(label, state);
        item.contextValue = this.isRootChild() ? 'expression' : 'field';
        item.tooltip = this.type;
        return item;
    }

    public getCopyValue(): string {
        throw new Error('Method not implemented.');
    }

    public addChild(name: string, expr: string = '', value = '', type = '', reference = 0): LiveVariableNode {
        if (!this.children) {
            this.children = [];
        }
        const child = new LiveVariableNode(this, name, expr || name, value, type, reference);
        this.children.push(child);
        return child;
    }

    public removeChild(obj: any) {
        const node = obj as LiveVariableNode;
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
        if (!LiveWatchTreeProvider.session || (this.session !== LiveWatchTreeProvider.session)) {
            resolve();
        } else if (this.expanded && (this.variablesReference > 0)) {
            // TODO: Implement limits on number of children in adapter and then here
            // const start = this.children?.length ?? 0;
            const varg: DebugProtocol.VariablesArguments = {
                variablesReference: this.variablesReference
                // start: start,
                // count: 32
                // filter: this.namedVariables > 0 ? 'named' : 'indexed'
            };
            const oldStateMap: SaveVarStateMap = {};
            for (const child of this.children ?? []) {
                oldStateMap[child.name] = {
                    expanded: child.expanded,
                    value: child.value,
                    children: child.children
                };
            }
            this.session.customRequest('liveVariables', varg).then((result) => {
                if (!result?.variables?.length) {
                    this.children = undefined;
                } else {
                    this.children = [];
                    for (const variable of result.variables ?? []) {
                        const ch = new LiveVariableNode(
                            this,
                            variable.name,
                            variable.evaluateName || variable.name,
                            variable.value || '',
                            variable.type || '',        // This will become tooltip
                            variable.variablesReference ?? 0);
                        const oldState = oldStateMap[ch.name];
                        if (oldState) {
                            ch.expanded = oldState.expanded && (ch.variablesReference > 0);
                            ch.prevValue = oldState.value;
                            ch.children = oldState.children;     // These will get refreshed later
                        }
                        ch.session = this.session;
                        this.children.push(ch);
                    }
                }
                const promises = [];
                for (const child of this.children ?? []) {
                    if (child.expanded) {
                        const p = new Promise<void>((resolve) => {
                            child.refreshChildren(resolve);
                        });
                    }
                }
                Promise.allSettled(promises).finally(() => {
                    resolve();
                });
            }, (e) => {
                resolve();
            });
        } else {
            resolve();
        }
    }

    public expandChildren(): Promise<void> {
        return new Promise<void>((resolve) => {
            this.expanded = true;
            // If we still have a current session, try to get the children or
            // wait for the next timer
            this.refreshChildren(resolve);
        });
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

    private pvtSerialize(state: NodeState | undefined): NodeState {
        const item: NodeState = {
            name: this.name,
            expr: this.expr,
            expanded: this.expanded || !this.parent,
            children: []
        };
        if (!state) {
            state = item;
        } else {
            state.children.push(item);
        }
        for (const child of this.children ?? []) {
            child.pvtSerialize(item);
        }
        return item;
    }

    public serialize(): NodeState {
        return this.pvtSerialize(undefined);
    }

    public deSerialize(state: NodeState): void {
        for (const child of state.children) {
            if (!this.children) {
                this.children = [];
            }
            const item = new LiveVariableNode(this, child.name, child.expr);
            item.expanded = child.expanded;
            this.children.push(item);
            item.deSerialize(child);
        }
    }
}

interface NodeState {
    name: string;
    expr: string;
    expanded: boolean;
    children: NodeState[];
}

const VERSION_ID = 'livewatch.version';
const WATCH_LIST_STATE = 'livewatch.watchTree';

export class LiveWatchTreeProvider implements TreeDataProvider<LiveVariableNode> {
    // tslint:disable-next-line:variable-name
    public _onDidChangeTreeData: EventEmitter<LiveVariableNode | undefined> = new EventEmitter<LiveVariableNode | undefined>();
    public readonly onDidChangeTreeData: Event<LiveVariableNode | undefined> = this._onDidChangeTreeData.event;

    private static stateVersion = 2;
    private variables: LiveVariableNode;
    public static session: vscode.DebugSession | undefined;
    public state: vscode.TreeItemCollapsibleState;
    private timeout: NodeJS.Timeout | undefined;
    private timeoutMs: number = 250;
    private isStopped = true;

    protected oldState = new Map <string, vscode.TreeItemCollapsibleState>();
    constructor(private context: vscode.ExtensionContext) {
        this.variables = new LiveVariableNode(undefined, '', '');
        this.restoreState();
    }

    private restoreState() {
        try {
            const state = this.context.workspaceState;
            const ver = state.get(VERSION_ID) ?? LiveWatchTreeProvider.stateVersion;
            if (ver === LiveWatchTreeProvider.stateVersion) {
                const data = state.get(WATCH_LIST_STATE);
                const saved = data as NodeState;
                if (saved) {
                    this.variables.deSerialize(saved);
                }
            }
        } catch { }
    }

    public saveState() {
        const state = this.context.workspaceState;
        const data = this.variables.serialize();
        state.update(VERSION_ID, LiveWatchTreeProvider.stateVersion);
        state.update(WATCH_LIST_STATE, data);
    }

    private isSameSession(session: vscode.DebugSession): boolean {
        if (session && LiveWatchTreeProvider.session && (session.id === LiveWatchTreeProvider.session.id)) {
            return true;
        }
        return false;
    }

    public refresh(session: vscode.DebugSession, restarTimer = false): void {
        if (this.isSameSession(session)) {
            const restart = (elapsed: number) => {
                if (!this.isStopped && restarTimer && LiveWatchTreeProvider.session) {
                    this.startTimer(((elapsed < 0) || (elapsed > this.timeoutMs)) ? 0 : elapsed);
                }
            };
            if (this.variables.getChildren().length === 0) {
                restart(0);
            } else {
                const start = Date.now();
                // The following will update all the variables in the backend cache in bulk
                session.customRequest('liveCacheRefresh', {
                    deleteAll: false       // Delete gdb-vars?
                }).then(() => {
                    this.variables.refresh(session).finally(() => {
                        const elapsed = Date.now() - start;
                        // console.log(`Refreshed in ${elapsed} ms`);
                        this.fire();
                        if (elapsed > this.timeoutMs) {
                            console.error('??????? over flow ????');
                        }
                        restart(elapsed);
                    });
                });
            }
        }
    }

    public getTreeItem(element: LiveVariableNode): TreeItem | Promise<TreeItem> {
        return element?.getTreeItem();
    }

    public getChildren(element?: LiveVariableNode): ProviderResult<LiveVariableNode[]> {
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
            this.isStopped = true;
            this.killTimer();
            LiveWatchTreeProvider.session = undefined;
            this.fire();
            this.saveState();
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
        this.isStopped = true;
        this.variables.reset();
        const updatesPerSecond = Math.max(1, Math.min(10, liveWatch.updatesPerSecond ?? 2));
        this.timeoutMs = 1000 / updatesPerSecond;
        this.startTimer();
    }

    public debugStopped(session: vscode.DebugSession) {
        if (this.isSameSession(session)) {
            this.isStopped = true;
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
            this.isStopped = false;
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

    public removeWatchExpr(node: LiveVariableNode) {
        try {
            if (this.variables.removeChild(node)) {
                this.saveState();
                this.fire();
            }
        }
        catch (e) {
            // Sometimes we get a garbage node if this is called while we are (aggressively) polling
            console.error('Failed to remove node. Invalid node?', node);
        }
    }

    public expandChildren(element: LiveVariableNode) {
        if (element) {
            element.expandChildren().then(() => {
                this.fire();
            });
        }
    }

    private pendingFires = 0;
    private inFire = false;
    public fire() {
        if (!this.inFire) {
            this.inFire = true;
            this._onDidChangeTreeData.fire(undefined);
            setTimeout(() => {
                this.inFire = false;
                if (this.pendingFires) {
                    this.pendingFires = 0;
                    this.fire();
                }
            }, 350);    // TODO: Timeout needs to be a user setting
        } else {
            this.pendingFires++;
        }
    }
}
