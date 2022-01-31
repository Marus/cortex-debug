import * as childProcess from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as tmp from 'tmp';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { IntervalTree, Interval } from 'node-interval-tree';
import JsonStreamStringify from 'json-stream-stringify';
const StreamArray = require('stream-json/streamers/StreamArray');
import * as zlib from 'zlib';
const commandExistsSync = require('command-exists').sync;

import { SymbolType, SymbolScope, SymbolInformation as SymbolInformation } from '../symbols';
import { MINode } from './mi_parse';
import { GDBDebugSession } from '../gdb';

const SYMBOL_REGEX = /^([0-9a-f]{8})\s([lg\ !])([w\ ])([C\ ])([W\ ])([I\ ])([dD\ ])([FfO\ ])\s(.*?)\t([0-9a-f]+)\s(.*)$/mg;
// DW_AT_name && DW_AT_comp_dir may have optional stuff that looks like '(indirect string, offset: 0xf94): '
const COMP_UNIT_REGEX = /\n <0>.*\(DW_TAG_compile_unit\)[\s\S]*?DW_AT_name[\s]*: (\(.*\):\s)?(.*)[\r\n]+([\s\S]*?)\n </mg;
// DW_AT_comp_dir may not exist
const COMP_DIR_REGEX = /DW_AT_comp_dir[\s]*: (\(.*\):\s)?(.*)[\r\n]+/m;
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

export class SymbolTable {
    private allSymbols: SymbolInformation[] = [];
    private fileTable: string[] = [];
    public memoryRegions: MemoryRegion[] = [];

    // The following are caches that are either created on demand or on symbol load. Helps performance
    // on large executables since most of our searches are linear. Or, to avoid a search entirely if possible
    // Case sensitivity for path names is an issue: We follow just what gcc records so inherently case-sensitive
    // or case-preserving. We don't try to re-interpret/massage those path-names. Maybe later.
    //
    // TODO: Support for source-maps for both gdb and for symbol/file lookups
    // TODO: some of the arrays below should be maps. Later.
    private staticsByFile: {[file: string]: SymbolInformation[]} = {};
    private globalVars: SymbolInformation[] = [];
    private globalFuncsMap: {[key: string]: SymbolInformation} = {};    // Key is function name
    private staticVars: SymbolInformation[] = [];
    private staticFuncsMap: {[key: string]: SymbolInformation[]} = {};  // Key is function name
    private fileMap: {[key: string]: string[]} = {};                    // basename of a file to a potential list of aliases we found
    public symbolsAsTree: IntervalTree<SymbolNode> = new IntervalTree<SymbolNode>();
    public symmbolsByAddress: Map<number, SymbolInformation> = new Map<number, SymbolInformation>();

    constructor(
        private gdbSession: GDBDebugSession, toolchainPath: string,
        toolchainPrefix: string, private objdumpPath: string, private executable: string)
    {
        if (!this.objdumpPath) {
            this.objdumpPath = os.platform() !== 'win32' ? `${toolchainPrefix}-objdump` : `${toolchainPrefix}-objdump.exe`;
            if (toolchainPath) {
                this.objdumpPath = path.normalize(path.join(toolchainPath, this.objdumpPath));
            }
        }
    }

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
                        this.addSymbol(sym/* as SymbolInformation*/);
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

    private async loadSymbolFilesFromGdb(): Promise<boolean> {
        try {
            this.gdbSession.miDebugger.startCaptureConsole();
            await this.gdbSession.miDebugger.sendCommand('interpreter-exec console "info sources"');
            const str = this.gdbSession.miDebugger.endCaptureConsole();
            const lines = str.split(/[\r\n]+/g);
            for (let line of lines) {
                line = line.trim();
                if ((line === '') || line.endsWith(':')) {
                    continue;
                }
                const files = line.split(/\,\s/g);
                for (const f of files) {
                    this.addPathVariations(f);
                }
            }
        }
        catch {
            const str = this.gdbSession.miDebugger.endCaptureConsole();
            console.error('gdb info sources failed');
            return false;
        }
    }

    private loadSymbolFilesFromGdbUnused(): Promise<boolean> {
        return new Promise(async (resolve, reject) => {
            if (!this.gdbSession.miDebugger || this.gdbSession.miDebugger.gdbMajorVersion < 9) {
                return resolve(false);
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

            try {
                const miNode: MINode = await this.gdbSession.miDebugger.sendCommand('symbol-info-variables');
                const results = getProp(miNode?.resultRecords?.results, 'symbols');
                const dbgInfo = getProp(results, 'debug');
                if (dbgInfo) {
                    for (const file of dbgInfo) {
                        const fullname = getProp(file, 'fullname');
                        const filename = getProp(file, 'filename');
                        if (fullname) {
                            this.addPathVariations(fullname);
                        }
                        if (filename && (filename !== fullname)) {
                            this.addPathVariations(filename);
                        }
                        // We just need to know what source files are intresting. Don't really care what
                        // symbols are in there. Super expensive way to find out
                        /*
                        const symbols = getProp(file, 'symbols');
                        if (symbols && (symbols.length > 0) && (filename || fullname)) {
                            for (const sym of symbols) {
                                const name = getProp(sym, 'name');
                                const description = getProp(sym, 'description') as string;
                                // maybe a more sophisticated way is needed to determine a static
                                const isStatic = description && description.startsWith('static');
                                if (isStatic) {
                                    if (fullname) {
                                        this.addPathVariations(fullname);
                                        // this.addToFileMap(fullname, name);
                                    }
                                    if (filename && (filename !== fullname)) {
                                        this.addPathVariations(filename);
                                        // this.addToFileMap(filename, name);
                                    }
                                }
                            }
                        }
                        */
                    }
                }
            }
            catch {
                console.error('symbol-info-variables failed');
                return resolve(false);
            }

            // TODO: We should also get status function names but that is very slow. In the future, we will probably
            // be doing full disassembly so ignore it until it is a real issue.
            return resolve(true);
        });
    }

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
     *    inconvenient. We have a couple of do it a couple of different ways and it is still ugly
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

    public loadSymbols(useObjdumpFname: string = ''): Promise<void> {
        return new Promise(async (resolve, reject) => {
            try {
                let nxtLabel;
                console.time('Total');
                console.time(nxtLabel = 'Deserialize symbols');
                const restored = true && await this.deSerializeSymbolTable(this.executable);
                console.timeEnd(nxtLabel);

                if (!restored) {
                    await this.loadFromObjdumpAndNm(useObjdumpFname);
                    this.serializeSymbolTable(this.executable);
                }

                console.time(nxtLabel = 'Finished postprocessing symbols');
                this.categorizeSymbols();
                this.sortGlobalVars();
                console.timeEnd(nxtLabel);
                resolve();
                console.timeEnd('Total');
            }
            catch (e) {
                // We treat this is non-fatal, but why did it fail?
                this.gdbSession.handleMsg('log', `Error: objdump failed! statics/global/functions may not be properly classified: ${e.toString()}`);
                this.gdbSession.handleMsg('log', '    Please report this problem.');
                resolve();
            }
        });
    }

    private addSymbol(sym: SymbolInformation) {
        this.allSymbols.push(sym);
        if (sym.type === SymbolType.Function) {
            const treeSym = new SymbolNode(sym, sym.address, sym.address + Math.max(1, sym.length) - 1);
            this.symbolsAsTree.insert(treeSym);
        }
        this.symmbolsByAddress.set(sym.address, sym);
    }

    private async loadFromObjdumpAndNm(useObjdumpFname: string) {
            try {
            let nxtLabel;
            console.time(nxtLabel = 'Finished running objdump');
            const doUnlink = !useObjdumpFname;
            if (!useObjdumpFname) {
                useObjdumpFname = tmp.tmpNameSync();
                const options = ['--syms', '-C', '-h', '-w'];
                const outFd = fs.openSync(useObjdumpFname, 'w');
                const objdump = childProcess.spawnSync(this.objdumpPath, [...options, this.executable], {
                    stdio: ['ignore', outFd, 'ignore']
                });
                fs.closeSync(outFd);
            }
            console.timeEnd(nxtLabel);
            console.time(nxtLabel = 'Finished parsing objdump');

            const str = this.readNonSymbolStuff(useObjdumpFname, false);
            if (doUnlink) {
                fs.unlinkSync(useObjdumpFname);
            }
            const regex = RegExp(SYMBOL_REGEX);
            let currentFile: string = null;
            let match: RegExpExecArray;
            while ((match = regex.exec(str)) !== null) {
                if (match[7] === 'd' && match[8] === 'f') {
                    if (match[11]) {
                        currentFile = SymbolTable.NormalizePath(match[11].trim());
                    } else {
                        // This can happen with C++. Inline and template methods/variables/functions/etc. are listed with
                        // an empty file association. So, symbols after this line can come from multiple compilation
                        // units with no clear owner. These can be locals, globals or other.
                        currentFile = null;
                    }
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
                    name: name,
                    file: currentFile,
                    type: type,
                    scope: scope,
                    section: match[9].trim(),
                    length: parseInt(match[10], 16),
                    isStatic: (scope === SymbolScope.Local) && currentFile ? true : false,
                    instructions: null,
                    hidden: hidden
                };
                this.addSymbol(sym);
            }
            console.timeEnd(nxtLabel);
            console.time(nxtLabel = 'Finished running and parsing nm');
            if (!this.loadSymFileInfoFromNm()) {
                console.time(nxtLabel = 'Finished parsing gdb');
                await this.loadSymbolFilesFromGdb();
            }
            console.timeEnd(nxtLabel);
        }
        catch (e) {
            throw e;
        }
    }

    public loadSymFileInfoFromNm(): boolean {
        const nmProg = this.objdumpPath.replace(/objdump/i, 'nm');
        if (!commandExistsSync(nmProg)) {
            return false;
        }
        try {
            const options = [
                '--defined-only',
                '-S',   // Want size as well
                '-l',   // File/line info
                '-C',   // Demangle
                '-p'    // do bother sorting
                // Do not use posix format. It is inaccurate
            ];

            const useNmDumpFname = tmp.tmpNameSync();
            const outFd = fs.openSync(useNmDumpFname, 'w');
            const objdump = childProcess.spawnSync(nmProg, [...options, this.executable], {
                stdio: ['ignore', outFd, 'ignore']
            });
            fs.closeSync(outFd);
            const str = fs.readFileSync(useNmDumpFname, {encoding: 'utf8'});

            const lines = str.split('\n');
            const regex = RegExp(/^([0-9a-f]+).*\t(.+):[0-9]+/);     // For now, we only need two things
            for (const line of lines) {
                const match = line.match(regex);
                if (match) {
                    const address = parseInt(match[1], 16);
                    const sym = this.symmbolsByAddress.get(address);
                    if (sym) {
                        const file = SymbolTable.NormalizePath(match[2]);
                        sym.file = file;
                        this.addPathVariations(file);
                    } else {
                        console.error('Unknown symbol. Need to investigate', match[0]);
                    }
                }
            }
            fs.unlinkSync(useNmDumpFname);
            return true;
        }
        catch (e) {
            this.gdbSession.handleMsg('log', `Error: ${nmProg} failed! statics/global/functions may not be properly classified: ${e.toString()}`);
            this.gdbSession.handleMsg('log', '    Please report this problem.');
            return false;
        }
    }

    public updateSymbolSize(node: SymbolNode, len: number) {
        this.symbolsAsTree.remove(node);
        node.symbol.length = len;
        node = new SymbolNode(node.symbol, node.low, node.low + len - 1);
        this.symbolsAsTree.insert(node);
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

    protected readNonSymbolStuff(fileName: string, readFileMaps: boolean): string {
        try {
            const start = Date.now();
            let str = fs.readFileSync(fileName, {encoding: 'utf8'});
            if (readFileMaps) {
                let counter = 0;
                let match: RegExpExecArray;
                let end = str.length;
                const compUnit = RegExp(COMP_UNIT_REGEX);
                while ((match = compUnit.exec(str)) !== null) {
                    if (end > match.index) {
                        end = match.index;
                    }
                    const { curSimpleName, curName } = this.addPathVariations(match[2]);
                    const compDir = RegExp(COMP_DIR_REGEX);
                    match = compDir.exec(match[3]);
                    if (match) {
                        // Do not use path.join below. Match[1] can be in non-native form. Will be fixed by addToFileMap.
                        this.addToFileMap(curSimpleName, match[2] + '/' + curName);
                    }
                    counter++;
                }
                const diff = Date.now() - start;
                if (debugConsoleLogging) {
                    console.log(`Runtime = ${diff}ms`);
                }
                if (end !== str.length) {
                    str = str.substring(0, end);
                }
            }
            const memRegionsEnd = RegExp(/^SYMBOL TABLE:\r?\n/m);
            let match = memRegionsEnd.exec(str);
            if (match) {
                const head = str.substring(0, match.index);
                str = str.substring(match.index);
                // Header:
                // Idx Name          Size      VMA       LMA       File off  Algn
                // Sample entry:
                //   0 .cy_m0p_image 000025d4  10000000  10000000  00010000  2**2
                //                   CONTENTS, ALLOC, LOAD, READONLY, DATA
                //                                    1          2          3          4          5          6         7
                // const entry = RegExp(/^\s*[0-9]+\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)[^\n]+\n\s*([^\r\n]*)\r?\n/gm);
                const entry = RegExp(/^\s*[0-9]+\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\r\n]*)\r?\n/gm);
                while (match = entry.exec(head)) {
                    const attrs = match[7].trim().toLowerCase().split(/[,\s]+/g);
                    if (!attrs.find((s) => s === 'alloc')) {
                        // Technically we only need regions marked for code but lets get all non-debug, non-comment stuff
                        continue;
                    }
                    const region = new MemoryRegion({
                        name: match[1],
                        size: parseInt(match[2], 16),      // size
                        vmaStart: parseInt(match[3], 16),  // vma
                        lmaStart: parseInt(match[4], 16),  // lma
                        attrs: attrs
                    });
                    this.memoryRegions.push(region);
                }
            }

            return str;
        }
        catch (e) {
            return '';
        }
    }

    private addPathVariations(fileString: string) {
        const curName = SymbolTable.NormalizePath(fileString);
        const curSimpleName = path.basename(curName);
        this.addToFileMap(curSimpleName, curSimpleName);
        this.addToFileMap(curSimpleName, curName);
        this.addToFileMap(curName, curSimpleName);
        return { curSimpleName, curName };
    }

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

    protected serializeFileMaps(fileName: string): void {
        try {
            const fName = this.createFileMapCacheFileName(fileName);
            const data = JSON.stringify(this.fileMap, null, ' ');
            fs.writeFileSync(fName, data, {encoding: 'utf8'});
            if (debugConsoleLogging) {
                console.log(`data saved to ${fName}`);
            }
        }
        catch (e) {
            console.log(e.toString());
        }
    }

    protected deSerializeFileMaps(fileName: string): boolean {
        try {
            const fName = this.createFileMapCacheFileName(fileName);
            if (!fs.existsSync(fName)) { return false; }
            const data = fs.readFileSync(fName, {encoding: 'utf8'});
            this.fileMap = JSON.parse(data);
            if (debugConsoleLogging) {
                console.log(`data restored from ${fName}`);
            }
            try {
                // On a mac, try to touch the file to keep it from getting purged
                const tm = Date.now();
                fs.utimesSync(fName, tm, tm);
            }
            catch {}
            return true;
        }
        catch (e) {
            if (debugConsoleLogging) {
                console.log(e.toString());
            }
            return false;
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
