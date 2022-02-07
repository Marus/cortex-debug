import { MINode } from './mi_parse';
import { DebugProtocol } from '@vscode/debugprotocol';
import { toStringDecHexOctBin } from '../common';

export interface OurSourceBreakpoint extends DebugProtocol.SourceBreakpoint {
    file?: string;
    raw?: string;       // Used for function name as well and old style address breakpoints
    // What we get from gdb below
    address?: string;
    number?: number;
}

export interface OurInstructionBreakpoint extends DebugProtocol.InstructionBreakpoint {
    address: number;
    number: number;
}

export interface OurDataBreakpoint extends DebugProtocol.DataBreakpoint {
    number?: number;
}

export interface Stack {
    level: number;
    address: string;
    function: string;
    fileName: string;
    file: string;
    line: number;
}

export interface Variable {
    name: string;
    valueStr: string;
    type: string;
    raw?: any;
}

export interface IBackend {
    start(cwd: string, executable: string, init: string[]): Thenable<any>;
    connect(target: string[]): Thenable<any>;
    stop();
    detach();
    interrupt(arg: string): Thenable<boolean>;
    continue(threadId: number): Thenable<boolean>;
    next(threadId: number, instruction: boolean): Thenable<boolean>;
    step(threadId: number, instruction: boolean): Thenable<boolean>;
    stepOut(threadId: number): Thenable<boolean>;
    addBreakPoint(breakpoint: OurSourceBreakpoint): Promise<OurSourceBreakpoint>;
    removeBreakpoints(breakpoints: number[]): Promise<boolean>;
    getStack(threadId: number, startLevel: number, maxLevels: number): Thenable<Stack[]>;
    getStackVariables(thread: number, frame: number): Thenable<Variable[]>;
    evalExpression(name: string, threadId: number, frameId: number): Thenable<any>;
    isRunning(): boolean;
    changeVariable(name: string, rawValue: string): Thenable<any>;
    examineMemory(from: number, to: number): Thenable<any>;
}

export class VariableObject {
    public name: string;
    public exp: string;
    public numchild: number;
    public type: string;
    public value: string;
    public threadId: string;
    public frozen: boolean;
    public dynamic: boolean;
    public displayhint: string;
    public hasMore: boolean;
    public id: number;
    public fullExp: string;
    public parent: number;      // Variable Reference
    public children: {[name: string]: string};
    constructor(p: number, node: any) {
        this.parent = p;
        this.name = MINode.valueOf(node, 'name');
        this.exp = MINode.valueOf(node, 'exp');
        this.numchild = parseInt(MINode.valueOf(node, 'numchild'));
        this.type = MINode.valueOf(node, 'type');
        this.value = MINode.valueOf(node, 'value');
        this.threadId = MINode.valueOf(node, 'thread-id');
        this.frozen = !!MINode.valueOf(node, 'frozen');
        this.dynamic = !!MINode.valueOf(node, 'dynamic');
        this.displayhint = MINode.valueOf(node, 'displayhint');
        this.children = {};
        // TODO: use has_more when it's > 0
        this.hasMore = !!MINode.valueOf(node, 'has_more');
    }

    public createToolTip(name: string, value: string): string {
        let ret = this.type;
        if (this.isCompound()) {
            return ret;
        }

        let val = 0;
        if ((/^0[xX][0-9A-Fa-f]+/.test(value)) || /^[-]?[0-9]+/.test(value)) {
            val = parseInt(value.toLowerCase());

            ret += ' ' + name + ';\n' ;
            ret += toStringDecHexOctBin(val);
        }
        return ret;
    }

    public applyChanges(node: MINode) {
        this.value = MINode.valueOf(node, 'value');
        if (!!MINode.valueOf(node, 'type_changed')) {
            this.type = MINode.valueOf(node, 'new_type');
        }
        this.dynamic = !!MINode.valueOf(node, 'dynamic');
        this.displayhint = MINode.valueOf(node, 'displayhint');
        this.hasMore = !!MINode.valueOf(node, 'has_more');
    }

    public isCompound(): boolean {
        return this.numchild > 0 ||
            this.value === '{...}' ||
            (this.dynamic && (this.displayhint === 'array' || this.displayhint === 'map'));
    }

    public toProtocolVariable(): DebugProtocol.Variable {
        const res: DebugProtocol.Variable = {
            name: this.exp,
            evaluateName: this.fullExp || this.exp,
            value: (this.value === void 0) ? '<unknown>' : this.value,
            type: this.type,
            presentationHint: {
                kind: this.displayhint
            },
            variablesReference: this.id
        };

        res.type = this.createToolTip(res.name, res.value);      // This ends up becoming a tool-tip
        return res;
    }
}

// from https://gist.github.com/justmoon/15511f92e5216fa2624b#gistcomment-1928632
export interface MIError extends Error {
    readonly name: string;
    readonly message: string;
    readonly source: string;
}

export interface MIErrorConstructor {
    readonly prototype: MIError;
    new (message: string, source: string): MIError;
}

export const MIError: MIErrorConstructor = class MIError {
    public readonly name: string;
    public readonly message: string;
    public readonly source: string;
    public constructor(message: string, source: string) {
        Object.defineProperty(this, 'name', {
            get: () => (this.constructor as any).name
        });
        Object.defineProperty(this, 'message', {
            get: () => message
        });
        Object.defineProperty(this, 'source', {
            get: () => source
        });
        Error.captureStackTrace(this, this.constructor);
    }

    public toString() {
        return `${this.message} (from ${this.source})`;
    }
} as any;
Object.setPrototypeOf(MIError as any, Object.create(Error.prototype));
MIError.prototype.constructor = MIError;
