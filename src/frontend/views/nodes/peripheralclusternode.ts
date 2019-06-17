import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { PeripheralBaseNode } from './basenode';
import { AccessType } from '../../svd';
import { PeripheralRegisterNode } from './peripheralregisternode';
import { PeripheralNode } from './peripheralnode';
import { NodeSetting, NumberFormat } from '../../../common';
import { AddressRangesInUse } from '../../addrranges';
import { hexFormat } from '../../utils';

export interface ClusterOptions {
    name: string;
    description?: string;
    addressOffset: number;
    accessType?: AccessType;
    size?: number;
    resetValue?: number;
}

export class PeripheralClusterNode extends PeripheralBaseNode {
    private children: PeripheralRegisterNode[];
    public readonly name: string;
    public readonly description?: string;
    public readonly offset: number;
    public readonly size: number;
    public readonly resetValue: number;
    public readonly accessType: AccessType;

    constructor(public parent: PeripheralNode, options: ClusterOptions) {
        super(parent);
        this.name = options.name;
        this.description = options.description;
        this.offset = options.addressOffset;
        this.accessType = options.accessType || AccessType.ReadWrite;
        this.size = options.size || parent.size;
        this.resetValue = options.resetValue || parent.resetValue;
        this.children = [];
        this.parent.addChild(this);
    }

    public getTreeItem(): TreeItem | Promise<TreeItem> {
        const label = `${this.name} [${hexFormat(this.offset, 0)}]`;

        const item = new TreeItem(label, this.expanded ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed);
        item.contextValue = 'cluster';
        item.tooltip = this.description;
        
        return item;
    }

    public getChildren(): PeripheralRegisterNode[] {
        return this.children;
    }

    public setChildren(children: PeripheralRegisterNode[]) {
        this.children = children.slice(0, children.length);
        this.children.sort((r1, r2) => r1.offset > r2.offset ? 1 : -1);
    }

    public addChild(child: PeripheralRegisterNode) {
        this.children.push(child);
        this.children.sort((r1, r2) => r1.offset > r2.offset ? 1 : -1);
    }

    public getBytes(offset: number, size: number): Uint8Array {
        return this.parent.getBytes(this.offset + offset, size);
    }

    public getAddress(offset: number) {
        return this.parent.getAddress(this.offset + offset);
    }

    public getOffset(offset: number) {
        return this.parent.getOffset(this.offset + offset);
    }
    
    public getFormat(): NumberFormat {
        if (this.format !== NumberFormat.Auto) { return this.format; }
        else { return this.parent.getFormat(); }
    }

    public updateData(): Thenable<any> {
        return new Promise((resolve, reject) => {
            const promises = this.children.map((r) => r.updateData());
            Promise.all(promises).then((updated) => {
                resolve(true);
            }).catch((e) => {
                reject('Failed');
            });
        });
    }

    public saveState(path: string): NodeSetting[] {
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
        else {
            const child = this.children.find((c) => c.name === path[0]);
            if (child) { return child.findByPath(path.slice(1)); }
            else { return null; }
        }
    }

    public markAddresses(addrs: AddressRangesInUse): void {
        this.children.map((r) => { r.markAddresses(addrs); });
    }

    public getPeripheral(): PeripheralBaseNode {
        return this.parent.getPeripheral();
    }

    public getCopyValue(): string {
        throw new Error('Method not implemented.');
    }

    public performUpdate(): Thenable<any> {
        throw new Error('Method not implemented.');
    }
}
