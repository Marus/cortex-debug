import { BaseNode } from './basenode';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { RegisterNode } from './registernode';

export class FieldNode extends BaseNode {
    constructor(public name: string, private offset: number, private size: number, private register: RegisterNode) {
        super(register);
    }

    public getChildren(): BaseNode[] | Promise<BaseNode[]> {
        return [];
    }

    public getTreeItem(): TreeItem | Promise<TreeItem> {
        const ti = new TreeItem(this.name, TreeItemCollapsibleState.None);
        const value = this.register.extractBits(this.offset, this.size);

        ti.description = value.toString();
        ti.contextValue = 'field';
        
        return ti;
    }

    public getCopyValue(): string | undefined {
        const value = this.register.extractBits(this.offset, this.size);
        return value.toString();
    }
}
