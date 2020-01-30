import * as childProcess from 'child_process';
import * as os from 'os';
import * as path from 'path';

import { SymbolType, SymbolScope, SymbolInformation } from '../symbols';

const SYMBOL_REGEX = /^([0-9a-f]{8})\s([lg\ !])([w\ ])([C\ ])([W\ ])([I\ ])([dD\ ])([FfO\ ])\s([^\s]+)\s([0-9a-f]+)\s(.*)$/;

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
    private allSymbols: SymbolInformation[] = [];

    // The following are caches that are either created on demand or on symbol load. Helps performance
    // on large executables since most of our searches are linear. Or, to avoid a search entirely if possible
    // Case sinsitivity for path names is an issue: We follow just what gcc records so inherently case-sentive
    // or case-preserving. We don't try to re-interpret/massage those pathnames. Maybe later
    //
    // TODO: Support for source-maps for both gdb and for symbol/file lookups
    private staticsByFile: {[file: string]: SymbolInformation[]} = {};
    private globalVars: SymbolInformation[] = [];
    private globalFuncs: SymbolInformation[] = [];
    private staticVars: SymbolInformation[] = [];
    private staticFuncs: SymbolInformation[] = [];
    private fileMap: {[key: string]: string[]} = {};        // basename of a file to a potential list of aliases we found

    constructor(private toolchainPath: string, private toolchainPrefix: string, private executable: string, private demangle: boolean) {
    }

    public loadSymbols() {
        try {
            let objdumpExePath = os.platform() !== 'win32' ? `${this.toolchainPrefix}-objdump` : `${this.toolchainPrefix}-objdump.exe`;
            if (this.toolchainPath) {
                objdumpExePath = path.normalize(path.join(this.toolchainPath, objdumpExePath));
            }

            const options = ['--syms', '-Wi'];
            if (this.demangle) {
                options.push('-C');
            }
            const objdump = childProcess.spawnSync(objdumpExePath, [...options, this.executable]);
            const output = objdump.stdout.toString();
            const lines = output.split(/[\r\n]+/g);

            this.collectCompilationUnits(lines);

            let currentFile: string = null;
            let currentMapped: string[] = [];

            for (const line of lines) {
                const match = line.match(SYMBOL_REGEX);
                if (match) {
                    if (match[7] === 'd' && match[8] === 'f') {
                        currentFile = match[11].trim();
                        currentMapped = this.addToFileMap(currentFile.split('/').pop(), currentFile);
                    }
                    const type = TYPE_MAP[match[8]];
                    const scope = SCOPE_MAP[match[2]];
                    let name = match[11].trim();
                    let hidden = false;

                    if (name.startsWith('.hidden')) {
                        name = name.substring(7).trim();
                        hidden = true;
                    }

                    const sym: SymbolInformation = {
                        address: parseInt(match[1], 16),
                        type: type,
                        scope: scope,
                        section: match[9].trim(),
                        length: parseInt(match[10], 16),
                        name: name,
                        file: scope === SymbolScope.Local ? currentFile : null,
                        fileMaps: scope === SymbolScope.Local ?  currentMapped : [],
                        instructions: null,
                        hidden: hidden
                    };

                    this.allSymbols.push(sym);
                    if (scope === SymbolScope.Global) {
                        if (type === SymbolType.Object) {
                            this.globalVars.push(sym);
                        } else if (type === SymbolType.Function) {
                            this.globalFuncs.push(sym);
                        }
                    } else if (scope === SymbolScope.Local) {
                        if (type === SymbolType.Object) {
                            this.staticVars.push(sym);
                        } else if (type === SymbolType.Function) {
                            this.staticFuncs.push(sym);
                        }
                    }
                }
            }
        }
        catch (e) { }
    }

    private addToFileMap(key: string, newMap: string): string[] {
        const value = this.fileMap[key] || [];
        if (value.indexOf(newMap) === -1) {
            value.push(newMap);
        }
        this.fileMap[key] = value;
        return value;
    }

    private collectCompilationUnits(lines: string[]): void {
        // Loop over and collect the set of compilation units. This is where true file names are stored
        // Most file names listed by objdump are just the base-name and I am not sure exactly how the base
        // file-name is supposed to map to an actual compilation unit. Esp. when duplicates exist. This only
        // matters for static variables/functions
        let isCompileUnit = false;
        let curName = '';
        let curDir = '';
        let curSimpleName = '';
        const cUnitRexp = /^ <0>.*Abbrev Number.*\(DW_TAG_compile_unit\)/;
        for (const line of lines) {
            if (cUnitRexp.test(line)) {
                isCompileUnit = true;
            }
            else if (isCompileUnit) {
                const match = line.match(/.*DW_AT_([^\s]*).*\)\:\s(.*)/);
                if (match) {
                    if (match[1] === 'name') {
                        curName = match[2];
                        curSimpleName = curName.split('/').pop();
                        this.addToFileMap(curSimpleName, curSimpleName);
                        this.addToFileMap(curSimpleName, curName);
                    }
                    else if (match[1] === 'comp_dir') {
                        curDir = match[2];
                        if (curName !== '') {
                            this.addToFileMap(curSimpleName, curDir + '/' + curName);
                        }
                    }
                } else if (line.startsWith(' <')) {
                    isCompileUnit = false;
                    curSimpleName = curName = curDir = '';
                }
            }
        }
    }

    public getFunctionAtAddress(address: number): SymbolInformation {
        return this.allSymbols.find((s) => s.type === SymbolType.Function && s.address <= address && (s.address + s.length) > address);
    }

    public getFunctionSymbols(): SymbolInformation[] {
        return this.allSymbols.filter((s) => s.type === SymbolType.Function);
    }

    public getGlobalVariables(): SymbolInformation[] {
        return this.globalVars;
    }

    public getStaticVariables(file: string): SymbolInformation[] {
        let ret = this.staticsByFile[file];
        if (!ret) {
            ret = [];
            for (const s of this.staticVars) {
                if (s.fileMaps.indexOf(file) !== -1) {
                    ret.push(s);
                }
            }
            this.staticsByFile[file] = ret;
        }
        return ret;
    }

    public getFunctionByName(name: string, file?: string): SymbolInformation {
        if (file) {      // Try to find static function first
            for (const s of this.staticFuncs) {     // Try exact matches first (maybe not needed)
                if ((s.name === name) && (s.file === file)) {
                    return s;
                }
            }
            for (const s of this.staticFuncs) {     // Try any match
                if ((s.name === name) && (s.fileMaps.indexOf(file) !== -1)) {
                    return s;
                }
            }
        } else {
            // Not sure we should do this part. Only an issue I think if a static function exists but for
            // some reason does not have a file name associated during a stack trace.
            const s = this.staticFuncs.find((s) => s.name === name);
            if (s) { return s; }
        }

        // Fall back to global scope
        return this.globalFuncs.find((s) => s.name === name);
    }
}
