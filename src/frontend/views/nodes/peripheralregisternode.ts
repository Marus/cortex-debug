import { TreeItem, TreeItemCollapsibleState, window, debug, MarkdownString } from 'vscode';
import { PeripheralNode } from './peripheralnode';
import { PeripheralClusterNode } from './peripheralclusternode';
import { PeripheralBaseNode } from './basenode';
import { PeripheralFieldNode } from './peripheralfieldnode';
import { AccessType } from '../../svd';
import { extractBits, createMask, hexFormat, binaryFormat } from '../../utils';
import { NumberFormat, NodeSetting } from '../../../common';
import { AddressRangesInUse } from '../../addrranges';
import { MessageChannel } from 'worker_threads';

export interface PeripheralRegisterOptions {
    name: string;
    description?: string;
    addressOffset: number;
    accessType?: AccessType;
    size?: number;
    resetValue?: number;
}

export class PeripheralRegisterNode extends PeripheralBaseNode {
    public children: PeripheralFieldNode[];
    public readonly name: string;
    public readonly description?: string;
    public readonly offset: number;
    public readonly accessType: AccessType;
    public readonly size: number;
    public readonly resetValue: number;
    
    private maxValue: number;
    private hexLength: number;
    private hexRegex: RegExp;
    private binaryRegex: RegExp;
    private currentValue: number;
    
    constructor(public parent: PeripheralNode | PeripheralClusterNode, options: PeripheralRegisterOptions) {
        super(parent);
        
        this.name = options.name;
        this.description = options.description;
        this.offset = options.addressOffset;
        this.accessType = options.accessType || parent.accessType;
        this.size = options.size || parent.size;
        this.resetValue = options.resetValue !== undefined ? options.resetValue : parent.resetValue;
        this.currentValue = this.resetValue;

        this.hexLength = Math.ceil(this.size / 4);
        
        this.maxValue = Math.pow(2, this.size);
        this.binaryRegex = new RegExp(`^0b[01]{1,${this.size}}$`, 'i');
        this.hexRegex = new RegExp(`^0x[0-9a-f]{1,${this.hexLength}}$`, 'i');
        this.children = [];
        this.parent.addChild(this);
    }

    public reset() {
        this.currentValue = this.resetValue;
    }

    public extractBits(offset: number, width: number): number {
        return extractBits(this.currentValue, offset, width);
    }

    public updateBits(offset: number, width: number, value: number): Thenable<boolean> {
        return new Promise((resolve, reject) => {
            const limit = Math.pow(2, width);
            if (value > limit) {
                return reject(`Value entered is invalid. Maximum value for this field is ${limit - 1} (${hexFormat(limit - 1, 0)})`);
            }
            else {
                const mask = createMask(offset, width);
                const sv = value << offset;
                const newval = (this.currentValue & ~mask) | sv;
                this.updateValueInternal(newval).then(resolve, reject);
            }
        });
    }

    public getTreeItem(): TreeItem | Promise<TreeItem> {
        const label = `${this.name} @ ${hexFormat(this.offset, 0)}`;
        const collapseState = this.children && this.children.length > 0
            ? (this.expanded ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed)
            : TreeItemCollapsibleState.None;

        const item = new TreeItem(label, collapseState);
        item.contextValue = this.accessType === AccessType.ReadWrite ? 'registerRW' : (this.accessType === AccessType.ReadOnly ? 'registerRO' : 'registerWO');
        item.tooltip = this.generateTooltipMarkdown();
        item.description = this.getFormattedValue(this.getFormat());

        return item;
    }

    private generateTooltipMarkdown(): MarkdownString | null {
        const mds = new MarkdownString('', true);
        mds.isTrusted = true;

        const address = `${ hexFormat(this.getAddress()) }`;

        const formattedValue = this.getFormattedValue(this.getFormat());

        const roLabel = this.accessType === AccessType.ReadOnly ? '(Read Only)' : '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;';

        mds.appendMarkdown(`| ${ this.name }@${ address } | ${ roLabel } | *${ formattedValue }* |\n`);
        mds.appendMarkdown('|:---|:---:|---:|\n\n');

        if (this.accessType !== AccessType.WriteOnly) {
            mds.appendMarkdown(`**Reset Value:** ${ this.getFormattedResetValue(this.getFormat()) }\n`);
        }
        
        mds.appendMarkdown('\n____\n\n');
        mds.appendMarkdown(this.description);

        mds.appendMarkdown('\n_____\n\n');

        // Don't try to display current value table for write only fields
        if (this.accessType === AccessType.WriteOnly) {
            return mds;
        }

        const hex = this.getFormattedValue(NumberFormat.Hexidecimal);
        const decimal = this.getFormattedValue(NumberFormat.Decimal);
        const binary = this.getFormattedValue(NumberFormat.Binary);
        
        mds.appendMarkdown('| Hex &nbsp;&nbsp; | Decimal &nbsp;&nbsp; | Binary &nbsp;&nbsp; |\n');
        mds.appendMarkdown('|:---|:---|:---|\n');
        mds.appendMarkdown(`| ${ hex } &nbsp;&nbsp; | ${ decimal } &nbsp;&nbsp; | ${ binary } &nbsp;&nbsp; |\n\n`);

        const children = this.getChildren();
        if (children.length === 0) { return mds; }

        mds.appendMarkdown('**Fields**\n\n');
        mds.appendMarkdown('| Field | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | Bit-Range | Value |\n');
        mds.appendMarkdown('|:---|:---:|:---|:---|\n');

        children.forEach((field) => {
            mds.appendMarkdown(`| ${ field.name } | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | ${ field.getFormattedRange() } | ${ field.getFormattedValue(field.getFormat(), true) } |\n`);
        });

        return mds;
    }

    public getFormattedValue(format: NumberFormat): string {
        return this.formatValue(this.currentValue, format);
    }

    public getFormattedResetValue(format: NumberFormat): string {
        return this.formatValue(this.resetValue, format);
    }

    private formatValue(value: number, format: NumberFormat): string {
        if (this.accessType === AccessType.WriteOnly) {
            return '(Write Only)';
        }

        switch (format) {
            case NumberFormat.Decimal:
                return value.toString();
            case NumberFormat.Binary:
                return binaryFormat(value, this.hexLength * 4);
            default:
                return hexFormat(value, this.hexLength, true);
        }
    }

    public extractBitsFromReset(offset: number, width: number): number {
        return extractBits(this.resetValue, offset, width);
    }

    public getChildren(): PeripheralFieldNode[] {
        return this.children || [];
    }

    public setChildren(children: PeripheralFieldNode[]) {
        this.children = children.slice(0, children.length);
        this.children.sort((f1, f2) => f1.offset > f2.offset ? 1 : -1);
    }

    public addChild(child: PeripheralFieldNode) {
        this.children.push(child);
        this.children.sort((f1, f2) => f1.offset > f2.offset ? 1 : -1);
    }

    public getFormat(): NumberFormat {
        if (this.format !== NumberFormat.Auto) { return this.format; }
        else { return this.parent.getFormat(); }
    }

    public getCopyValue(): string {
        switch (this.getFormat()) {
            case NumberFormat.Decimal:
                return this.currentValue.toString();
            case NumberFormat.Binary:
                return binaryFormat(this.currentValue, this.hexLength * 4);
            default:
                return hexFormat(this.currentValue, this.hexLength);
        }
    }

    public performUpdate(): Thenable<boolean> {
        return new Promise((resolve, reject) => {
            window.showInputBox({ prompt: 'Enter new value: (prefix hex with 0x, binary with 0b)', value: this.getCopyValue() }).then((val) => {
                let numval: number;
                if (val.match(this.hexRegex)) { numval = parseInt(val.substr(2), 16); }
                else if (val.match(this.binaryRegex)) { numval = parseInt(val.substr(2), 2); }
                else if (val.match(/^[0-9]+/)) {
                    numval = parseInt(val, 10);
                    if (numval >= this.maxValue) {
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

    public getAddress(): number {
        return this.parent.getAddress(this.offset);
    }

    private updateValueInternal(value: number): Thenable<boolean> {
        const address = this.parent.getAddress(this.offset);
        const bytes = [];
        const numbytes = this.size / 8;

        for (let i = 0; i < numbytes; i++) {
            const byte = value & 0xFF;
            value = value >>> 8;
            let bs = byte.toString(16);
            if (bs.length === 1) { bs = '0' + bs; }
            bytes[i] = bs;
        }

        return new Promise((resolve, reject) => {
            debug.activeDebugSession.customRequest('write-memory', { address: address, data: bytes.join('') }).then((result) => {
                this.parent.updateData().then(() => {}, () => {});
                resolve(true);
            }, reject);
        });
    }

    public updateData(): Thenable<boolean> {
        const bc = this.size / 8;
        const bytes = this.parent.getBytes(this.offset, bc);
        const buffer = Buffer.from(bytes);
        switch (bc) {
            case 1:
                this.currentValue = buffer.readUInt8(0);
                break;
            case 2:
                this.currentValue = buffer.readUInt16LE(0);
                break;
            case 4:
                this.currentValue = buffer.readUInt32LE(0);
                break;
            default:
                window.showErrorMessage(`Register ${this.name} has invalid size: ${this.size}. Should be 8, 16 or 32.`);
                break;
        }
        this.children.forEach((f) => f.updateData());

        return Promise.resolve(true);
    }

    public saveState(path?: string): NodeSetting[] {
        const results: NodeSetting[] = [];

        if (this.format !== NumberFormat.Auto || this.expanded) {
            results.push({ node: `${path}.${this.name}`, expanded: this.expanded, format: this.format });
        }

        this.children.forEach((c) => {
            results.push(...c.saveState(`${path}.${this.name}`));
        });

        return results;
    }

    public findByPath(path: string[]): PeripheralBaseNode {
        if (path.length === 0) { return this; }
        else if (path.length === 1) {
            const child = this.children.find((c) => c.name === path[0]);
            return child;
        }
        else { return null; }
    }

    public getPeripheral(): PeripheralBaseNode {
        return this.parent.getPeripheral();
    }

    public markAddresses(addrs: AddressRangesInUse): void {
        const finalOffset = this.parent.getOffset(this.offset);
        addrs.setAddrRange(finalOffset, this.size / 8);
    }
}
