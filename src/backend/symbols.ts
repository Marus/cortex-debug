import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { SpawnLineReader, SymbolFile, validateELFHeader } from '../common';
import { IntervalTree, Interval } from 'node-interval-tree';
import JsonStreamStringify from 'json-stream-stringify';
const StreamArray = require('stream-json/streamers/StreamArray');
import * as zlib from 'zlib';

import { SymbolType, SymbolScope, SymbolInformation as SymbolInformation } from '../symbols';
import { GDBDebugSession } from '../gdb';
import { hexFormat } from '../frontend/utils';
import { MINode } from './mi_parse';

const OBJDUMP_SYMBOL_RE = RegExp(/^([0-9a-f]{8})\s([lg\ !])([w\ ])([C\ ])([W\ ])([I\ ])([dD\ ])([FfO\ ])\s(.*?)\t([0-9a-f]+)\s(.*)$/);
const NM_SYMBOL_RE = RegExp(/^([0-9a-f]+).*\t(.+):[0-9]+/);     // For now, we only need two things
const debugConsoleLogging = false;
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

export class SymbolNode implements Interval {
    constructor(
        public readonly symbol: SymbolInformation,  // Only functions and objects
        public readonly low: number,                // Inclusive near as I can tell
        public readonly high: number                // Inclusive near as I can tell
    ) {}
}

interface IMemoryRegion {
    name: string;
    size: number;
    vmaStart: number;   // Virtual memory address
    vmaStartOrig: number;
    lmaStart: number;   // Load memory address
    attrs: string[];
}
export class MemoryRegion implements IMemoryRegion {
    public vmaEnd: number;      // Inclusive
    public lmaEnd: number;      // Exclusive
    public name: string;
    public size: number;
    public vmaStart: number;
    public lmaStart: number;
    public vmaStartOrig: number;
    public attrs: string[];
    constructor(obj: IMemoryRegion) {
        Object.assign(this, obj);
        this.vmaEnd = this.vmaStart + this.size + 1;
        this.lmaEnd = this.lmaStart + this.size + 1;
    }

    public inVmaRegion(addr: number) {
        return (addr >= this.vmaStart) && (addr < this.vmaEnd);
    }

    public inLmaRegion(addr: number) {
        return (addr >= this.lmaStart) && (addr < this.lmaEnd);
    }

    public inRegion(addr: number) {
        return this.inVmaRegion(addr) || this.inLmaRegion(addr);
    }
}

interface ISymbolTableSerData {
    version: number;
    memoryRegions: MemoryRegion[];
    fileTable: string[];
    symbolKeys: string[];
    allSymbols: any[][];
}

// Replace last part of the path containing a program to another. If search string not found
// or replacement the same as search string, then null is returned
function replaceProgInPath(filepath: string, search: string | RegExp, replace: string): string {
    if (os.platform() === 'win32') {
        filepath = filepath.toLowerCase().replace(/\\/g, '/');
    }
    const ix = filepath.lastIndexOf('/');
    const prefix = (ix >= 0) ? filepath.substring(0, ix + 1) : '' ;
    const suffix = filepath.substring(ix + 1);
    const replaced = suffix.replace(search, replace);
    if (replaced === suffix) {
        return null;
    }
    const ret = prefix + replaced;
    return ret;
}

const trace = true;

interface ExecPromise {
    args: string[];
    promise: Promise<any>;
}

class AddressToSym extends Map<number, SymbolInformation[]> {
    constructor(...args: any[]) {
        super(...args);
    }
}
export class SymbolTable {
    private allSymbols: SymbolInformation[] = [];
    private fileTable: string[] = [];
    public memoryRegions: MemoryRegion[] = [];

    // The following are caches that are either created on demand or on symbol load. Helps performance
    // on large executables since most of our searches are linear. Or, to avoid a search entirely if possible
    // Case sensitivity for path names is an issue: We follow just what gcc records so inherently case-sensitive
    // or case-preserving. We don't try to re-interpret/massage those path-names (but we do Normalize).
    private staticsByFile: {[file: string]: SymbolInformation[]} = {};
    private globalVars: SymbolInformation[] = [];
    private globalFuncsMap: {[key: string]: SymbolInformation} = {};    // Key is function name
    private staticVars: SymbolInformation[] = [];
    private staticFuncsMap: {[key: string]: SymbolInformation[]} = {};  // Key is function name
    private fileMap: {[key: string]: string[]} = {};                    // Potential list of file aliases we found
    public symbolsAsIntervalTree: IntervalTree<SymbolNode> = new IntervalTree<SymbolNode>();
    public symbolsByAddress: AddressToSym = new AddressToSym();
    public symbolsByAddressOrig: AddressToSym = new AddressToSym();
    private varsByFile: {[path: string]: VariablesInFile} = null;
    private nmPromises: ExecPromise[] = [];

    private objdumpPath: string;

    constructor(private gdbSession: GDBDebugSession, private executables: SymbolFile[]) {
        const args = this.gdbSession.args;
        this.objdumpPath = args.objdumpPath;
        if (!this.objdumpPath) {
            this.objdumpPath = os.platform() !== 'win32' ? `${args.toolchainPrefix}-objdump` : `${args.toolchainPrefix}-objdump.exe`;
            if (args.toolchainPath) {
                this.objdumpPath = path.normalize(path.join(args.toolchainPath, this.objdumpPath));
            } else if (args.gdbPath) {
                const tmp = replaceProgInPath(args.gdbPath, /gdb/i, 'objdump');
                this.objdumpPath = tmp || this.objdumpPath;
            }
        }
        if (this.objdumpPath) {
            this.objdumpPath = this.objdumpPath.replace(/\\/g, '/');
        }
    }

    /*
    private createSymtableSerializedFName(exeName: string) {
        return this.createFileMapCacheFileName(exeName, '-syms') + '.gz';
    }

    private static CurrentVersion = 1;
    private serializeSymbolTable(exeName: string) {
        const fMap: {[key: string]: number} = {};
        const keys = this.allSymbols.length > 0 ? Object.keys(this.allSymbols[0]) : [];
        this.fileTable = [];
        const syms = [];
        for (const sym of this.allSymbols) {
            const fName: string = sym.file as string;
            let id: number = fMap[fName];
            if (id === undefined) {
                id = this.fileTable.length;
                this.fileTable.push(fName);
                fMap[fName] = id;
            }
            const tmp = sym.file;
            sym.file = id;
            syms.push(Object.values(sym));
            sym.file = tmp;
        }
        const serObj: ISymbolTableSerData = {
            version: SymbolTable.CurrentVersion,
            memoryRegions: this.memoryRegions,
            fileTable: this.fileTable,
            symbolKeys: keys,
            allSymbols: syms
        };

        const fName = this.createSymtableSerializedFName(exeName);
        const fStream = fs.createWriteStream(fName, { flags: 'w' });
        fStream.on('error', () => {
            console.error('Saving symbol table failed!!!');
        });
        fStream.on('close', () => {
            console.log('Saved symbol table');
        });
        const jsonStream = new JsonStreamStringify([serObj]);
        jsonStream.on('error', () => {
            console.error('Saving symbol table JsonStreamStringify() failed!!!');
        });
        jsonStream
            .pipe(zlib.createGzip())
            .pipe(fStream)
            .on('finish', () => {
                console.log('Pipe ended');
            });
    }

    private deSerializeSymbolTable(exeName: string): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const fName = this.createSymtableSerializedFName(exeName);
            if (!fs.existsSync(fName)) {
                resolve(false);
                return;
            }
            const fStream = fs.createReadStream(fName);
            fStream.on('error', () => {
                resolve(false);
            });

            console.time('abc');
            const jsonStream = StreamArray.withParser();
            jsonStream.on('data', ({key, value}) => {
                console.timeLog('abc', 'Parsed data:');
                fStream.close();
                reconstruct(value);
            });
            fStream
                .pipe(zlib.createGunzip())
                .pipe(jsonStream.input);

            const reconstruct = (data: any) => {
                try {
                    const serObj: ISymbolTableSerData = data as ISymbolTableSerData;
                    if (!serObj || (serObj.version !== SymbolTable.CurrentVersion)) {
                        resolve(false);
                        return;
                    }
                    this.fileMap = {};
                    for (const f of serObj.fileTable) {
                        if (f !== null) {   // Yes, there one null in there
                            this.addPathVariations(f);
                        }
                    }

                    this.allSymbols = [];
                    const keys = serObj.symbolKeys;
                    const n = keys.length;
                    for (const values of serObj.allSymbols) {
                        const sym: any = {};
                        values.forEach((v, i) => sym[keys[i]] = v);
                        sym.file = serObj.fileTable[sym.file as number];
                        this.addSymbol(sym/* as SymbolInformation* /);
                    }
                    this.memoryRegions = [];
                    for (const m of serObj.memoryRegions) {
                        this.memoryRegions.push(new MemoryRegion(m));
                    }
                    console.timeEnd('abc');
                    resolve(true);
                } catch (e) {
                    resolve(false);
                }
            };
        });
    }
    */

    /**
     * Problem statement:
     * We need a read the symbol table for multiple types of information and none of the tools so far
     * give all all we need
     * 
     * 1. List of static variables by file
     * 2. List og globals
     * 3. Functions (global and static) with their addresses and lengths
     * 
     * Things we tried:
     * 1.-Wi option objdump -- produces super large output (100MB+) and take minutes to produce and parse
     * 2. Using gdb: We can get variable/function to file information but no addresses -- not super fast but
     *    inconvenient. We have a couple of different ways and it is still ugly
     * 3. Use nm: This looked super promising until we found out it is super inacurate in telling the type of
     *    symbol. It classifies variables as functions and vice-versa. But for figuring out which variable
     *    belongs to which file that is pretty accurate
     * 4. Use readelf. This went nowhere because you can't get even basic file to symbol mapping from this
     *    and it is not as universal for handling file formats as objdump.
     * 
     * So, we are not using option 3 and fall back to option 2. We will never go back to option 1
     * 
     * Another problem is that we may have to query for symbols using different ways -- partial file names,
     * full path names, etc. So, we keep a map of file to statics.
     * 
     * Other uses for objdump is to get a section headers for memory regions that can be used for disassembly
     * 
     * We avoid splitting the output(s) into lines and then parse line at a time.
     */
    public loadSymbols(): Promise<void> {
        return new Promise(async (resolve) => {
            const reportTimes = false;
            try {
                await this.loadFromObjdumpAndNm();

                this.categorizeSymbols();
                this.sortGlobalVars();
                resolve();
            }
            catch (e) {
                // We treat this is non-fatal, but why did it fail?
                this.gdbSession.handleMsg('log', `Error: objdump failed! statics/globals/functions may not be properly classified: ${e.toString()}\n`);
                this.gdbSession.handleMsg('log', '    ENOENT means program not found. If that is not the issue, please report this problem.\n');
                resolve();
            }
        });
    }

    private rttSymbol;
    public readonly rttSymbolName = '_SEGGER_RTT';
    private addSymbol(sym: SymbolInformation) {
        if ((sym.length === 0) && /^\$[atdbfpm]$/.test(sym.name)) {
            // see https://docs.adacore.com/live/wave/binutils-stable/html/as/as.html#ARM-Mapping-Symbols
            // These are special markers for start of (a)RM, (t)humb, (d)ata sections and other not yet implemented
            return;
        }

        if (!this.rttSymbol && (sym.name === this.rttSymbolName) && (sym.type === SymbolType.Object) && (sym.length > 0)) {
            this.rttSymbol = sym;
        }

        this.allSymbols.push(sym);
        if ((sym.type === SymbolType.Function) || (sym.length > 0)) {
            const treeSym = new SymbolNode(sym, sym.address, sym.address + Math.max(1, sym.length) - 1);
            this.symbolsAsIntervalTree.insert(treeSym);
        }
        this.addSymbolToTrees(sym);
    }

    private addSymbolToTrees(sym: SymbolInformation) {
        const add = (symt: AddressToSym, address: number) => {
            const info = symt.get(address);
            if (info) {
                info.push(sym);
            } else {
                symt.set(address, [sym]);
            }
        };
        add(this.symbolsByAddress, sym.address);
        add(this.symbolsByAddressOrig, sym.addressOrig);
    }

    private objdumpReader: SpawnLineReader;
    private currentObjDumpFile: string = null;

    private readObjdumpHeaderLine(symF: SymbolFile, line: string, err: any): boolean {
        if (!line) {
            return line === '' ? true : false;
        }
        const entry = RegExp(/^\s*[0-9]+\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+(.*)$/);
        // Header:
        // Idx Name          Size      VMA       LMA       File off  Algn
        // Sample entry:
        //   0 .cy_m0p_image 000025d4  10000000  10000000  00010000  2**2 CONTENTS, ALLOC, LOAD, READONLY, DATA
        //                                    1          2          3          4          5          6         7
        // const entry = RegExp(/^\s*[0-9]+\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)[^\n]+\n\s*([^\r\n]*)\r?\n/gm);
        const match = line.match(entry);
        if (match) {
            const attrs = match[7].trim().toLowerCase().split(/[,\s]+/g);
            if (!attrs.find((s) => s === 'alloc')) {
                // Technically we only need regions marked for code but lets get all non-debug, non-comment stuff
                return true;
            }
            const name = match[1];
            const offset = symF.offset || 0;
            const vmaOrig = parseInt(match[3], 16);
            let vmaStart = vmaOrig + offset;
            const section = symF.sectionMap[name];
            if ((name === '.text') && (typeof symF.textaddress === 'number')) {
                vmaStart = symF.textaddress;
                if (!section) {
                    symF.sections.push({
                        address: vmaStart,
                        addressOrig: vmaOrig,
                        name: name
                    });
                    symF.sectionMap[name] = symF.sections[symF.sections.length - 1];
                }
            }
            if (section) {
                section.addressOrig = vmaStart;
                vmaStart = section.address;
            }
            const region = new MemoryRegion({
                name: name,
                size: parseInt(match[2], 16),               // size
                vmaStart: vmaStart,                         // vma
                vmaStartOrig: vmaOrig,
                lmaStart: parseInt(match[4], 16),           // lma
                attrs: attrs
            });
            this.memoryRegions.push(region);
        } else {
            const memRegionsEnd = RegExp(/^SYMBOL TABLE:/);
            if (memRegionsEnd.test(line)) {
                this.objdumpReader.callback = this.readObjdumpSymbolLine.bind(this, symF);
            }
        }
        return true;
    }

    private readObjdumpSymbolLine(symF: SymbolFile, line: string, err: any): boolean {
        if (!line) {
            return line === '' ? true : false;
        }
        const match = line.match(OBJDUMP_SYMBOL_RE);
        if (match) {
            if (match[7] === 'd' && match[8] === 'f') {
                if (match[11]) {
                    this.currentObjDumpFile = SymbolTable.NormalizePath(match[11].trim());
                } else {
                    // This can happen with C++. Inline and template methods/variables/functions/etc. are listed with
                    // an empty file association. So, symbols after this line can come from multiple compilation
                    // units with no clear owner. These can be locals, globals or other.
                    this.currentObjDumpFile = null;
                }
                // We don't really use the symbol except know that the symbol following this belong to this file
                return true;
            } else if ((match[7] === 'd') && (match[8] === ' ')) {
                // This is a pure debug symbol. No use for them
                return true;
            }
            const type = TYPE_MAP[match[8]];
            const scope = SCOPE_MAP[match[2]];
            let name = match[11].trim();
            let hidden = false;

            if (name.startsWith('.hidden')) {
                name = name.substring(7).trim();
                hidden = true;
            }

            const secName = match[9].trim();
            const size = parseInt(match[10], 16);
            if ((secName === '*ABS*') || (secName === '*UND*')) {
                // These are not true symbols, AFAIK and can be safely ignored as there can be hundreds of these
                // junk symbols. We already handled file names above
                return true;
            }

            const offset = symF.offset || 0;
            const addr = parseInt(match[1], 16);
            const section = symF.sectionMap[secName];
            const newaddr = addr + (section ? addr - section.addressOrig : offset);
            const sym: SymbolInformation = {
                addressOrig: addr,
                address: newaddr,
                name: name,
                file: this.currentObjDumpFile,
                type: type,
                scope: scope,
                section: secName,
                length: size,
                isStatic: (scope === SymbolScope.Local) && this.currentObjDumpFile ? true : false,
                instructions: null,
                hidden: hidden
            };
            this.addSymbol(sym);
        }
        return true;
    }

    private loadFromObjdumpAndNm() {
        return new Promise<void>(async (resolves, reject) => {
            let rejected = false;
            const objdumpPromises: ExecPromise[] = [];
            for (const symbolFile of this.executables) {
                const executable = symbolFile.file;
                if (!validateELFHeader(executable)) {
                    this.gdbSession.handleMsg('log',
                        `Warn: ${executable} is not an ELF file format. Some features won't work -- Globals, Locals, disassembly, etc.`);
                    continue;
                }
                try {
                    const spawnOpts = {cwd: this.gdbSession.args.cwd};
                    const objdumpStart = Date.now();
                    const objDumpArgs = [
                        '--syms',   // Of course, we want symbols
                        '-C',       // Demangle
                        '-h',       // Want section headers
                        '-w',       // Don't wrap lines (wide format)
                        executable];
                    this.currentObjDumpFile = null;
                    this.objdumpReader = new SpawnLineReader();
                    this.objdumpReader.on('error', (e) => {
                        rejected = true;
                        reject(e);
                    });
                    this.objdumpReader.on('exit', (code, signal) => {
                        if (code !== 0) {
                            this.gdbSession.handleMsg('log', `'objdump' exited with a nonzero exit status ${code}, ${signal}\n`);
                        }
                    });
                    this.objdumpReader.on('close', (code, signal) => {
                        this.objdumpReader = undefined;
                        this.currentObjDumpFile = null;
                        if (trace || this.gdbSession.args.showDevDebugOutput) {
                            const ms = Date.now() - objdumpStart;
                            this.gdbSession.handleMsg('log', `Finished reading symbols from objdump: Time: ${ms} ms\n`);
                        }
                    });

                    if (trace || this.gdbSession.args.showDevDebugOutput) {
                        this.gdbSession.handleMsg('log', `Reading symbols from ${this.objdumpPath} ${objDumpArgs.join(' ')}\n`);
                    }
                    objdumpPromises.push({
                        args: [this.objdumpPath, ...objDumpArgs],
                        // tslint:disable-next-line: max-line-length
                        promise: this.objdumpReader.startWithProgram(this.objdumpPath, objDumpArgs, spawnOpts, this.readObjdumpHeaderLine.bind(this, symbolFile))
                        // tslint:disable-next-line: max-line-length
                        // promise: this.objdumpReader.startWithFile('/Users/hdm/Downloads/objdump.txt', null, this.readObjdumpHeaderLine.bind(this, symbolFile))
                    });
                    
                    const nmStart = Date.now();
                    const nmProg = replaceProgInPath(this.objdumpPath, /objdump/i, 'nm');
                    const nmArgs = [
                        '--defined-only',
                        '-S',   // Want size as well
                        '-l',   // File/line info
                        '-C',   // Demangle
                        '-p',   // don't bother sorting
                        // Do not use posix format. It is inaccurate
                        executable
                    ];
                    const nmReader = new SpawnLineReader();
                    nmReader.on('error', (e) => {
                        this.gdbSession.handleMsg('log', `Error: ${nmProg} failed! statics/global/functions may not be properly classified: ${e.toString()}\n`);
                        this.gdbSession.handleMsg('log', '    Expecting `nm` next to `objdump`. If that is not the problem please report this.\n');
                        this.nmPromises = [];
                    });
                    nmReader.on('exit', (code, signal) => {
                        if (code !== 0) {
                            this.gdbSession.handleMsg('log', `'nm' exited with a nonzero exit status ${code}, ${signal}\n`);
                        }
                    });
                    nmReader.on('close', () => {
                        if (trace || this.gdbSession.args.showDevDebugOutput) {
                            const ms = Date.now() - nmStart;
                            this.gdbSession.handleMsg('log', `Finished reading symbols from nm: Time: ${ms} ms\n`);
                        }
                    });

                    if (trace || this.gdbSession.args.showDevDebugOutput) {
                        this.gdbSession.handleMsg('log', `Reading symbols from ${nmProg} ${nmArgs.join(' ')}\n`);
                    }
                    this.nmPromises.push({
                        args: [nmProg, ...nmArgs],
                        promise: nmReader.startWithProgram(nmProg, nmArgs, spawnOpts, this.readNmSymbolLine.bind(this, symbolFile))
                    });
                }
                catch (e) {
                    if (!rejected) {
                        rejected = true;
                        reject(e);
                        return;
                    }
                }
            }
            // Yes, we launch both programs and wait for both to finish. Running them back to back
            // takes almost twice as much time. Neither should technically fail.
            await this.waitOnProgs(objdumpPromises);
            // Yes, we don't wait for this. We have enough to move on
            this.finishNmSymbols();
            resolves();
        });
    }

    private async waitOnProgs(promises: ExecPromise[]): Promise<void> {
        for (const p of promises) {
            try {
                await p.promise;
            }
            catch (e) {
                this.gdbSession.handleMsg('log', `Failed running: ${[p.args.join(' ')]}.\n    ${e}`);
            }
        }
        return Promise.resolve();
    }

    private finishNmSymbolsPromise: Promise<void>;
    private finishNmSymbols(): Promise<void> {
        if (!this.nmPromises.length) {
            return Promise.resolve();
        }
        if (this.finishNmSymbolsPromise) {
            return this.finishNmSymbolsPromise;
        }

        this.finishNmSymbolsPromise = new Promise<void>(async (resolve) => {
            try {
                await this.waitOnProgs(this.nmPromises);
                // This part needs to run after both of the above finished
                for (const item of this.addressToFileOrig) {
                    const syms = this.symbolsByAddressOrig.get(item[0]);
                    if (syms) {
                        for (const sym of syms) {
                            sym.file = item[1];
                        }
                    } else {
                        console.error('Unknown symbol address. Need to investigate', hexFormat(item[0]), item);
                    }
                }
            }
            catch (e) {
                // console.log('???');
            }
            finally {
                this.addressToFileOrig.clear();
                this.nmPromises = [];
            }
        });
        return this.finishNmSymbolsPromise;
    }

    private addressToFileOrig: Map<number, string> = new Map<number, string>(); // These are addresses used before re-mapped via symbol-files
    private readNmSymbolLine(symF: SymbolFile, line: string, err: any): boolean {
        const match = line && line.match(NM_SYMBOL_RE);
        if (match) {
            const offset = symF.offset || 0;
            const address = parseInt(match[1], 16) + offset;
            const file = SymbolTable.NormalizePath(match[2]);
            this.addressToFileOrig.set(address, file);
            this.addPathVariations(file);
        }
        return true;
    }

    public updateSymbolSize(node: SymbolNode, len: number) {
        this.symbolsAsIntervalTree.remove(node);
        node.symbol.length = len;
        node = new SymbolNode(node.symbol, node.low, node.low + len - 1);
        this.symbolsAsIntervalTree.insert(node);
    }

    private sortGlobalVars() {
        // We only sort globalVars. Want to preserve statics original order though.
        this.globalVars.sort((a, b) => a.name.localeCompare(b.name, undefined, {sensitivity: 'base'}));

        // double underscore variables are less interesting. Push it down to the bottom
        const doubleUScores: SymbolInformation[] = [];
        while (this.globalVars.length > 0) {
            if (this.globalVars[0].name.startsWith('__')) {
                doubleUScores.push(this.globalVars.shift());
            } else {
                break;
            }
        }
        this.globalVars = this.globalVars.concat(doubleUScores);
    }

    private categorizeSymbols() {
        for (const sym of this.allSymbols) {
            const scope = sym.scope;
            const type = sym.type;
            if (scope !== SymbolScope.Local) {
                if (type === SymbolType.Function) {
                    sym.scope = SymbolScope.Global;
                    this.globalFuncsMap[sym.name] = sym;
                } else if (type === SymbolType.Object) {
                    if (scope === SymbolScope.Global) {
                        this.globalVars.push(sym);
                    } else {
                        // These fail gdb create-vars. So ignoring them. C++ generates them.
                        if (debugConsoleLogging) {
                            console.log('SymbolTable: ignoring non local object: ' + sym.name);
                        }
                    }
                }
            } else if (sym.file) {
                // Yes, you can have statics with no file association in C++. They are neither
                // truly global or local. Some can be considered global but not sure how to filter.
                if (type === SymbolType.Object) {
                    this.staticVars.push(sym);
                } else if (type === SymbolType.Function) {
                    const tmp = this.staticFuncsMap[sym.name];
                    if (tmp) {
                        tmp.push(sym);
                    } else {
                        this.staticFuncsMap[sym.name] = [sym];
                    }
                }
            } else if (type === SymbolType.Function) {
                sym.scope = SymbolScope.Global;
                this.globalFuncsMap[sym.name] = sym;
            } else if (type === SymbolType.Object) {
                // We are currently ignoring Local objects with no file association for objects.
                // Revisit later with care and decide how to classify them
                if (debugConsoleLogging) {
                    console.log('SymbolTable: ignoring local object: ' + sym.name);
                }
            }
        }
    }

    public printSyms(cb?: (str: string) => any) {
        cb = cb || console.log;
        for (const sym of this.allSymbols) {
            let str = sym.name ;
            if (sym.type === SymbolType.Function) {
                str += ' (f)';
            } else if (sym.type === SymbolType.Object) {
                str += ' (o)';
            }
            if (sym.file) {
                str += ' (s)';
            }
            cb(str);
            if (sym.file) {
                const maps = this.fileMap[sym.file];
                if (maps) {
                    for (const f of maps) {
                        cb('\t' + f);
                    }
                } else {
                    cb('\tNoMap for? ' + sym.file);
                }
            }
        }
    }

    public printToFile(fName: string): void {
        try {
            const outFd = fs.openSync(fName, 'w');
            this.printSyms((str) => {
                fs.writeSync(outFd, str);
                fs.writeSync(outFd, '\n');
            });
            fs.closeSync(outFd);
        }
        catch (e) {
            console.log('printSymsToFile: failed' + e);
        }
    }

    private addToFileMap(key: string, newMap: string): string[] {
        newMap = SymbolTable.NormalizePath(newMap);
        const value = this.fileMap[key] || [];
        if (value.indexOf(newMap) === -1) {
            value.push(newMap);
        }
        this.fileMap[key] = value;
        return value;
    }

    private addPathVariations(fileString: string) {
        const curName = SymbolTable.NormalizePath(fileString);
        const curSimpleName = path.basename(curName);
        this.addToFileMap(curSimpleName, curSimpleName);
        this.addToFileMap(curSimpleName, curName);
        this.addToFileMap(curName, curSimpleName);
        return { curSimpleName, curName };
    }

    /*
    protected getFileNameHashed(fileName: string): string {
        try {
            fileName = SymbolTable.NormalizePath(fileName);
            const schemaVer = SymbolTable.CurrentVersion;   // Please increment if schema changes or how objdump is invoked changes
            const maj = this.gdbSession.miDebugger.gdbMajorVersion;
            const min = this.gdbSession.miDebugger.gdbMinorVersion;
            const ver = `v${schemaVer}-gdb.${maj}.${min}`;
            const stats = fs.statSync(fileName);            // Can fail
            const cwd = process.cwd;
            const str = `${fileName}-${stats.mtimeMs}-${ver}-${cwd}`;
            const hasher = crypto.createHash('sha256');
            hasher.update(str);
            const ret = hasher.digest('hex');
            return ret;
        }
        catch (e) {
            throw(e);
        }
    }

    private createFileMapCacheFileName(fileName: string, suffix = '') {
        const hash = this.getFileNameHashed(fileName) + suffix + '.json';
        const fName = path.join(os.tmpdir(), 'Cortex-Debug-' + hash);
        return fName;
    }
*/
    public getFunctionAtAddress(address: number): SymbolInformation {
        const symNodes = this.symbolsAsIntervalTree.search(address, address);
        for (const symNode of symNodes) {
            if (symNode && (symNode.symbol.type === SymbolType.Function)) {
                return symNode.symbol;
            }
        }
        return null;
        // return this.allSymbols.find((s) => s.type === SymbolType.Function && s.address <= address && (s.address + s.length) > address);
    }

    public getFunctionSymbols(): SymbolInformation[] {
        return this.allSymbols.filter((s) => s.type === SymbolType.Function);
    }

    public getGlobalVariables(): SymbolInformation[] {
        return this.globalVars;
    }

    public async getStaticVariableNames(file: string): Promise<string[]> {
        if (this.varsByFile) {
            const nfile = SymbolTable.NormalizePath(file);
            const obj = this.varsByFile[nfile] || this.varsByFile[file];
            if (obj) {
                return obj.staticNames; // Could be empty array
            }
            return null;
        }
        await this.finishNmSymbols();
        const syms = this.getStaticVariables(file);
        const ret = syms.map((s) => s.name);
        return ret;
    }

    public getStaticVariables(file: string): SymbolInformation[] {
        if (!file) {
            return [];
        }
        const nfile = SymbolTable.NormalizePath(file);
        let ret = this.staticsByFile[file];
        if (!ret) {
            ret = [];
            for (const s of this.staticVars) {
                if ((s.file === nfile) || (s.file === file)) {
                    ret.push(s);
                } else {
                    const maps = this.fileMap[s.file];
                    if (maps && (maps.indexOf(nfile) !== -1)) {
                        ret.push(s);
                    } else if (maps && (maps.indexOf(file) !== -1)) {
                        ret.push(s);
                    }
                }
            }
            this.staticsByFile[file] = ret;
        }
        return ret;
    }

    public getFunctionByName(name: string, file?: string): SymbolInformation {
        if (file) {      // Try to find static function first
            const nfile = SymbolTable.NormalizePath(file);
            const syms = this.staticFuncsMap[name];
            if (syms) {
                for (const s of syms) {                 // Try exact matches first (maybe not needed)
                    if ((s.file === file) || (s.file === nfile)) { return s; }
                }
                for (const s of syms) {                 // Try any match
                    const maps = this.fileMap[s.file];  // Bunch of files/aliases that may have the same symbol name
                    if (maps && (maps.indexOf(nfile) !== -1)) {
                        return s;
                    } else if (maps && (maps.indexOf(file) !== -1)) {
                        return s;
                    }
                }
            }
        }

        // Fall back to global scope
        const ret = this.globalFuncsMap[name];
        return ret;
    }

    public getGlobalOrStaticVarByName(name: string, file?: string): SymbolInformation {
        if (!file && this.rttSymbol && (name === this.rttSymbolName) ) {
            return this.rttSymbol;
        }

        if (file) {      // If a file is given only search for static variables by file
            const nfile = SymbolTable.NormalizePath(file);
            for (const s of this.staticVars) {
                if ((s.name === name) && ((s.file === file) || (s.file === nfile))) {
                    return s;
                }
            }
            return null;
        }

        // Try globals first and then statics
        for (const s of this.globalVars.concat(this.staticVars)) {
            if (s.name === name) {
                return s;
            }
        }

        return null;
    }

    public loadSymbolsFromGdb(waitOn: Promise<void>): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            waitOn.then(async () => {
                if (true) {
                    // gdb is un-reliable for getting symbol information. Most of the time it works but we have
                    // reports of it taking 30+ seconds to dump symbols from small executable (C++) and we have
                    // also seen it run out of memory and crash on a well decked out Mac. Also seen asserts.
                    resolve(true);
                    return;
                }
            }, (e) => {
                reject(e);
            });
        });
    }
    
    public static NormalizePath(pathName: string): string {
        if (!pathName) { return pathName; }
        if (os.platform() === 'win32') {
            // Do this so path.normalize works properly
            pathName = pathName.replace(/\//g, '\\');
        } else {
            pathName = pathName.replace(/\\/g, '/');
        }
        pathName = path.normalize(pathName);
        if (os.platform() === 'win32') {
            pathName = pathName.toLowerCase();
        }
        return pathName;
    }
}

function getProp(ary: any, name: string): any {
    if (ary) {
        for (const item of ary) {
            if (item[0] === name) {
                return item[1];
            }
        }
    }
    return undefined;
}
interface SymInfoFromGdb {
    name: string;
    line: number;
}
class VariablesInFile {
    public statics: SymInfoFromGdb[] = [];
    public globals: SymInfoFromGdb[] = [];
    public staticNames: string[] = [];
    constructor(public filename: string) {}
    public add(item: MINode) {
        const isStatic = (getProp(item, 'description') || '').startsWith('static');
        const tmp: SymInfoFromGdb = {
            name: getProp(item, 'name'),
            line: parseInt(getProp(item, 'line') || '1')
        };
        if (isStatic) {
            this.statics.push(tmp);
            this.staticNames.push(tmp.name);
        } else {
            this.globals.push(tmp);
        }
    }
}
