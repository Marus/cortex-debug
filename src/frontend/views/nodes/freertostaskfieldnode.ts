import { BaseNode } from './basenode';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { FreertosTaskNode } from './freertostasknode';

export class FreeRTOSTaskFieldNode extends BaseNode {
    constructor(public name: string, private property, private taskNode: FreertosTaskNode) {
        super(taskNode);
    }

    public getChildren(): BaseNode[] | Promise<BaseNode[]> {
        return [];
    }

    public getTreeItem(): TreeItem | Promise<TreeItem> {
        const ti = new TreeItem(this.name, TreeItemCollapsibleState.None);
        const value = this.taskNode.task[this.property];

        ti.description = value.toString();
        ti.contextValue = 'field';

        return ti;
    }

    public getCopyValue(): string | undefined {
        const value = this.taskNode.task[this.property];
        return value.toString();
    }
}
