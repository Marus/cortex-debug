import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { hexFormat, binaryFormat, createMask, extractBits } from './utils';

interface RegisterValue {
	number: number;
	value: number;
}

export enum RecordType {
	Register,
	Field
}

export class TreeNode extends vscode.TreeItem {
	constructor(public readonly label: string, public readonly collapsibleState: vscode.TreeItemCollapsibleState, public contextValue: string, public node: BaseNode) {
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

	constructor(public recordType: RecordType) {
		this.expanded = false;
	}

	getChildren(): BaseNode[] { return []; }
	getTreeNode(): TreeNode { return null; }
	getCopyValue(): string { return null; }
}

export class RegisterNode extends BaseNode {
	private fields: FieldNode[];
	private currentValue: number;

	constructor(public name: string, public number: number) {
		super(RecordType.Register);
		this.name = this.name;

		if(name.toUpperCase() === 'XPSR' || name.toUpperCase() === 'CPSR') {
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
		else if(name.toUpperCase() == 'CONTROL') {
			this.fields = [
				new FieldNode('FPCA', 2, 1, this),
				new FieldNode('SPSEL', 1, 1, this),
				new FieldNode('nPRIV', 0, 1, this)
			];
		}

		this.currentValue = 0x00;
	}

	extractBits(offset: number, width: number) : number {
		return extractBits(this.currentValue, offset, width);
	}

	getTreeNode() : TreeNode {
		let label = this.name + '  =  ' + hexFormat(this.currentValue, 8);

		if(this.fields && this.fields.length > 0) {
			return new TreeNode(label, this.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed, 'register', this);
		}
		else {
			return new TreeNode(label, vscode.TreeItemCollapsibleState.None, 'register', this);
		}
	}

	getChildren() : FieldNode[] {
		return this.fields;
	}

	setValue(newValue: number) {
		this.currentValue = newValue;
	}

	getCopyValue(): string {
		return hexFormat(this.currentValue, 8);
	}
}

export class FieldNode extends BaseNode {
	constructor(public name: string, private offset: number, private size: number, private register: RegisterNode) {
		super(RecordType.Field)
	}

	getTreeNode() : TreeNode {
		let value = this.register.extractBits(this.offset, this.size);
		let label = this.name + '  =  ';
		if(this.size == 1) { label += value; }
		else { label += hexFormat(value, 0); }

		return new TreeNode(label, vscode.TreeItemCollapsibleState.None, 'field', this);
	}

	getCopyValue() : string {
		let value = this.register.extractBits(this.offset, this.size);
		if(this.size == 1) { return value.toString(); }
		else { return hexFormat(value); }
	}
}

export class RegisterTreeProvider implements vscode.TreeDataProvider<TreeNode> {
	public _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined> = new vscode.EventEmitter<TreeNode | undefined>();
	readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined> = this._onDidChangeTreeData.event;

	private _registers: RegisterNode[];
	private _registerMap: { [number: number] : RegisterNode };
	private _loaded: boolean = false;

	constructor() {
		this._registers = [];
		this._registerMap = {};
	}

	refresh(): void {
		if(vscode.debug.activeDebugSession) {
			if(!this._loaded) {
				vscode.debug.activeDebugSession.customRequest('read-register-list').then(data => {
					this.createRegisters(data);
					this._refreshRegisterValues();
				});
			}
			else {
				this._refreshRegisterValues();
			}
		}
	}

	_refreshRegisterValues() {
		vscode.debug.activeDebugSession.customRequest('read-registers').then(data => {
			data.forEach(reg => {
				let number = parseInt(reg.number, 10);
				let value = parseInt(reg.value, 16);
				let regNode = this._registerMap[number];
				if(regNode) { regNode.setValue(value); }
			});
			this._onDidChangeTreeData.fire();
		});
	}

	getTreeItem(element: TreeNode) : vscode.TreeItem {
		return element.node.getTreeNode();
	}

	createRegisters(regInfo: string[]) {
		this._registerMap = {};
		this._registers = [];
		
		regInfo.forEach((reg, idx) => {
			if(reg) {
				let rn = new RegisterNode(reg, idx);
				this._registers.push(rn)
				this._registerMap[idx] = rn;
			}
		});

		this._loaded = true;
		this._onDidChangeTreeData.fire();
	}

	updateRegisterValues(values: RegisterValue[]) {
		values.forEach((reg) => {
			let node = this._registerMap[reg.number];
			node.setValue(reg.value);
		});

		this._onDidChangeTreeData.fire();
	}

	getChildren(element? : TreeNode): vscode.ProviderResult<TreeNode[]> {
		if(this._loaded && this._registers.length > 0) {
			if(element) {
				return element.node.getChildren().map(c => c.getTreeNode());
			}
			else {
				return this._registers.map(r => r.getTreeNode());
			}
		}
		else if(!this._loaded) {
			return [new TreeNode('Not in active debug session.', vscode.TreeItemCollapsibleState.None, 'message', null)];
		}
		else {
			return [];
		}
	}

	debugSessionTerminated() {
		this._loaded = false;
		this._registers = [];
		this._registerMap = {};
		this._onDidChangeTreeData.fire();
	}

	debugSessionStarted() {
		this._loaded = false;
		this._registers = [];
		this._registerMap = {};
		this._onDidChangeTreeData.fire();
	}

	debugStopped() {
		this.refresh();
	}

	debugContinued() {
		
	}
}