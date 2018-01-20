import * as vscode from 'vscode';
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as xml2js from 'xml2js';

import { hexFormat, binaryFormat, createMask, extractBits } from './utils';
import { ProviderResult } from 'vscode';

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
			command: 'cortex-debug.peripherals.selectedNode',
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

	performUpdate() : Thenable<any> {
		return Promise.resolve(false);
	}
	
	getChildren(): BaseNode[] { return []; }
	getTreeNode(): TreeNode { return null; }
	getCopyValue(): string { return null; }
}


function parseInteger(value: string): number {
	if((/^0b([01]+)$/i).test(value)) {
		return parseInt(value.substring(2), 2);
	}
	else if((/^0x([0-9a-f]+)$/i).test(value)) {
		return parseInt(value.substring(2), 16);
	}
	else if ((/^[0-9]+/i).test(value)) {
		return parseInt(value, 10);
	}
	else if ((/^#[0-1]+/i).test(value)) {
		return parseInt(value.substring(1), 2);
	}
	return undefined;
}

function parseDimIndex(spec: string, count: number) : string[] {
	if (spec.indexOf(',') !== -1) {
		let components = spec.split(',').map(c => c.trim());
		if (components.length !== count) {
			throw new Error(`dimIndex Element has invalid specification.`);
		}
		return components;
	}

	if (/^([0-9]+)\-([0-9]+)$/i.test(spec)) {
		let parts = spec.split('-').map(p => parseInteger(p));
		let start = parts[0];
		let end = parts[1];

		let diff = end - start;
		if (diff < count) {
			throw new Error(`dimIndex Element has invalid specification.`);
		}

		let components = [];
		for (let i = 0; i < count; i++) {
			components.push(`${start + i}`);
		}

		return components;
	}

	if (/^[a-zA-Z]\-[a-zA-Z]$/.test(spec)) {
		let start = spec.charCodeAt(0);
		let end = spec.charCodeAt(2);

		let diff = end - start;
		if (diff < count) {
			throw new Error(`dimIndex Element has invalid specification.`);
		}

		let components = [];
		for (let i = 0; i < count; i++) {
			components.push(String.fromCharCode(start + i));
		}

		return components;
	}

	return [];
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
		return new TreeNode(label, this.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed, 'peripheral', this);
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
	private maxValue: number;
	private hexRegex: RegExp;
	private binaryRegex: RegExp;

	constructor(public name: string, public offset: number, public size: number, public access: AccessType, public resetValue: number, public peripheral: PeripheralNode) {
		super(RecordType.Register);
		this.currentValue = this.resetValue;

		this.length = 2;
		if(this.size == 16) this.length = 4;
		else if(this.size == 32) this.length = 8;

		this.maxValue = Math.pow(2, size);
		this.binaryRegex = new RegExp(`^0b[01]{1,${this.size}}$`, 'i');
		this.hexRegex = new RegExp(`^0x[0-9a-f]{1,${this.length}}$`,'i');
	}

	reset() {
		this.currentValue = this.resetValue;
	}

	extractBits(offset: number, width: number) : number {
		return extractBits(this.currentValue, offset, width);
	}

	updateBits(offset: number, width: number, value: number): Thenable<boolean> {
		return new Promise((resolve, reject) => {
			var limit = Math.pow(2, width);
			if(value > limit) {
				return reject('Value entered is invalid. Maximum value for this field is ' + (limit - 1) + ' (0x' + hexFormat(limit-1, 0) + ')')
			}
			else {
				let mask = createMask(offset, width);
				var sv = value << offset;
				let newval = (this.currentValue & ~mask) | sv;
				this.updateValueInternal(newval).then(resolve, reject);
			}
		});
	}

	getTreeNode() : TreeNode {
		let cv = 'registerRW';
		if(this.access == AccessType.ReadOnly) { cv = 'registerRO'; }
		else if(this.access == AccessType.WriteOnly) { cv = 'registerWO'; }

		let label = this.name + ' [' + hexFormat(this.offset, 2) + '] = ' + hexFormat(this.currentValue, this.length);
		let collapseState = this.fields && this.fields.length > 0 ? (this.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed) : vscode.TreeItemCollapsibleState.None
		
		return new TreeNode(label, collapseState, cv, this);
	}

	getChildren(): FieldNode[] {
		return this.fields || [];
	}

	getCopyValue(): string {
		return hexFormat(this.currentValue, this.length);
	}

	performUpdate() : Thenable<boolean> {
		return new Promise((resolve, reject) => {
			vscode.window.showInputBox({ prompt: "Enter new value: (prefix hex with 0x, binary with 0b)" }).then(val => {
				let numval = undefined;
				if(val.match(this.hexRegex)) { numval = parseInt(val.substr(2), 16); }
				else if(val.match(this.binaryRegex)) { numval = parseInt(val.substr(2), 2); }
				else if(val.match(/^[0-9]+/)) {
					numval = parseInt(val, 10);
					if(numval >= this.maxValue) {
						return reject(`Value entered (${numval}) is greater than the maximum value of ${this.maxValue}`);
					}
				}
				else {
					return reject('Value entered is not a valid format.');
					
				}

				this.updateValueInternal(numval).then(resolve, reject);
			});
		});
	}

	private updateValueInternal(value: number) : Thenable<boolean> {
		let address = this.peripheral.baseAddress + this.offset;
		let bytes = [];
		let numbytes = this.length / 2;

		for(var i = 0; i < numbytes; i++) {
			let byte = value & 0xFF;
			value = value >>> 8;
			let bs = byte.toString(16);
			if(bs.length == 1) { bs = '0' + bs; }
			bytes[i] = bs;
		}

		return new Promise((resolve, reject) => {
			vscode.debug.activeDebugSession.customRequest('write-memory', { address: address, data: bytes.join('') }).then(result => {
				this.peripheral.update().then(() => {}, () => {});
				resolve(true);
			}, reject)
		});
		
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
					if(val === undefined) { return reject('Input not selected'); }
					
					let numval = this.enumerationMap[val];
					this.register.updateBits(this.offset, this.width, numval).then(resolve, reject);
				});
			}
			else {
				vscode.window.showInputBox({ prompt: "Enter new value: (prefix hex with 0x, binary with 0b)" }).then(val => {
					let numval = parseInteger(val);
					if (numval === undefined) {
						return reject('Unable to parse input value.');
					}
					this.register.updateBits(this.offset, this.width, numval).then(resolve, reject);
				});
			}
		});
	}

	getCopyValue() : string {
		let value = this.register.extractBits(this.offset, this.width);
		return binaryFormat(value, this.width);
	}

	update() {}
}


export class PeripheralTreeProvider implements vscode.TreeDataProvider<TreeNode> {
	public _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined> = new vscode.EventEmitter<TreeNode | undefined>();
	readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined> = this._onDidChangeTreeData.event;
	
	_peripherials: Array<PeripheralNode> = [];
	_loaded: boolean = false;
	_SVDPath: string = '';

	constructor() {

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
					let val = ev.value[0].toLowerCase();
					let evvalue = parseInteger(val);
					
					value_map[evvalue] = new EnumeratedValue(evname, evdesc, evvalue);
				});
			}

			return new FieldNode(f.name[0], f.description[0], offset, width, register, value_map)
		});
	}

	_parseRegisters(regInfo: any[], peripheral: PeripheralNode): RegisterNode[] {
		let registers: RegisterNode[] = [];

		regInfo.forEach(r => {
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

			if (r.dim) {
				if (!r.dimIncrement) { throw new Error(`Unable to parse SVD file: register ${r.name[0]} has dim element, with no dimIncrement element`); }

				let count = parseInteger(r.dim[0]);
				let increment = parseInteger(r.dimIncrement[0]);
				let index = parseDimIndex(r.dimIndex[0], count);

				let namebase: string = r.name[0];
				let offsetbase = parseInteger(r.addressOffset[0]);
				let resetvalue = parseInteger(r.resetValue[0]);

				for (let i = 0; i < count; i++) {
					let name = namebase.replace('%s', index[i]);

					let register = new RegisterNode(name, offsetbase + (increment * i), size, accessType, resetvalue, peripheral);
					if (r.fields && r.fields.length == 1) {
						let fields = this._parseFields(r.fields[0].field, register);
						register.fields = fields;
					}
					registers.push(register);
				}
			}
			else {
				let register = new RegisterNode(r.name[0], parseInteger(r.addressOffset[0]), size, accessType, parseInteger(r.resetValue[0]), peripheral);
				if (r.fields && r.fields.length == 1) {
					let fields = this._parseFields(r.fields[0].field, register);
					register.fields = fields;
				}
				registers.push(register);
			}
		});

		registers.sort((a, b) => {
			if (a.offset < b.offset) { return -1; }
			else if(a.offset > b.offset) { return 1; }
			else { return 0; }
		});

		return registers;
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

	getChildren(element?: TreeNode): ProviderResult<TreeNode[]> {
		if(this._loaded && this._peripherials.length > 0) {
			if(element) {
				return element.node.getChildren().map(c => c.getTreeNode());
			}
			else {
				return this._peripherials.map(p => p.getTreeNode());
			}
		}
		else if(!this._loaded) {
			return [new TreeNode('No SVD File Loaded', vscode.TreeItemCollapsibleState.None, 'message', null)];
		}
		else {
			return [];
		}
	}

	debugSessionStarted(svdfile: string): Thenable<any> {
		return new Promise((resolve, reject) => {
			this._peripherials = [];
			this._loaded = false;
			this._onDidChangeTreeData.fire();
			
			if(svdfile) {
				setTimeout(() => {
					this._loadSVD(svdfile).then(
						() => {
							this._onDidChangeTreeData.fire();
							resolve();
						},
						(e) => {
							this._peripherials = [];
							this._loaded = false;
							this._onDidChangeTreeData.fire();
							vscode.window.showErrorMessage(`Unable to parse SVD file: ${e.toString()}`);
						}
					);
				}, 150);
			}
			else {
				resolve();
			}
		});
	}

	debugSessionTerminated(): Thenable<any> {
		this._peripherials = [];
		this._loaded = false;
		this._onDidChangeTreeData.fire();
		return Promise.resolve(true);
	}

	debugStopped() {
		if(this._loaded) {
			let promises = this._peripherials.map(p => p.update());
			Promise.all(promises).then(_ => { this._onDidChangeTreeData.fire(); }, _ => { this._onDidChangeTreeData.fire(); });
		}
	}

	debugContinued() {
		
	}
}