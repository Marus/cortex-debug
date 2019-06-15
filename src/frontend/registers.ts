import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { hexFormat, binaryFormat, createMask, extractBits } from './utils';
import { NumberFormat, NodeSetting } from '../common';

interface RegisterValue {
    number: number;
    value: string;
}

export enum RecordType {
    Register,
    Field
}

export class TreeNode extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public contextValue: string, public node: BaseNode
    ) {
        super(label, collapsibleState);

        this.command = {
            command: 'cortex-debug.registers.selectedNode',
            arguments: [node],
            title: 'Selected Node'
        };
    }
}

export class BaseNode {
    public expanded: boolean;
    protected format: NumberFormat = NumberFormat.Auto;

    constructor(public recordType: RecordType) {
        this.expanded = false;
    }

    public getChildren(): BaseNode[] { return []; }
    public getTreeNode(): TreeNode { return null; }
    public getCopyValue(): string { return null; }
    public setFormat(format: NumberFormat) {
        this.format = format;
    }
}

export class RegisterNode extends BaseNode {
    private fields: FieldNode[];
    private currentValue: number;
    private currentNaturalValue: string;

    constructor(public name: string, public index: number) {
        super(RecordType.Register);
        this.name = this.name;

        if (name.toUpperCase() === 'XPSR' || name.toUpperCase() === 'CPSR') {
            this.fields = [
                new FieldNode('Negative Flag (N)', 31, 1, this),
                new FieldNode('Zero Flag (Z)', 30, 1, this),
                new FieldNode('Carry or borrow flag (C)', 29, 1, this),
                new FieldNode('Overflow Flag (V)', 28, 1, this),
                new FieldNode('Saturation Flag (Q)', 27, 1, this),
                new FieldNode('GE', 16, 4, this),
                new FieldNode('Interrupt Number', 0, 8, this),
                new FieldNode('ICI/IT', 25, 2, this),
                new FieldNode('ICI/IT', 10, 6, this),
                new FieldNode('Thumb State (T)', 24, 1, this)
            ];
        }
        else if (name.toUpperCase() === 'CONTROL') {
            this.fields = [
                new FieldNode('FPCA', 2, 1, this),
                new FieldNode('SPSEL', 1, 1, this),
                new FieldNode('nPRIV', 0, 1, this)
            ];
        }

        this.currentValue = 0x00;
        this.currentNaturalValue = '0x00000000';
    }

    public extractBits(offset: number, width: number): number {
        return extractBits(this.currentValue, offset, width);
    }

    public getTreeNode(): TreeNode {
        const label = `${this.name} = ${this.currentNaturalValue}`;
        if (this.fields && this.fields.length > 0) {
            return new TreeNode(label, this.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed, 'register', this);
        }
        else {
            return new TreeNode(label, vscode.TreeItemCollapsibleState.None, 'register', this);
        }
    }

    public getChildren(): FieldNode[] {
        return this.fields;
    }

    public setValue(newValue: string) {
        this.currentNaturalValue = newValue;
        if (this.name.toUpperCase() === 'CONTROL' || this.name.toUpperCase() === 'XPSR' || this.name.toUpperCase() === 'CPSR') {
            this.currentValue = parseInt(this.currentNaturalValue, 10);
            let cv = this.currentValue.toString(16);
            while (cv.length < 8) { cv = '0' + cv; }
            this.currentNaturalValue = '0x' + cv;
        }
        
    }

    public getCopyValue(): string {
        return this.currentNaturalValue;
    }

    public getFormat(): NumberFormat {
        return this.format;
    }

    public _saveState(): NodeSetting[] {
        const settings: NodeSetting[] = [];
        if (this.expanded || this.format !== NumberFormat.Auto) {
            settings.push({ node: this.name, format: this.format, expanded: this.expanded });
        }

        if (this.fields) {
            settings.push(...this.fields.map((c) => c._saveState()).filter((c) => c !== null));
        }

        return settings;
    }
}

export class FieldNode extends BaseNode {
    constructor(public name: string, private offset: number, private size: number, private register: RegisterNode) {
        super(RecordType.Field);
    }

    public getTreeNode(): TreeNode {
        const value = this.register.extractBits(this.offset, this.size);
        let label = `${this.name} = `;
        switch (this.getFormat()) {
            case NumberFormat.Decimal:
                label += value.toString();
                break;
            case NumberFormat.Binary:
                label += binaryFormat(value, this.size, false, true);
                break;
            case NumberFormat.Hexidecimal:
                label += hexFormat(value, Math.ceil(this.size / 4), true);
                break;
            default:
                label += this.size >= 4 ? hexFormat(value, Math.ceil(this.size / 4), true) : binaryFormat(value, this.size, false, true);
                break;
        }

        return new TreeNode(label, vscode.TreeItemCollapsibleState.None, 'field', this);
    }

    public getCopyValue(): string {
        const value = this.register.extractBits(this.offset, this.size);
        switch (this.getFormat()) {
            case NumberFormat.Decimal:
                return value.toString();
            case NumberFormat.Binary:
                return binaryFormat(value, this.size);
            case NumberFormat.Hexidecimal:
                return hexFormat(value, Math.ceil(this.size / 4), true);
            default:
                return this.size >= 4 ? hexFormat(value, Math.ceil(this.size / 4), true) : binaryFormat(value, this.size);
        }
    }

    public getFormat(): NumberFormat {
        if (this.format === NumberFormat.Auto) { return this.register.getFormat(); }
        else { return this.format; }
    }

    public _saveState(): NodeSetting {
        return this.format !== NumberFormat.Auto
            ? {
                node: `${this.register.name}.${this.name}`,
                format: this.format
            }
            : null;
    }
}

export class RegisterTreeProvider implements vscode.TreeDataProvider<TreeNode> {
    // tslint:disable-next-line:variable-name
    public _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined> = new vscode.EventEmitter<TreeNode | undefined>();
    public readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined> = this._onDidChangeTreeData.event;

    private registers: RegisterNode[];
    private registerMap: { [index: number]: RegisterNode };
    private loaded: boolean = false;

    constructor() {
        this.registers = [];
        this.registerMap = {};
    }

    public refresh(): void {
        if (vscode.debug.activeDebugSession) {
            if (!this.loaded) {
                vscode.debug.activeDebugSession.customRequest('read-register-list').then((data) => {
                    this.createRegisters(data);
                    this._refreshRegisterValues();
                });
            }
            else {
                this._refreshRegisterValues();
            }
        }
    }

    public _refreshRegisterValues() {
        vscode.debug.activeDebugSession.customRequest('read-registers').then((data) => {
            data.forEach((reg) => {
                const index = parseInt(reg.number, 10);
                const regNode = this.registerMap[index];
                if (regNode) { regNode.setValue(reg.value); }
            });
            this._onDidChangeTreeData.fire();
        });
    }

    public getTreeItem(element: TreeNode): vscode.TreeItem {
        return element.node.getTreeNode();
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

        vscode.workspace.findFiles('.vscode/.cortex-debug.registers.state.json', null, 1).then((value) => {
            if (value.length > 0) {
                const fspath = value[0].fsPath;
                const data = fs.readFileSync(fspath, 'utf8');
                const settings = JSON.parse(data);
                
                settings.forEach((s: NodeSetting) => {
                    if (s.node.indexOf('.') === -1) {
                        const register = this.registers.find((r) => r.name === s.node);
                        if (register) {
                            if (s.expanded) { register.expanded = s.expanded; }
                            if (s.format) { register.setFormat(s.format); }
                        }
                    }
                    else {
                        const [regname, fieldname] = s.node.split('.');
                        const register = this.registers.find((r) => r.name === regname);
                        if (register) {
                            const field = register.getChildren().find((f) => f.name === fieldname);
                            if (field && s.format) { field.setFormat(s.format); }
                        }
                    }
                });
                this._onDidChangeTreeData.fire();
            }
        }, (error) => {

        });

        this._onDidChangeTreeData.fire();
    }

    public updateRegisterValues(values: RegisterValue[]) {
        values.forEach((reg) => {
            const node = this.registerMap[reg.number];
            node.setValue(reg.value);
        });

        this._onDidChangeTreeData.fire();
    }

    public getChildren(element?: TreeNode): vscode.ProviderResult<TreeNode[]> {
        if (this.loaded && this.registers.length > 0) {
            if (element) {
                return element.node.getChildren().map((c) => c.getTreeNode());
            }
            else {
                return this.registers.map((r) => r.getTreeNode());
            }
        }
        else if (!this.loaded) {
            return [new TreeNode('Not in active debug session.', vscode.TreeItemCollapsibleState.None, 'message', null)];
        }
        else {
            return [];
        }
    }

    public _saveState(fspath: string) {
        const state: NodeSetting[] = [];
        this.registers.forEach((r) => {
            state.push(...r._saveState());
        });

        fs.writeFileSync(fspath, JSON.stringify(state), { encoding: 'utf8', flag: 'w' });
    }

    public debugSessionTerminated() {
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const fspath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, '.vscode', '.cortex-debug.registers.state.json');
            this._saveState(fspath);
        }

        this.loaded = false;
        this.registers = [];
        this.registerMap = {};
        this._onDidChangeTreeData.fire();
    }

    public debugSessionStarted() {
        this.loaded = false;
        this.registers = [];
        this.registerMap = {};
        this._onDidChangeTreeData.fire();
    }

    public debugStopped() {
        this.refresh();
    }

    public debugContinued() {
        
    }
}
