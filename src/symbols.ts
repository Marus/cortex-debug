import { DisassemblyInstruction } from './common';

export enum SymbolType {
    Function,
    File,
    Object,
    Normal
}

export enum SymbolScope {
    Local,
    Global,
    Neither,
    Both
}

export interface SymbolInformation {
    address: number;
    length: number;
    name: string;
    section: string;
    type: SymbolType;
    scope: SymbolScope;
    file: string;                // The official file name
    instructions: DisassemblyInstruction[];
    hidden: boolean;
}
