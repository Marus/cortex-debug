import { BaseNode } from './basenode';
import { TreeItem, TreeItemCollapsibleState, TreeItemLabel } from 'vscode';
import { RegisterNode } from './registernode';
import { toStringDecHexOctBin } from '../../../common';

export class FieldNode extends BaseNode {
    public preValue: string = '';
    public value: string = ''
    
    constructor(public name: string, private offset: number, private size: number, private register: RegisterNode) {
        super(register);
    }

    public getChildren(): BaseNode[] | Promise<BaseNode[]> {
        return [];
    }

    public getTreeItem(): TreeItem | Promise<TreeItem> {
        const value = this.register.extractBits(this.offset, this.size);
        this.value = value.toString();

        const label: TreeItemLabel = {
            label: this.name
        }
        if (this.preValue && (this.preValue !== this.value)) {
            label.highlights = [[0, label.label.length]];
        }
        this.preValue = this.value;
        
        const ti = new TreeItem(label, TreeItemCollapsibleState.None);
        ti.description = this.value;
        ti.contextValue = 'field';
        ti.tooltip = '$' + this.register.name + '.' + this.name + '\n' + toStringDecHexOctBin(value);
        
        return ti;
    }

    public getCopyValue(): string | undefined {
        const value = this.register.extractBits(this.offset, this.size);
        return value.toString();
    }
}
