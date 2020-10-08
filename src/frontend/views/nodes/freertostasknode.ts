import { TreeItem, TreeItemCollapsibleState } from 'vscode';

import { BaseNode } from './basenode';
import { NodeSetting } from '../../../common';

import { hexFormat, binaryFormat, createMask, extractBits } from '../../utils';
import { FreeRTOSTaskFieldNode } from './freertostaskfieldnode';

export interface FreertosTask {
    name: string;
    address: number;
    priority: number;
    stackTop: number;
    stackStart: number;
    stackEnd: number;
    state: string;
}

export class FreertosTaskNode extends BaseNode {

    private fields: FreeRTOSTaskFieldNode[];

    constructor(public task: FreertosTask) {
        super(null);

        this.fields = [
            new FreeRTOSTaskFieldNode('name', 'name', this),
            new FreeRTOSTaskFieldNode('address', 'address', this),
            new FreeRTOSTaskFieldNode('stack top', 'stackTop', this),
            new FreeRTOSTaskFieldNode('priority', 'priority', this),
            new FreeRTOSTaskFieldNode('state', 'state', this)
        ];
    }

    public getTreeItem(): TreeItem | Promise<TreeItem> {
        const state = this.fields && this.fields.length > 0 ?
            (this.expanded ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed)
            : TreeItemCollapsibleState.None;

        const item = new TreeItem(this.task.name, state);
        item.description = this.task.state;
        item.contextValue = 'register';

        return item;
    }

    public getChildren(): FreeRTOSTaskFieldNode[] {
        return this.fields;
    }

    public getAddress(): number {
        return this.task.address;
    }

    public getCopyValue(): string {
        // TODO: copy out whole interface
        return '';
    }

    public _saveState(): NodeSetting[] {
        const settings: NodeSetting[] = [];

        return settings;
    }
}
