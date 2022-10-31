import { Command, TreeItem, DebugSession } from 'vscode';
import { NumberFormat, NodeSetting } from '../../../common';
import { AddrRange } from '../../addrranges';

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
    public pinned: boolean;
    public readonly name: string;
    public session: DebugSession;
    
    constructor(protected readonly parent?: PeripheralBaseNode) {
        super(parent);
        this.format = NumberFormat.Auto;
        this.pinned = false;
    }

    public selected(): Thenable<boolean> {
        return Promise.resolve(false);
    }
    
    public abstract performUpdate(): Thenable<any>;
    public abstract updateData(): Thenable<boolean>;

    public abstract getChildren(): PeripheralBaseNode[] | Promise<PeripheralBaseNode[]>;
    public abstract getPeripheral(): PeripheralBaseNode;

    public abstract collectRanges(ary: AddrRange[]): void;      // Append addr range(s) to array

    public abstract saveState(path?: string): NodeSetting[];
    public abstract findByPath(path: string[]): PeripheralBaseNode;
}

export abstract class ClusterOrRegisterBaseNode extends PeripheralBaseNode {
    public readonly offset: number;
}
