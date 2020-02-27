import { TreeItem, TreeItemCollapsibleState } from 'vscode';

import { BaseNode } from './basenode';
import { FieldNode } from './fieldnode';
import { NodeSetting } from '../../../common';

import { hexFormat, binaryFormat, createMask, extractBits } from '../../utils';

export interface RegisterValue {
    number: number;
    value: string;
}

export class RegisterNode extends BaseNode {
    private fields: FieldNode[];
    private currentValue: number;
    private currentNaturalValue: string;

    constructor(public name: string, public index: number) {
        super(null);
        
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

    public getTreeItem(): TreeItem | Promise<TreeItem> {
        const state = this.fields && this.fields.length > 0 ?
            (this.expanded ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed)
            : TreeItemCollapsibleState.None;
        
        const item = new TreeItem(this.name, state);
        item.description = this.currentNaturalValue;
        item.contextValue = 'register';

        return item;
    }

    public getChildren(): FieldNode[] {
        return this.fields;
    }

    public setValue(newValue: string) {
        this.currentNaturalValue = newValue;
        if (this.name.toUpperCase() === 'CONTROL' || this.name.toUpperCase() === 'XPSR' || this.name.toUpperCase() === 'CPSR') {
            if (this.currentNaturalValue.startsWith('0x')) {
                this.currentValue = parseInt(this.currentNaturalValue, 16);
            } else {
                this.currentValue = parseInt(this.currentNaturalValue, 10);
                if (this.currentValue < 0) {
                    // convert to unsigned 32 bit quantity
                    const tmp = (this.currentValue & 0xffffffff) >>> 0;
                    this.currentValue = tmp;
                }
                let cv = this.currentValue.toString(16);
                while (cv.length < 8) { cv = '0' + cv; }
                this.currentNaturalValue = '0x' + cv;
            }
        }
    }

    public getCopyValue(): string {
        return this.currentNaturalValue;
    }

    public _saveState(): NodeSetting[] {
        const settings: NodeSetting[] = [];
        if (this.fields && this.fields.length > 0 && this.expanded) {
            settings.push({ node: this.name, expanded: this.expanded });
        }

        return settings;
    }
}
