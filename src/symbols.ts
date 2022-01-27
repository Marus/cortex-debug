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
    section?: string;             // Not available with nm
    type: SymbolType;
    scope: SymbolScope;
    isStatic: boolean;
    file: string;                 // The actual file name parsed (more reliable with nm)
    // line?: number;                // Only available when using nm
    instructions: DisassemblyInstruction[];
    hidden: boolean;
}
