import * as vscode from 'vscode';
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as xml2js from 'xml2js';

import { hexFormat, binaryFormat, createMask, extractBits } from './utils';

export enum RecordType {
	Peripheral = 1,
	Register,
	Field
}

export enum AccessType {
	ReadOnly = 1,
	ReadWrite,
	WriteOnly
}

export class TreeNode extends vscode.TreeItem {
	constructor(public readonly label: string, public readonly collapsibleState: vscode.TreeItemCollapsibleState, public contextValue: string, public node: BaseNode) {
		super(label, collapsibleState);
		this.command = {
			command: 'cortexPerhiperals.selectedNode',
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

	selected(): Thenable<boolean> { return Promise.resolve(false); }

	getChildren(): BaseNode[] { return []; }
	getTreeNode(): TreeNode { return null; }
}



interface EnumerationMap {
	[value:number] : EnumeratedValue;
}

class EnumeratedValue {
	constructor(public name: string, public description: string, public value: number) {

	}
}

export class PeripheralNode extends BaseNode {
	public registers: RegisterNode[];
	private currentValue: number[];

	constructor(public name: string, public baseAddress: number, public size: number, public description: string, public offset: number) {
		super(RecordType.Peripheral);
	}

	getTreeNode() : TreeNode {
		let label = this.name + "  [" + hexFormat(this.baseAddress) + "]";
		return new TreeNode(label, this.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed, 'perhiperal', this);
	}

	getChildren(): RegisterNode[] {
		return this.registers;
	}

	getBytes(offset: number, size: number): number[] {
		try {
			return this.currentValue.slice(offset, offset + size);
		}
		catch(e) {
			return [];
		}
	}

	update(): Thenable<boolean> {
		return new Promise((resolve, reject) => {
			if(!this.expanded) { resolve(false); return; }

			vscode.debug.activeDebugSession.customRequest('read-memory', { address: this.baseAddress + this.offset, length: this.size }).then((data) => {
				this.currentValue = data.bytes;

				this.registers.forEach(r => r.update());

				resolve(true);
			}, error => {
				reject(error);
			});
		});
	}

	selected(): Thenable<boolean> {
		return this.update();
	}
}

export class RegisterNode extends BaseNode {
	public fields: FieldNode[];
	protected currentValue: number;
	private length: number;

	constructor(public name: string, public offset: number, public size: number, public access: AccessType, public resetValue: number, public peripheral: PeripheralNode) {
		super(RecordType.Register);
		this.currentValue = this.resetValue;

		this.length = 2;
		if(this.size == 16) this.length = 4;
		else if(this.size == 32) this.length = 8;
	}

	reset() {
		this.currentValue = this.resetValue;
	}

	extractBits(offset: number, width: number) : number {
		return extractBits(this.currentValue, offset, width);
	}

	updateBits(offset: number, width: number, value: number): Thenable<any> {
		return new Promise((resolve, reject) => {
			var limit = Math.pow(2, width);
			if(value > limit) {
				vscode.window.showErrorMessage('Value entered is invalid. Maximum value for this field is ' + (limit - 1) + ' (0x' + hexFormat(limit-1, 0) + ')');
			}
			else {
				let mask = createMask(offset, width);
				var sv = value << offset;
				let newval = (this.currentValue & ~mask) | sv;
				this.currentValue = newval;
				resolve(this.currentValue);
			}
		});
	}

	getTreeNode() : TreeNode {
		let cv = 'registerRW';
		if(this.access == AccessType.ReadOnly) { cv = 'registerRO'; }
		else if(this.access == AccessType.WriteOnly) { cv = 'registerWO'; }

		let label = this.name + ' [' + hexFormat(this.offset, 2) + '] = ' + hexFormat(this.currentValue, this.length);

		return new TreeNode(label, this.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed, cv, this);
	}

	getChildren(): FieldNode[] {
		return this.fields;
	}

	update(): Thenable<boolean> {
		let bc = this.size / 8;
		let bytes = this.peripheral.getBytes(this.offset, bc).reverse();
		let cv = 0;
		for(var i = 0; i < bc; i++) {
			cv = cv << 8;
			cv |= bytes[i];
		}
		this.currentValue = cv;
		this.fields.forEach(f => f.update());

		return Promise.resolve(true);
	}
}

export class FieldNode extends BaseNode {
	public enumerationValues : string[];
	public enumerationMap : any;

	constructor(public name: string, public description: string, public offset: number, public width: number, public register: RegisterNode, public enumeration: EnumerationMap) {
		super(RecordType.Field);

		if(this.enumeration) {
			this.enumerationMap = {};
			this.enumerationValues = [];

			for(var key in this.enumeration) {
				let val = key;
				let name = this.enumeration[key].name;

				this.enumerationValues.push(name);
				this.enumerationMap[name] = key;
			}
		}
	}

	getTreeNode() : TreeNode {
		let value = this.register.extractBits(this.offset, this.width);
		let evalue = null;
		let label = this.name;

		let rangestart = this.offset;
		let rangeend = this.offset + this.width - 1;
		let context = 'field';

		label += ' [' + rangeend + ':' + rangestart + ']';
		if(this.name.toLowerCase() === 'reserved')  {
			context = 'field-res';
		}
		else {
			if(this.enumeration) {
				evalue = this.enumeration[value];
				label += ' = ' + evalue.name + ' (' + binaryFormat(value, this.width) + ')';
			}
			else {
				label += ' = ' + binaryFormat(value, this.width);
			}
		}

		if(this.register.access == AccessType.ReadOnly) {
			context = 'field-ro';
		}

		return new TreeNode(label, vscode.TreeItemCollapsibleState.None, context, this);
	}

	performUpdate() : Thenable<any> {
		return new Promise((resolve, reject) => {
			if(this.enumeration) {
				vscode.window.showQuickPick(this.enumerationValues).then(val => {
					if(val === undefined) {
						reject('Input not selected');
					}
					else {
						let numval = this.enumerationMap[val];
						this.register.updateBits(this.offset, this.width, numval).then(resolve, reject);
					}
				});
			}
			else {
				vscode.window.showInputBox({ prompt: "Enter new value: (prefix hex with 0x, binary with 0b)" }).then(val => {
					var numval = parseInt(val);
					this.register.updateBits(this.offset, this.width, numval).then(resolve, reject);
				});
			}
		});		
	}

	update() {}
}


export class PeripheralTreeProvider implements vscode.TreeDataProvider<TreeNode> {
	public _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined> = new vscode.EventEmitter<TreeNode | undefined>();
	readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined> = this._onDidChangeTreeData.event;
	
	_peripherials: Array<PeripheralNode> = [];
	_loaded: boolean = false;
	_SVDPath: string = '';

	constructor(private workspaceRoot: string, private extensionPath: string) {
		// this._loadSVD();
	}

	_parseFields(fields: any[], register: RegisterNode): FieldNode[] {
		return fields.map(f => {
			let offset;
			let width;
			if(f.bitOffset && f.bitWidth) {
				offset = parseInt(f.bitOffset[0]);
				width = parseInt(f.bitWidth[0]);
			}
			else if(f.bitRange) {
				let range = f.bitRange[0];
				range = range.substring(1,range.length - 1);
				range = range.split(':');
				let end = parseInt(range[0]);
				let start = parseInt(range[1]);

				width = end - start + 1;
				offset = start;
			}

			var value_map: EnumerationMap = null;
			if(f.enumeratedValues) {
				value_map = {};

				let ev = f.enumeratedValues[0];
				ev.enumeratedValue.map(ev => {
					let evname = ev.name[0];
					let evdesc = ev.description[0];
					let evvalue = parseInt(ev.value[0]);

					value_map[evvalue] = new EnumeratedValue(evname, evdesc, evvalue);
				});
			}

			return new FieldNode(f.name[0], f.description[0], offset, width, register, value_map)
		});
	}

	_parseRegisters(registers: any[], peripheral: PeripheralNode): RegisterNode[] {
		return registers.map(r => {
			let accessType = AccessType.ReadWrite;
			if(r.access && r.access.length == 1) {
				let access = r.access[0];
				if(access == 'read-only') { accessType = AccessType.ReadOnly; }
				else if(access == 'write-only') { accessType = AccessType.WriteOnly; }
			}

			let size = 32;
			if(r.size && r.size.length == 1) {
				size = parseInt(r.size[0]);
			}

			let register = new RegisterNode(r.name[0], parseInt(r.addressOffset[0], 16), size, accessType, parseInt(r.resetValue[0]), peripheral);
			let fields = this._parseFields(r.fields[0].field, register);
			register.fields = fields;			
			return register;
		});
	}

	_parsePeripheral(p: any): PeripheralNode {
		let ab = p.addressBlock[0];
		let size = ab.size[0];
		let offset = ab.offset[0];
		size = parseInt(size, 16) / 8;
		offset = parseInt(offset, 16);

		let peripheral = new PeripheralNode(p.name[0], parseInt(p.baseAddress[0], 16), size, p.description[0], offset);
		let registers = this._parseRegisters(p.registers[0].register, peripheral);
		peripheral.registers = registers;
		return peripheral;
	}
	
	_loadSVD(SVDFile: string): Thenable<any> {
		return new Promise((resolve, reject) => {
			fs.readFile(SVDFile, 'utf8', (err, data) => {
				xml2js.parseString(data, (err, result) => {
					var peripheralMap = {};
					result.device.peripherals[0].peripheral.forEach(element => {
						let name = element.name[0];
						peripheralMap[name] = element;
					});

					for(var key in peripheralMap) {
						let element = peripheralMap[key];
						if(element.$ && element.$.derivedFrom) {
							var base = peripheralMap[element.$.derivedFrom];
							peripheralMap[key] = {...base, ...element};
						}
					}

					this._peripherials = [];
					for(var key in peripheralMap) {
						this._peripherials.push(this._parsePeripheral(peripheralMap[key]));
					}

					this._loaded = true;
					this._onDidChangeTreeData.fire();

					resolve(true);
				});
			});
		});
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: TreeNode): vscode.TreeItem {
		return element;
	}

	getChildren(element?: TreeNode): Thenable<TreeNode[]> {
		if(this._loaded && this._peripherials.length > 0) {
			if(element) {
				return Promise.resolve(element.node.getChildren().map(c => c.getTreeNode()));
			}
			else {
				return Promise.resolve(this._peripherials.map(p => p.getTreeNode()));
			}
		}
		else if(!this._loaded) {
			return Promise.resolve([new TreeNode('No SVD File Loaded', vscode.TreeItemCollapsibleState.None, 'message', null)]);
		}
		else {
			return Promise.resolve([]);
		}
	}

	debugSessionStarted(config: any): Thenable<any> {
		return new Promise((resolve, reject) => {
			this._peripherials = [];
			this._loaded = false;
			if(!config.disable) {
				this._loadSVD(config.SVDFile).then(_ => {
					resolve(true);
				});
			}
		});
	}

	debugSessionTerminated(): Thenable<any> {
		return new Promise((resolve, reject) => {
			this._peripherials = [];
			this._loaded = false;
			resolve(true);
		});		
	}

	debugStopped() {
		if(this._loaded) {
			let promises = this._peripherials.map(p => p.update());
			Promise.all(promises).then(_ => { this._onDidChangeTreeData.fire(); }, _ => { this._onDidChangeTreeData.fire(); });
		}
	}
}