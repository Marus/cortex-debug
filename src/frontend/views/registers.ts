import { TreeItem, TreeDataProvider, EventEmitter, Event, TreeItemCollapsibleState, debug, workspace, ProviderResult} from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { CortexDebugKeys, NodeSetting } from '../../common';
import { RegisterNode, RegisterValue } from './nodes/registernode';
import { MessageNode } from './nodes/messagenode';
import { BaseNode } from './nodes/basenode';

const DeprecationToolTip = 'Due to a VSCode limitation, this Panel cannot track current thread/frame so it can be inaccurate. ' +
    'You can find proper Registers in the VARIABLES panel where it is also possible to also SET registers. ' +
    'We may bring this Panel back when VSCode provides an API to track the "CALL STACK" Panel';
export class RegisterTreeForSession extends BaseNode {
    private registers: RegisterNode[] = [];
    private registerMap: { [index: number]: RegisterNode } = {};
    private loaded: boolean = false;
    public myTreeItem: TreeItem;

    constructor(
        public session: vscode.DebugSession,
        public state: vscode.TreeItemCollapsibleState,
        private fireCb: () => void) {
        super();
        this.myTreeItem = new TreeItem(this.session.name, this.state);
        this.myTreeItem.tooltip = DeprecationToolTip;
    }

    public getChildren(element?: BaseNode): BaseNode[] | Promise<BaseNode[]>{
        if (this.loaded && this.registers.length > 0) {
            return element ? element.getChildren() : this.registers;
        } else if (!this.loaded) {
            return [new MessageNode('Session not in active/available.')];
        } else {
            return this.registers;
        }
    }

    public getTreeItem(element?: BaseNode): TreeItem | Promise<TreeItem> {
        return element ? element.getTreeItem() : this.myTreeItem;
    }

    public getCopyValue(): string | undefined {
        return undefined;
    }

    public refresh(): void {
        if (!this.loaded) {
            this.session.customRequest('read-register-list').then((data) => {
                this.createRegisters(data);
                this._refreshRegisterValues();
            });
        } else {
            this._refreshRegisterValues();
        }
    }

    private _refreshRegisterValues() {
        const config = vscode.workspace.getConfiguration('cortex-debug');
        const val = config.get(CortexDebugKeys.REGISTER_DISPLAY_MODE);
        const args = { hex: !val };
        this.session.customRequest('read-registers', args).then((data) => {
            data.forEach((reg) => {
                const index = parseInt(reg.number, 10);
                const regNode = this.registerMap[index];
                if (regNode) { regNode.setValue(reg.value); }
            });
            this.fireCb();
        });
    }

    public getStateFilename() {
        const fspath = path.join(this.session.workspaceFolder.uri.fsPath,
            '.vscode', '.cortex-debug.registers.state.json');
        return fspath;
    }

    public createRegisters(regInfo: string[]) {
        this.registerMap = {};
        this.registers = [];
        
        regInfo.forEach((reg, idx) => {
            if (reg) {
                const rn = new RegisterNode(reg, idx);
                this.registers.push(rn);
                this.registerMap[idx] = rn;
            }
        });
        this.loaded = true;

        try {
            const fspath = this.getStateFilename();
            if (fs.existsSync(fspath)) {
                const data = fs.readFileSync(fspath, 'utf8');
                const settings = JSON.parse(data);
                
                settings.forEach((s: NodeSetting) => {
                    if (s.node.indexOf('.') === -1) {
                        const register = this.registers.find((r) => r.name === s.node);
                        if (register) {
                            if (s.expanded) { register.expanded = s.expanded; }
                        }
                    }
                    else {
                        const [regname, fieldname] = s.node.split('.');
                        const register = this.registers.find((r) => r.name === regname);
                        if (register) {
                            const field = register.getChildren().find((f) => f.name === fieldname);
                        }
                    }
                });
            }
        }
        catch (e) {
        }
        this.fireCb();
    }

    public sessionTerminated() {
        try {
            const fspath = this.getStateFilename();
            const state: NodeSetting[] = [];
            this.registers.forEach((r) => {
                state.push(...r._saveState());
            });
    
            fs.mkdirSync(path.dirname(fspath), { recursive: true });
            fs.writeFileSync(fspath, JSON.stringify(state), { encoding: 'utf8', flag: 'w' });
        } catch (e) {
            vscode.window.showWarningMessage(`Unable to save register preferences ${e}`);
        }
    }

    public updateRegisterValues(values: RegisterValue[]) {
        values.forEach((reg) => {
            const node = this.registerMap[reg.number];
            node.setValue(reg.value);
        });

        this.fireCb();
    }
}

export class RegisterTreeProvider implements TreeDataProvider<BaseNode> {
    // tslint:disable-next-line:variable-name
    public _onDidChangeTreeData: EventEmitter<BaseNode | undefined> = new EventEmitter<BaseNode | undefined>();
    public readonly onDidChangeTreeData: Event<BaseNode | undefined> = this._onDidChangeTreeData.event;

    protected sessionRegistersMap = new Map <string, RegisterTreeForSession>();
    protected oldState = new Map <string, vscode.TreeItemCollapsibleState>();
    constructor() {
    }

    public refresh(session: vscode.DebugSession): void {
        const regs = this.sessionRegistersMap.get(session.id);
        if (regs) {
            regs.refresh();
        }
    }

    public getTreeItem(element: BaseNode): TreeItem | Promise<TreeItem> {
        return element?.getTreeItem();
    }

    public getChildren(element?: BaseNode): ProviderResult<BaseNode[]> {
        const values = Array.from(this.sessionRegistersMap.values());
        if (element) {
            return element.getChildren();
        } else if (values.length === 0) {
            return [new MessageNode('DEPRECATION NOTICE: Hover for more info.', DeprecationToolTip)];
        } else if (values.length === 1) {
            return values[0].getChildren();     // Don't do root nodes at top-level if there is only one root
        } else {
            return values;
        }
    }

    public debugSessionTerminated(session: vscode.DebugSession) {
        const regs = this.sessionRegistersMap.get(session.id);
        if (regs) {
            this.oldState.set(session.name, regs.myTreeItem.collapsibleState);
            this.sessionRegistersMap.delete(session.id);
            regs.sessionTerminated();
            this._onDidChangeTreeData.fire(undefined);
        }
    }

    public debugSessionStarted(session: vscode.DebugSession) {
        if (!this.sessionRegistersMap.get(session.id)) {
            let state =  this.oldState.get(session.name);
            if (state === undefined) {
                state = this.sessionRegistersMap.size === 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
            }
            const regs = new RegisterTreeForSession(session, state, () => {
                this._onDidChangeTreeData.fire(undefined);
            });
            this.sessionRegistersMap.set(session.id, regs);
            this._onDidChangeTreeData.fire(undefined);
        }
    }

    public debugStopped(session: vscode.DebugSession) {
        const regs = this.sessionRegistersMap.get(session.id);
        if (regs) {
            regs.refresh();
        } else {
            // We get a stop event before we even get the session starting event.
            this.debugSessionStarted(session);
        }
    }

    public debugContinued() {
    }
}
