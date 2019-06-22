import { PeripheralBaseNode, BaseNode } from './basenode';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { AddressRangesInUse } from '../../addrranges';
import { NodeSetting } from '../../../common';

export class MessageNode extends PeripheralBaseNode {
    
    constructor(public message: string, public tooltip?: string) {
        super(null);
    }

    public getChildren(): PeripheralBaseNode[] | Promise<PeripheralBaseNode[]> {
        return [];
    }

    public getTreeItem(): TreeItem | Promise<TreeItem> {
        const ti = new TreeItem(this.message, TreeItemCollapsibleState.None);
        ti.tooltip = this.tooltip;
        return ti;
    }

    public getCopyValue(): string | undefined {
        return null;
    }

    public performUpdate(): Thenable<any> {
        return Promise.resolve(false);
    }

    public updateData(): Thenable<boolean> {
        return Promise.resolve(false);
    }

    public getPeripheral(): PeripheralBaseNode {
        return null;
    }

    public markAddresses(a: AddressRangesInUse): void {
    }

    public saveState(path?: string): NodeSetting[] {
        return [];
    }

    public findByPath(path: string[]): PeripheralBaseNode {
        return null;
    }
}
