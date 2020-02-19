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
    origScope: SymbolScope;     // This was what was parsed
    scope: SymbolScope;
    file: string;                // The official file name
    fileMaps: string[];          // Set of files this symbol could match
    instructions: DisassemblyInstruction[];
    hidden: boolean;
}
