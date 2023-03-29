import { TreeItem, TreeDataProvider, EventEmitter, Event, TreeItemCollapsibleState, ProviderResult} from 'vscode';
import * as vscode from 'vscode';

import { getPathRelative, LiveWatchConfig } from '../../common';
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
    protected children: LiveVariableNode[] | undefined;
    protected prevValue: string = '';
    constructor(
        parent: LiveVariableNode | undefined,
        protected name: string,
        protected expr: string,       // Any string for top level ars but lower level ones are actual children's simple names
        protected value = '',         // Current value
        protected type = '',          // C/C++ Type if any
        protected variablesReference = 0) {   // Variable reference returned by the debugger (only valid per-session)
        super(parent);
    }

    public getExpr(): string {
        return this.expr;
    }
    
    public getChildren(): LiveVariableNode[] {
        if (!this.parent && (!this.children || !this.children.length)) {
            return [new LiveVariableNodeMsg(this)];
        }

        const ret = [...(this.children ?? [])];
        if (!this.parent && !this.session) {
            ret.push(new LiveVariableNodeMsg(this, false));
        }
        return ret;
    }

    public isRootChild(): boolean {
        const node = this.parent;
        return node && (node.getParent() === undefined);
    }

    public rename(nm: string) {
        if (this.isRootChild()) {
            this.name = this.expr = nm;
        }
    }

    public getName() {
        return this.name;
    }

    public findName(str: string): LiveVariableNode | undefined {
        for (const child of this.children || []) {
            if (child.name === str) {
                return child;
            }
        }
        return undefined;
    }

    public getTreeItem(): TreeItem | Promise<TreeItem> {
        const state = this.variablesReference || (this.children?.length > 0) ?
            (this.children?.length > 0 ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed) : TreeItemCollapsibleState.None;
        
        const parts = this.name.startsWith('\'') && this.isRootChild() ? this.name.split('\'::') : [this.name];
        const name = parts.pop();
        const label: vscode.TreeItemLabel = {
            label: name + ': ' + (this.value || 'not available')
        };
        if (this.prevValue && (this.prevValue !== this.value)) {
            label.highlights = [[name.length + 2, label.label.length]];
        }
        this.prevValue = this.value;
        
        const item = new TreeItem(label, state);
        item.contextValue = this.isRootChild() ? 'expression' : 'field';
        let file = parts.length ? parts[0].slice(1) : '';
        if (file) {
            const cwd = this.session?.configuration?.cwd;
            file = cwd ? getPathRelative(cwd, file) : file;
        }
        item.tooltip = (file ? 'File: ' + file + '\n' : '') + this.type;
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

    public removeChild(node: LiveVariableNode): boolean {
        if (!node || !node.isRootChild()) { return false; }
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

    public moveUpChild(node: LiveVariableNode): boolean {
        if (!node || !node.isRootChild()) { return false; }
        let ix = 0;
        for (const child of this.children || []) {
            if (child.name === node.name) {
                if (ix > 0) {
                    const prev = this.children[ix - 1];
                    this.children[ix] = prev;
                    this.children[ix - 1] = child;
                } else {
                    const first = this.children.shift();
                    this.children.push(first);
                }
                return true;
            }
            ix++;
        }
        return false;
    }

    public moveDownChild(node: LiveVariableNode): boolean {
        if (!node || !node.isRootChild()) { return false; }
        let ix = 0;
        const last = this.children ? this.children.length - 1 : -1;
        for (const child of this.children || []) {
            if (child.name === node.name) {
                if (ix !== last) {
                    const next = this.children[ix + 1];
                    this.children[ix] = next;
                    this.children[ix + 1] = child;
                } else {
                    const last = this.children.pop();
                    this.children.unshift(last);
                }
                return true;
            }
            ix++;
        }
        return false;
    }

    public reset(valuesToo = true) {
        this.session = undefined;
        if (valuesToo) {
            this.value = this.type = this.prevValue = '';
            this.variablesReference = 0;
        }
        for (const child of this.children || []) {
            child.reset(valuesToo);
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

class LiveVariableNodeMsg extends LiveVariableNode {
    constructor(parent: LiveVariableNode, private empty = true) {
        super(parent, 'dummy', 'dummy');
    }

    public getTreeItem(): TreeItem | Promise<TreeItem> {
        const state = TreeItemCollapsibleState.None;
        const tmp = 'Hint: Use & Enable "liveWatch" in your launch.json to enable this panel';
        const label: vscode.TreeItemLabel = {
            label: tmp + (this.empty ? ', and use the \'+\' button above to add new expressions' : '')
        };
        const item = new TreeItem(label, state);
        item.contextValue = this.isRootChild() ? 'expression' : 'field';
        item.tooltip = '~' + label.label + '~';
        return item;
    }

    public getChildren(): LiveVariableNode[] {
        return [];
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
        this.setRefreshRate();
        this.restoreState();
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(this.settingsChanged.bind(this))
        );
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

    private currentRefreshRate = LiveWatchTreeProvider.defaultRefreshRate;
    private settingsChanged(e: vscode.ConfigurationChangeEvent) {
        if (e.  affectsConfiguration('cortex-debug.liveWatchRefreshRate')) {
            this.setRefreshRate();
        }
    }

    private static defaultRefreshRate = 300;
    private static minRefreshRate = 200;        // Seems to be the magic number
    private static maxRefreshRate = 5000;
    private setRefreshRate() {
        const config = vscode.workspace.getConfiguration('cortex-debug', null);
        let rate = config.get('liveWatchRefreshRate', LiveWatchTreeProvider.defaultRefreshRate);
        rate = Math.max(rate, LiveWatchTreeProvider.minRefreshRate);
        rate = Math.min(rate, LiveWatchTreeProvider.maxRefreshRate);
        this.currentRefreshRate = rate;
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
        if (session && this.isSameSession(session)) {
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
        } else {
            this.fire();
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
            setTimeout(() => {
                // We hold the current values as they are until we start another debug session and
                // another fire() is called
                this.variables.reset(true);
            }, 100);
        }
    }

    public debugSessionStarted(session: vscode.DebugSession) {
        const liveWatch = session.configuration.liveWatch as LiveWatchConfig;
        if (!liveWatch?.enabled) {
            if (!LiveWatchTreeProvider.session) {
                // Force a child node to be created to provide a Hint
                this.fire();
            }
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
        const samplesPerSecond = Math.max(1, Math.min(20, liveWatch.samplesPerSecond ?? 4));
        this.timeoutMs = 1000 / samplesPerSecond;
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

    public editNode(node: LiveVariableNode) {
        if (!node.isRootChild()) {
            return;     // Should never happen
        }
        const opts: vscode.InputBoxOptions = {
            placeHolder: 'Enter a valid C/gdb expression. Must be a global variable expression',
            ignoreFocusOut: true,
            value: node.getName(),
            prompt: 'Enter Live Watch Expression'
        };
        vscode.window.showInputBox(opts).then((result) => {
            result = result ? result.trim() : result;
            if (result && (result !== node.getName())) {
                if (this.variables.findName(result)) {
                    vscode.window.showInformationMessage(`Live Watch: Expression ${result} is already being watched`);
                } else {
                    node.rename(result);
                    this.saveState();
                    this.refresh(LiveWatchTreeProvider.session);
                }
            }
        });
    }

    public moveUpNode(node: LiveVariableNode) {
        const parent = node?.getParent() as LiveVariableNode;
        if (parent && parent.moveUpChild(node)) {
            this.fire();
        }
    }

    public moveDownNode(node: LiveVariableNode) {
        const parent = node?.getParent() as LiveVariableNode;
        if (parent && parent.moveDownChild(node)) {
            this.fire();
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
        if (this.timeoutMs >= this.currentRefreshRate) {
            this._onDidChangeTreeData.fire(undefined);
            return;
        }
        if (!this.inFire) {
            this.inFire = true;
            this._onDidChangeTreeData.fire(undefined);
            setTimeout(() => {
                this.inFire = false;
                if (this.pendingFires) {
                    this.pendingFires = 0;
                    this.fire();
                }
            }, this.currentRefreshRate);    // TODO: Timeout needs to be a user setting
        } else {
            this.pendingFires++;
        }
    }
}

/*
    async machineInfo() {
        if (this.sessionInfo === undefined)
            return undefined;
        const session = this.sessionInfo.session;
        const frameId = this.sessionInfo.frameId;
        if (this.sessionInfo.language === Language.Cpp) {
            //const expr1 = await this._evaluate(session, '(unsigned int)((unsigned char)-1)', frameId);
            const expr2 = await this._evaluate(session, 'sizeof(void*)', frameId);
            if (expr2 === undefined || expr2.type === undefined)
                return undefined;
            let pointerSize: number = 0;
            if (expr2.result === '4')
                pointerSize = 4;
            else if (expr2.result === '8')
                pointerSize = 8;
            else
                return undefined;
            const expr3 = await this._evaluate(session, 'sizeof(unsigned long)', frameId);
            if (expr3 === undefined || expr3.type === undefined)
                return undefined;
            let endianness: Endianness | undefined = undefined;
            let expression = '';
            let expectedLittle = '';
            let expectedBig = '';
            if (expr3.result === '4') {
                expression = '*(unsigned long*)"abc"';
                expectedLittle = '6513249';
                expectedBig = '1633837824';
            } else if (expr3.result === '8') { 
                expression = '*(unsigned long*)"abcdefg"';
                expectedLittle = '29104508263162465';
                expectedBig = '7017280452245743360';
            } else
                return undefined;
            const expr4 = await this._evaluate(session, expression, frameId);
            if (expr4 === undefined || expr4.type === undefined)
                return undefined;
            if (expr4.result === expectedLittle)
                endianness = Endianness.Little;
            else if (expr4.result === expectedBig)
                endianness = Endianness.Big;
            else
                return undefined;
            return new MachineInfo(pointerSize, endianness);
        }
        return undefined;
    }
    */
