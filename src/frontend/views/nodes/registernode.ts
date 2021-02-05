import { TreeItem, TreeItemCollapsibleState } from 'vscode';

import { BaseNode } from './basenode';
import { FieldNode } from './fieldnode';
import { NumberFormat, NodeSetting } from '../../../common';

import { hexFormat, binaryFormat, createMask, extractBits } from '../../utils';
import { parse } from 'commander';

export interface RegisterValue {
    number: number;
    value: string;
}

export class RegisterNode extends BaseNode {
    public formatOverride: NumberFormat;
    public canSetFormat: boolean; // TODO(harrison): make this not settable publicly
    private currentNaturalValue: string;
    private currentNumericValue: number;
    private currentDisplayValue: string;

    private fields: FieldNode[];

    constructor(public name: string, public index: number) {
        super(null);
        
        this.name = this.name;
        this.formatOverride = NumberFormat.Auto;
        this.canSetFormat = true;

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

            this.canSetFormat = false;
        }
        else if (name.toUpperCase() === 'CONTROL') {
            this.fields = [
                new FieldNode('FPCA', 2, 1, this),
                new FieldNode('SPSEL', 1, 1, this),
                new FieldNode('nPRIV', 0, 1, this)
            ];

            this.canSetFormat = false;
        } else if (name.startsWith('f')) {
            this.canSetFormat = false;
        }

        this.currentNaturalValue = '0x00000000';
    }

    public extractBits(offset: number, width: number): number {
        return extractBits(this.currentNumericValue, offset, width);
    }

    public getTreeItem(): TreeItem | Promise<TreeItem> {
        const state = this.fields && this.fields.length > 0 ?
            (this.expanded ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed)
            : TreeItemCollapsibleState.None;
        
        const item = new TreeItem(this.name, state);
        item.description = this.getCopyValue();
        item.contextValue = 'register';

        return item;
    }

    public getChildren(): FieldNode[] {
        return this.fields;
    }

    public setValue(newValue: string) {
        this.currentNaturalValue = newValue;

        // 1. get numeric value of currentNaturalValue
        let value: number = 0;

        if (this.currentNaturalValue.startsWith('0x')) {
            value = parseInt(this.currentNaturalValue, 16)
        } else {
            value = parseInt(this.currentNaturalValue, 10);
        }

        this.currentNumericValue = value;

        // 2. create ui-facing properly formatted version
        if (this.formatOverride != NumberFormat.Auto) {
            this.currentDisplayValue = this.doFormat(this.currentNumericValue, this.formatOverride);
        } else {
            this.currentDisplayValue = this.currentNaturalValue;
        }
    }

    public getCopyValue(): string {
        return this.currentDisplayValue;
    }

    public _saveState(): NodeSetting[] {
        const settings: NodeSetting[] = [];
        if (this.fields && this.fields.length > 0 && this.expanded) {
            settings.push({ node: this.name, expanded: this.expanded });
        }

        return settings;
    }

    private doFormat(value: number, format: NumberFormat) : string {
        switch (format) {
            case NumberFormat.Decimal:
                return value.toString();
            case NumberFormat.Binary:
                return binaryFormat(value, 8 * 4); // TODO(harrison): don't hard code this
            default:
                return hexFormat(value, 8); // TODO(harrison): or this
        }
    }
}
