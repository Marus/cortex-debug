import { TreeItem, TreeItemCollapsibleState, window, debug } from 'vscode';
import { PeripheralBaseNode } from './basenode';
import { AccessType } from '../../svd';
import { PeripheralRegisterNode } from './peripheralregisternode';
import { AddressRangesInUse } from '../../addrranges';
import { NumberFormat, NodeSetting } from '../../../common';
import { parseInteger, binaryFormat, hexFormat } from '../../utils';

export interface EnumerationMap {
    [value: number]: EnumeratedValue;
}

export class EnumeratedValue {
    constructor(public name: string, public description: string, public value: number) {}
}

export interface FieldOptions {
    name: string;
    description: string;
    offset: number;
    width: number;
    enumeration?: EnumerationMap;
    accessType?: AccessType;
}

export class PeripheralFieldNode extends PeripheralBaseNode {
    public readonly name: string;
    public readonly description: string;
    public readonly offset: number;
    public readonly width: number;
    public readonly accessType: AccessType;
    
    private enumeration: EnumerationMap;
    private enumerationValues: string[];
    private enumerationMap: any;

    constructor(public parent: PeripheralRegisterNode, options: FieldOptions) {
        super(parent);

        this.name = options.name;
        this.description = options.description;
        this.offset = options.offset;
        this.width = options.width;
        
        if (!options.accessType) { this.accessType = parent.accessType; }
        else {
            if (parent.accessType === AccessType.ReadOnly && options.accessType !== AccessType.ReadOnly) {
                this.accessType = AccessType.ReadOnly;
            }
            else if (parent.accessType === AccessType.WriteOnly && options.accessType !== AccessType.WriteOnly) {
                this.accessType = AccessType.WriteOnly;
            }
            else {
                this.accessType = options.accessType;
            }
        }

        if (options.enumeration) {
            this.enumeration = options.enumeration;
            this.enumerationMap = {};
            this.enumerationValues = [];

            // tslint:disable-next-line:forin
            for (const key in options.enumeration) {
                const val = key;
                const name = options.enumeration[key].name;

                this.enumerationValues.push(name);
                this.enumerationMap[name] = key;
            }
        }

        this.parent.addChild(this);
    }

    public getTreeItem(): TreeItem | Promise<TreeItem> {
        const value = this.parent.extractBits(this.offset, this.width);
        const rangestart = this.offset;
        const rangeend = this.offset + this.width - 1;

        const label = `${this.name} [${rangeend}:${rangestart}]`;

        const context = this.name.toLowerCase() === 'reserved' ? 'field-res' : (this.parent.accessType === AccessType.ReadOnly ? 'field-ro' : 'field');
        
        const item = new TreeItem(label, TreeItemCollapsibleState.None);
        item.contextValue = context;
        item.tooltip = this.description;

        if (this.name.toLowerCase() !== 'reserved') {
            if (this.accessType === AccessType.WriteOnly) {
                item.description = '<Write Only>';
            }
            else {
                let formatted = '';
                switch (this.getFormat()) {
                    case NumberFormat.Decimal:
                        formatted = value.toString();
                        break;
                    case NumberFormat.Binary:
                        formatted = binaryFormat(value, this.width);
                        break;
                    case NumberFormat.Hexidecimal:
                        formatted = hexFormat(value, Math.ceil(this.width / 4), true);
                        break;
                    default:
                        formatted = this.width >= 4 ? hexFormat(value, Math.ceil(this.width / 4), true) : binaryFormat(value, this.width);
                        break;
                }

                if (this.enumeration && this.enumeration[value]) {
                    item.description = `${this.enumeration[value].name} (${formatted})`;
                }
                else {
                    item.description = formatted;
                }
            }
        }

        return item;
    }

    public getChildren(): PeripheralBaseNode[] | Promise<PeripheralBaseNode[]> {
        return [];
    }

    public performUpdate(): Thenable<any> {
        return new Promise((resolve, reject) => {
            if (this.enumeration) {
                window.showQuickPick(this.enumerationValues).then((val) => {
                    if (val === undefined) { return reject('Input not selected'); }
                    
                    const numval = this.enumerationMap[val];
                    this.parent.updateBits(this.offset, this.width, numval).then(resolve, reject);
                });
            }
            else {
                window.showInputBox({ prompt: 'Enter new value: (prefix hex with 0x, binary with 0b)', value: this.getCopyValue() }).then((val) => {
                    const numval = parseInteger(val);
                    if (numval === undefined) {
                        return reject('Unable to parse input value.');
                    }
                    this.parent.updateBits(this.offset, this.width, numval).then(resolve, reject);
                });
            }
        });
    }

    public getCopyValue(): string {
        const value = this.parent.extractBits(this.offset, this.width);
        switch (this.getFormat()) {
            case NumberFormat.Decimal:
                return value.toString();
            case NumberFormat.Binary:
                return binaryFormat(value, this.width);
            case NumberFormat.Hexidecimal:
                return hexFormat(value, Math.ceil(this.width / 4), true);
            default:
                return this.width >= 4 ? hexFormat(value, Math.ceil(this.width / 4), true) : binaryFormat(value, this.width);
        }
    }

    public updateData(): Thenable<boolean> {
        return Promise.resolve(true);
    }

    public getFormat(): NumberFormat {
        if (this.format !== NumberFormat.Auto) { return this.format; }
        else { return this.parent.getFormat(); }
    }

    public saveState(path: string): NodeSetting[] {
        if (this.format !== NumberFormat.Auto) {
            return [ {node: `${path}.${this.name}`, format: this.format }];
        }
        else {
            return [];
        }
    }

    public findByPath(path: string[]): PeripheralBaseNode {
        if (path.length === 0) { return this; }
        else { return null; }
    }

    public getPeripheral(): PeripheralBaseNode {
        return this.parent.getPeripheral();
    }

    public markAddresses(a: AddressRangesInUse): void {
        throw new Error('Method not implemented.');
    }
}
