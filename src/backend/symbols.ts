import * as childProcess from 'child_process';
import * as os from 'os';
import * as path from 'path';

import { SymbolType, SymbolScope, SymbolInformation } from '../symbols';

const SYMBOL_REGEX = /^([0-9a-f]{8})\s([lg\ !])([w\ ])([C\ ])([W\ ])([I\ ])([dD\ ])([FfO\ ])\s([^\s]+)\s([0-9a-f]+)\s(.*)\r?$/;

const TYPE_MAP: { [id: string]: SymbolType } = {
    'F': SymbolType.Function,
    'f': SymbolType.File,
    'O': SymbolType.Object,
    ' ': SymbolType.Normal
};

const SCOPE_MAP: { [id: string]: SymbolScope } = {
    'l': SymbolScope.Local,
    'g': SymbolScope.Global,
    ' ': SymbolScope.Neither,
    '!': SymbolScope.Both
};

export class SymbolTable {
    private symbols: SymbolInformation[];

    constructor(private toolchainPath: string, private executable: string) {
        this.symbols = [];
    }

    public loadSymbols() {
        try {
            let objdumpExePath = os.platform() !== 'win32' ? 'arm-none-eabi-objdump' : 'arm-none-eabi-objdump.exe';
            if (this.toolchainPath) {
                objdumpExePath = path.normalize(path.join(this.toolchainPath, objdumpExePath));
            }

            const objdump = childProcess.spawnSync(objdumpExePath, ['--syms', this.executable]);
            const output = objdump.stdout.toString();
            const lines = output.split('\n');
            let currentFile: string = null;
            
            for (const line of lines) {
                const match = line.match(SYMBOL_REGEX);
                if (match) {
                    if (match[7] === 'd' && match[8] === 'f') {
                        currentFile = match[11].trim();
                    }
                    const type = TYPE_MAP[match[8]];
                    const scope = SCOPE_MAP[match[2]];
                    let name = match[11].trim();
                    let hidden = false;

                    if (name.startsWith('.hidden')) {
                        name = name.substring(7).trim();
                        hidden = true;
                    }

                    this.symbols.push({
                        address: parseInt(match[1], 16),
                        type: type,
                        scope: scope,
                        section: match[9].trim(),
                        length: parseInt(match[10], 16),
                        name: name,
                        file: scope === SymbolScope.Local ? currentFile : null,
                        instructions: null,
                        hidden: hidden
                    });
                }
            }
        }
        catch (e) { }
    }

    public getFunctionAtAddress(address: number): SymbolInformation {
        const matches = this.symbols.filter((s) => s.type === SymbolType.Function && s.address <= address && (s.address + s.length) > address);
        if (!matches || matches.length === 0) { return undefined; }

        return matches[0];
    }

    public getFunctionSymbols(): SymbolInformation[] {
        return this.symbols.filter((s) => s.type === SymbolType.Function);
    }

    public getGlobalVariables(): SymbolInformation[] {
        const matches = this.symbols.filter((s) => s.type === SymbolType.Object && s.scope === SymbolScope.Global);
        return matches;
    }

    public getStaticVariables(file: string): SymbolInformation[] {
        return this.symbols.filter((s) => s.type === SymbolType.Object && s.scope === SymbolScope.Local && s.file === file);
    }

    public getFunctionByName(name: string, file?: string): SymbolInformation {
        // Try to find static function first
        let matches = this.symbols.filter((s) => s.type === SymbolType.Function && s.scope === SymbolScope.Local && s.name === name && s.file === file);
        if (matches.length !== 0) { return matches[0]; }
        
        // Fall back to global scope
        matches = this.symbols.filter((s) => s.type === SymbolType.Function && s.scope !== SymbolScope.Local && s.name === name);
        return matches.length !== 0 ? matches[0] : null;
    }
}
