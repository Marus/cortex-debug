import { Command, TreeItem } from 'vscode';
import { NumberFormat, NodeSetting } from '../../../common';
import { AddressRangesInUse } from '../../addrranges';

export abstract class BaseNode {
    public expanded: boolean;
    
    constructor(protected readonly parent?: BaseNode) {
        this.expanded = false;
    }

    public getParent(): BaseNode | undefined {
        return this.parent;
    }

    public abstract getChildren(): BaseNode[] | Promise<BaseNode[]>;
    public abstract getTreeItem(): TreeItem | Promise<TreeItem>;
    
    public getCommand(): Command | undefined {
        return undefined;
    }

    public abstract getCopyValue(): string | undefined;
}

export abstract class PeripheralBaseNode extends BaseNode {
    public format: NumberFormat;
    public readonly name: string;
    
    constructor(protected readonly parent?: PeripheralBaseNode) {
        super(parent);
        this.format = NumberFormat.Auto;
    }

    public selected(): Thenable<boolean> {
        return Promise.resolve(false);
    }
    
    public abstract performUpdate(): Thenable<any>;
    public abstract updateData(): Thenable<boolean>;

    public abstract getChildren(): PeripheralBaseNode[] | Promise<PeripheralBaseNode[]>;
    public abstract getPeripheral(): PeripheralBaseNode;

    public abstract markAddresses(a: AddressRangesInUse): void;

    public abstract saveState(path?: string): NodeSetting[];
    public abstract findByPath(path: string[]): PeripheralBaseNode;
}
