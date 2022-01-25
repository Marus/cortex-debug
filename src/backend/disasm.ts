import { Source } from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { hexFormat } from '../frontend/utils';
import { MI2 } from './mi2/mi2';
import { MINode } from './mi_parse';
import * as path from 'path';
import { GDBDebugSession } from '../gdb';
import { DisassemblyInstruction, ConfigurationArguments, ADAPTER_DEBUG_MODE, HrTimer } from '../common';
import { SymbolInformation } from '../symbols';
import { assert } from 'console';
import { MemoryRegion, SymbolNode } from './symbols';
import { IntervalTree } from 'node-interval-tree';

function ConsoleLog(msg: any, ...params: any[]) {
    if (true) {
        console.log(msg, ...params);
    }
}

/*
** We currently have two disassembler interfaces. One that follows the DAP protocol and VSCode is the client
** for it. The other is the original that works on a function at a time and the client is our own extension.
** The former is new and unproven but has more features and not mature even for VSCode. The latter is more
** mature and limited in functionality
*/
interface  ProtocolInstruction extends DebugProtocol.DisassembledInstruction {
    pvtAddress: number;
    pvtInstructionBytes?: string;
}

interface DisasmRange {
    start: number;
    qStart: number;
    qEnd: number;
    end: number;
    verify: number;
}

interface DisasmRequest {
    response: DebugProtocol.DisassembleResponse;
    args: DebugProtocol.DisassembleArguments;
    request?: DebugProtocol.Request;
    resolve: any;
    reject: any;
}

class InstructionRange {
    // Definition of start and end to be consistent with gdb
    constructor(
        public startAddress: number,        // Inclusive
        public endAddress: number,          // Exclusive
        public instructions: ProtocolInstruction[])
    {
        assert(endAddress > startAddress);  // What does 0-0 mean if end is exclusive? Lenth 1 or 0?
        const last = instructions.length > 0 ? instructions[instructions.length - 1] : null;
        if (last) {
            this.startAddress = Math.min(this.startAddress, this.instructions[0].pvtAddress);
            this.endAddress = Math.max(this.endAddress, last.pvtAddress + last.pvtInstructionBytes?.length || 2);
        }
        this.instructions = Array.from(instructions);   // Make a shallow copy
    }

    public get span(): number {
        return this.endAddress - this.startAddress;
    }

    public isInsideRange(startAddr: number, endAddr: number) {
        if ((startAddr >= this.startAddress) && (endAddr <= this.endAddress)) {
            return true;
        }
        return false;
    }

    public isOverlappingRange(startAddress: number, endAddress: number) {     // Touching is overlapping
        const length = endAddress - startAddress;
        const s = Math.min(this.startAddress, startAddress);
        const e = Math.max(this.endAddress, endAddress);
        const l = e - s;
        if (l > (this.span + length)) {
            // combined length is greather than the sum of two lengths
            return false;
        }
        return true;
    }

    public findInstrIndex(address: number): number {
        const len = this.instructions.length;
        for (let ix = 0; ix < len ; ix++ ) {
            if (this.instructions[ix].pvtAddress === address) {
                return ix;
            }
        }
        return -1;
    }

    public findNearbyLowerInstr(address: number, thresh: number): number {
        const lowerAddress = Math.max(0, address - thresh);
        for (let ix = this.instructions.length - 1; ix > 0 ; ix-- ) {
            const instrAddr = this.instructions[ix].pvtAddress;
            if ((instrAddr >= lowerAddress) && (instrAddr <= address)) {
                return instrAddr;
            }
        }
        return address;
    }

    public tryMerge(other: InstructionRange): boolean {
        if (!this.isOverlappingRange(other.startAddress, other.endAddress)) {
            return false;
        }

        // See if totally overlapping or adjacent
        if ((this.span === other.span) && (this.startAddress === other.startAddress)) {
            return true;                                        // They are identical
        } else if (this.endAddress === other.startAddress) {    // adjacent at end of this
            this.instructions = this.instructions.concat(other.instructions);
            this.endAddress = other.endAddress;
            assert(this.span === (other.span * 2));
            return true;
        } else if (other.endAddress === this.startAddress) {    // adjacent at end of other
            this.instructions = other.instructions.concat(this.instructions);
            this.startAddress = other.startAddress;
            assert(this.span === (other.span * 2));
            return true;
        }

        // They partially overlap
        const left  = (this.startAddress <= other.startAddress) ? this : other;
        const right = (this.startAddress <= other.startAddress) ? other : this;
        const lx = left.instructions.length - 1;
        const leftEnd = left.instructions[lx].pvtAddress;
        const numRight = right.instructions.length;
        for (let ix = 0; ix < numRight; ix++) {
            if (right.instructions[ix].pvtAddress === leftEnd) {
                const rInstrs = right.instructions.slice(ix + 1);
                left.instructions = left.instructions.concat(rInstrs);

                // Almost like a new item but modify in place
                this.instructions = left.instructions;
                this.startAddress = Math.min(this.startAddress, other.startAddress);
                this.endAddress = Math.max(this.endAddress, other.endAddress);
                if (GdbDisassembler.debug) {
                    ConsoleLog('Merge @', this.instructions[lx - 1], this.instructions[lx], this.instructions[lx + 1]);
                }
                return true;
            }
        }
        // start/end addresses are original search ranges. According to that, the ranges overlap. But
        // the actual instructions may not overlap or even abut
        return false;
    }
}

class DisassemblyReturn {
    constructor(public instructions: ProtocolInstruction[], public foundAt: number, makeCopy = true) {
        // We only want to return a copy so the caches are not corrupted
        this.instructions = makeCopy ? Array.from(this.instructions) : this.instructions;
    }
}

export class GdbDisassembler {
    public static debug: boolean = true;    // TODO: Remove this once stable. Merge with showDevDebugOutput
    public doTiming = true;
    private maxInstrSize = 4;       // We only support ARM devices and that too 32-bit. But we got users with RISC, so need to check
    private minInstrSize = 2;
    private instrMultiple = 2;      // granularity of instruction sizes, used to increment/decrement startAddr looking for instr. alignment
    private cache: InstructionRange[] = [];
    public memoryRegions: MemoryRegion[];

    constructor(public gdbSession: GDBDebugSession, public launchArgs: ConfigurationArguments) {
        if (launchArgs.showDevDebugOutput && (launchArgs.showDevDebugOutput !== ADAPTER_DEBUG_MODE.NONE)) {
            GdbDisassembler.debug = true;       // Can't turn it off, once enabled. Intentional
        }
        /*
        const buf = fs.readFileSync('/Users/hdm/tmp/tmp.json');
        const tmp = JSON.parse(buf.toString());
        const result = new MINode(tmp.token, tmp.outOfBandRecord, tmp.resultRecords);
        const vAddr = parseInt('0x00001ec0');

        const ret = this.parseDisassembleResults(result, vAddr, true);
        ConsoleLog(ret);
        */
    }

    public get miDebugger(): MI2 {
        return this.gdbSession.miDebugger;
    }

    private handleMsg(type: string, str: string) {
        this.gdbSession.handleMsg(type, str);
    }

    protected isRangeInValidMem(startAddress: number, endAddress: number): boolean {
        for (const region of this.gdbSession.symbolTable.memoryRegions) {
            if (region.inVmaRegion(startAddress) && region.inVmaRegion(endAddress)) {
                return true;
            } else if (region.inLmaRegion(startAddress) && region.inLmaRegion(endAddress)) {
                return true;
            }
        }
        return false;
    }

    protected isValidAddr(addr: number) {
        for (const region of this.gdbSession.symbolTable.memoryRegions) {
            if (region.inVmaRegion(addr) || region.inLmaRegion(addr)) {
                return true;
            }
        }
        return false;
    }

    protected getMemFlagForAddr(addr: number) {
        return this.isValidAddr(addr) ? '' : '?? ';
    }

    private async getMemoryRegions() {
        if (this.memoryRegions) {
            return;
        }
        try {
            this.memoryRegions = [];
            this.miDebugger.startCaptureConsole();
            await this.miDebugger.sendCommand('interpreter-exec console "info mem"');
            const str = this.miDebugger.endCaptureConsole();
            let match: RegExpExecArray;
            const regex = RegExp(/^[0-9]+\s+([^\s])\s+(0x[0-9a-fA-F]+)\s+(0x[0-9a-fA-F]+)\s+([^\r\n]*)/mgi);
            // Num Enb  Low Addr   High Addr  Attrs 
            // 1   y  	0x10000000 0x10100000 flash blocksize 0x200 nocache
            while (match = regex.exec(str)) {
                const [flag, lowAddr, highAddr, attrsStr] = match.slice(1, 5);
                if (flag === 'y') {
                    const nHighAddr = parseInt(highAddr);
                    const nlowAddr = parseInt(lowAddr);
                    const attrs = attrsStr.split(/\s+/g);
                    const name = `GdbInfo${this.memoryRegions.length}`;
                    this.memoryRegions.push(new MemoryRegion(name, nHighAddr - nlowAddr, nlowAddr, nlowAddr, attrs));
                }
            }
        } catch (e) {
            this.handleMsg('log', `Error: ${e.toString()}`);
        }
        const fromGdb = this.memoryRegions.length;
        // There is a caveat here. Adding regions from executables is not reliable when you have PIC
        // (Position Independent Code) -- so far have not seen such a thing but it is possible
        this.memoryRegions = this.memoryRegions.concat(this.gdbSession.symbolTable.memoryRegions);

        if (this.memoryRegions.length > 0) {
            this.handleMsg('log', 'Note: We detected the following memory regions as valid using gdb "info mem" and "objdump -h"\n');
            this.handleMsg('log', '    This information is used to adjust bounds only when normal disassembly fails.\n');
            const hdrs = ['Size', 'VMA Beg', 'VMA End', 'LMA Beg', 'LMA End'].map((x: string) => x.padStart(10));
            const line = ''.padEnd(80, '=') + '\n';
            this.handleMsg('stdout', line);
            this.handleMsg('stdout', '  Using following memory regions for disassembly\n');
            this.handleMsg('stdout', line);
            this.handleMsg('stdout', hdrs.join('') + '  Attributes\n');
            this.handleMsg('stdout', line);
            let count = 0;
            for (const r of this.memoryRegions) {
                if (count++ === fromGdb) {
                    this.handleMsg('stdout', '  '.padEnd(80, '-') + '\n');
                }
                const vals = [r.size, r.vmaStart, r.vmaEnd - 1, r.lmaStart, r.lmaEnd - 1].map((v) => hexFormat(v, 8, false).padStart(10));
                if (r.vmaStart === r.lmaStart) {
                    vals[3] = vals[4] = '  '.padEnd(10, '-');
                }
                const attrs = ((count > fromGdb) ? `(${r.name}) ` : '') + r.attrs.join(' ');
                this.handleMsg('stdout', vals.join('') + '  ' + attrs + '\n');
            }
            this.handleMsg('stdout', line);
        }
    }

    private clipLow(base: number, addr: number): number {
        for (const region of this.memoryRegions) {
            if (region.inVmaRegion(base)) {
                return region.inVmaRegion(addr) ? addr : region.vmaStart;
            }
            if (region.inLmaRegion(base)) {
                return region.inLmaRegion(addr) ? addr : region.lmaStart;
            }
        }
        return addr;
    }

    private clipHigh(base: number, addr: number): number {
        for (const region of this.memoryRegions) {
            if (region.inVmaRegion(base)) {
                return region.inVmaRegion(addr) ? addr : region.vmaEnd;
            }
            if (region.inLmaRegion(base)) {
                return region.inLmaRegion(addr) ? addr : region.lmaEnd;
            }
        }
        return addr;
    }

    private parseDisassembleResults(result: MINode, validationAddr: number, entireRangeGood: boolean): DisassemblyReturn {
        interface ParseSourceInfo {
            source: Source;
            startLine: number;
            endLine: number;
        }
        const parseIntruction = (miInstr: MINode, srcInfo?: ParseSourceInfo) => {
            const address = MINode.valueOf(miInstr, 'address') as string || '0x????????';
            const fName = MINode.valueOf(miInstr, 'func-name') as string || undefined;
            const offset = parseInt(MINode.valueOf(miInstr, 'offset') || '0');
            const ins = MINode.valueOf(miInstr, 'inst');
            const opcodes = MINode.valueOf(miInstr, 'opcodes') as string || '';
            const nAddress = parseInt(address);
            // If entire range is valid, use that info but otherwise check specifically for this address
            const flag = entireRangeGood ? '' : this.getMemFlagForAddr(nAddress);
            const useInstr = (opcodes.replace(/\s/g, '')).padEnd(2 * this.maxInstrSize + 2) + flag + ins;
            const sym = fName ? '<' + (fName.length > 22 ? '..' + fName.substring(fName.length - 20) : fName) + `+${offset}>` : undefined;
            const instr: ProtocolInstruction = {
                address: address,
                pvtAddress: nAddress,
                instruction: useInstr,
                // VSCode doesn't do anything with 'symbol'
                symbol: fName,
                // symbol: fName ? `<${fName}+${offset === undefined ? '??' : offset}>` : undefined,
                // The UI is not good when we provide this using `instructionBytes` but we need it
                pvtInstructionBytes: opcodes
            };
            if (sym) {
                instr.instructionBytes = sym;
            }
            if (srcInfo) {
                instr.location = srcInfo.source;
                instr.line = srcInfo.startLine;
                instr.endLine = srcInfo.endLine;
            }
    
            if (validationAddr === nAddress) {
                foundIx = instructions.length;
            }
            instructions.push(instr);
        };
    
        let srcCount = 0;
        let asmCount = 0;
        let foundIx = -1;
        const instructions: ProtocolInstruction[] = [];
        const asmInsns = result.result('asm_insns') || [];
        // You can have all non-source instructions, all source instructions or a mix where within
        // the source instructions, you can have instructions without source. I have not seen a mix
        // of 'src_and_asm_line' and naked ones as if we did not ask for source info. But, I have
        // seen records of 'src_and_asm_line' with no source info. Understandably, it can happen
        // due to compiler optimizations and us asking for a random range where insructions from
        // different object files are in the same area and compiled differently. None of this documented
        // though. Looked at gdb-source and actually saw what i documented above.
        let lastLine = 0;
        let lastPath = '';
        for (const srcLineVal of asmInsns) {
            if (srcLineVal[0] !== 'src_and_asm_line') {
                // When there is no source/line information, then  'src_and_asm_line' don't
                // exist and it will look like a request that was made without source information
                // It is not clear that there will be a mix of plan instructions and ones with
                // source info. Not documented. Even the fact that you ask for source info
                // and you get something quite different in schema is not documented
                // parseIntruction(srcLineVal, undefined, undefined);
                parseIntruction(srcLineVal);
                lastPath = ''; lastLine = 0;
                asmCount++;
            } else {
                const props = srcLineVal[1];
                const file = MINode.valueOf(props, 'file');
                const fsPath = MINode.valueOf(props, 'fullname') || file;
                const line = parseInt(MINode.valueOf(props, 'line') || '1');
                const insns = MINode.valueOf(props, 'line_asm_insn') || [];
                const src = fsPath ? new Source(path.basename(fsPath), fsPath) : undefined;
                if (insns.length !== 0) {
                    const args: ParseSourceInfo = {
                        source: src,
                        startLine: line,
                        endLine: line
                    };
                    if (fsPath && (lastPath === fsPath)) {
                        const gap = lastLine && (line > lastLine) ? Math.min(2, line - lastLine) : 0;
                        args.startLine = line - gap;
                        lastLine = line + 1;
                    } else {
                        lastLine = 0;
                        lastPath = fsPath;
                    }
                    for (const miInstr of insns) {
                        if (src) {
                            srcCount++;
                            parseIntruction(miInstr, args);
                        } else {
                            asmCount++;
                            parseIntruction(miInstr);
                        }
                    }
                }
            }
        }
        if (this.doTiming) {
            const total = srcCount + asmCount;
            this.handleMsg('log', `Debug: Found ${total} Instrunctions. ${srcCount} with source code, ${asmCount} without\n`);
        }
        return new DisassemblyReturn(instructions, foundIx, false);
    }

    protected getProtocolDisassembly(
        startAddress: number, endAddress: number,
        validationAddr: number,
        args: DebugProtocol.DisassembleArguments): Promise<DisassemblyReturn>
    {
        // To annotate questionable instructions. Too lazy to do on per instruction basis
        return new Promise<DisassemblyReturn>(async (resolve, reject) => {
            let adjustForMemEror = true;
            let iter = 0;
            const doWork = () => {
                let old = this.findInCache(startAddress, endAddress);
                if (old) {
                    const foundIx = old.findInstrIndex(validationAddr);
                    if (foundIx < 0) {
                        reject(new Error(`Bad instruction cache. Could not find address ${validationAddr} that should have been found`));
                    } else {
                        resolve(new DisassemblyReturn(old.instructions, foundIx));
                    }
                    return;
                }

                const entireRangeGood = this.isRangeInValidMem(startAddress, endAddress);
                old = this.findInCache(startAddress, startAddress);
                if (old) {
                    // See if we have another instruction within 4 instructions of the start address
                    // Gdb can leave a bit of a gap from the last end instruction, so we need to
                    // cover that and the size of an instruction. 4 should cover it.
                    startAddress = old.findNearbyLowerInstr(startAddress, this.maxInstrSize * 4);
                }
                const cmd = `data-disassemble -s ${hexFormat(startAddress)} -e ${hexFormat(endAddress)} -- 5`;
                if (GdbDisassembler.debug) {
                    ConsoleLog('Actual request: ' + cmd);
                }
                if (this.doTiming) {
                    const count = endAddress - startAddress;
                    this.handleMsg('log', `Debug: Gdb command: -${cmd}, ${count} bytes\n`);
                }
                this.miDebugger.sendCommand(cmd).then((result) => {
                    try {
                        const ret = this.parseDisassembleResults(result, validationAddr, entireRangeGood);
                        const foundIx = ret.foundAt;
                        if (foundIx < 0) {
                            if (GdbDisassembler.debug) {
                                const msg = `Could not disassemble at this address Looking for ${hexFormat(validationAddr)}: ${cmd} `;
                                ConsoleLog(msg, ret.instructions);
                            }
                            if ((startAddress >= this.instrMultiple) && (iter === 0)) {
                                iter++;
                                startAddress -= this.instrMultiple;      // Try again with this address
                                doWork();
                            } else {
                                reject(new Error(`Could not disassemble at this address ${hexFormat(validationAddr)} ` + JSON.stringify(args)));
                            }
                        } else {
                            this.addToCache(new InstructionRange(startAddress, endAddress, ret.instructions));
                            resolve(ret);
                        }
                    }
                    catch (e) {
                        reject(e);
                    }
                }, (e) => {
                    this.handleMsg('log', `Error: GDB failed: ${e.toString()}\n`);
                    let doReject = true;
                    if ((iter === 0) && adjustForMemEror && this.isValidAddr(validationAddr)) {
                        adjustForMemEror = false;
                        const oldS = startAddress;
                        const oldE = endAddress;
                        startAddress = this.clipLow(validationAddr, startAddress);
                        endAddress = this.clipHigh(validationAddr, endAddress);
                        if ((oldS !== startAddress) || (oldE !== endAddress)) {
                            doReject = false;
                            const msg = 'Info: Recovering from failed disassembly. Adjusting start,end addresses' +
                                ` from ${hexFormat(oldS)},${hexFormat(oldE)} to ${hexFormat(startAddress)}, ${hexFormat(endAddress)}`;
                            this.handleMsg('log', msg + '\n');
                            if (GdbDisassembler.debug) {
                                ConsoleLog(msg);
                            }
                            doWork();
                        }
                    }
                    if (doReject) {
                        reject(e);
                    }
                });
            };
            doWork();
        });
    }

    private findInCache(startAddr: number, endAddr: number): InstructionRange {
        for (const old of this.cache) {
            if (old.isInsideRange(startAddr, endAddr)) {
                if (GdbDisassembler.debug) {
                    ConsoleLog('Instruction cache hit: ',
                        {startAddr: hexFormat(startAddr), endAddr: hexFormat(endAddr)}, old);
                }
                return old;
            }
        }
        // TODO: We should also look for things that are partially overlapping and adjust for the start/end lookups
        return null;
    }

    private addToCache(arg: InstructionRange) {
        for (let ix = 0; ix < this.cache.length;) {
            const old = this.cache[ix++];
            if (old.tryMerge(arg)) {
                // See if we can merge with next neighbor
                if ((ix < this.cache.length) && old.tryMerge(this.cache[ix])) {
                    this.cache.splice(ix, 1);
                }
                return;
            }
        }
        this.cache.push(arg);
        this.cache.sort((a, b) => a.startAddress - b.startAddress);
    }

    //
    // This is not normal disassembly. We have to conform to what VSCode expects even beyond
    // what the DAP spec says. This is how VSCode is working
    //
    // * They hinge off of the addresses reported during the stack trace that we gave them. Which btw, is a
    //   hex-string (memoryReference)
    // * Initially, they ask for 400 instructions with 200 instructions before and 200 after the frame PC address
    // * While it did (seem to) work if we return more than 400 instructions, that is violating the spec. and may not work
    //   so we have to return precisely the number of instruction demanded (not a request)
    // * Since this is all based on strings (I don't think they interpret the address string). Yet another
    //   reason why we have to be careful
    // * When you scroll just beyond the limits of what is being displayed, they make another request. They use
    //   the address string for the last (or first depending on direction) instruction previously returned by us
    //   as a base address for this request. Then they ask for +/- 50 instructions from that base address NOT
    //   including the base address.  But we use the instruction at the baseAddress to validate what we are returning
    //   since we know that was valid.
    // * All requests are in terms of instruction counts and not addresses (understandably from their POV)
    //
    // Other notes: We know that most ARM instructions are either 2 or 4 bytes. So we translate insruction counts
    // multiple of 4 bytes as worst case. We can easily go beyond the boundaries of the memory and at this point,
    // not sure what to do. Code can be anywhere in non-contiguous regions and we have no idea to tell what is even
    // valid.
    //
    public disassembleProtocolRequest(
        response: DebugProtocol.DisassembleResponse,
        args: DebugProtocol.DisassembleArguments,
        request?: DebugProtocol.Request): Promise<void>
    {
        if (args.memoryReference === undefined) {
            // This is our own request.
            return this.customDisassembleRequest(response, args);
        }

        const seq = request?.seq;
        return new Promise((resolve, reject) => {
            if (GdbDisassembler.debug) {
                this.handleMsg('log', `Debug-${seq}: Enqueuing ${JSON.stringify(request)}\n`);
            }
            const req: DisasmRequest = {
                response: response,
                args: args,
                request: request,
                resolve: resolve,
                reject: reject
            };
            this.disasmRequestQueue.push(req);
            if (!this.disasmBusy) {
                this.runDisasmRequest();
            } else if (this.doTiming) {
                this.handleMsg('log', `Debug-${seq}: ******** Waiting for previous request to complete\n`);
            }
        });
    }

    // VSCode as a client, frequently makes duplicate requests, back to back before results for the first one are ready
    // As a result, older results are not in cache yet, we end up doing work that was not needed. It also happens
    // windows get re-arranged, during reset because we have back to back stops and in other situations. So, we
    // put things in a queue before starting work on the next item. Save quite a bit of work
    private disasmRequestQueue: DisasmRequest[] = [];
    private disasmBusy = false;
    private runDisasmRequest() {
        if (this.disasmRequestQueue.length > 0) {
            this.disasmBusy = true;
            const next = this.disasmRequestQueue.shift();
            this.disassembleProtocolRequest2(next.response, next.args, next.request).then(() => {
                this.disasmBusy = false;
                next.resolve();
                this.runDisasmRequest();
            }, (e) => {
                this.disasmBusy = false;
                next.reject(e);
                this.runDisasmRequest();
            });
        }
    }

    private disassembleProtocolRequest2(
        response: DebugProtocol.DisassembleResponse,
        args: DebugProtocol.DisassembleArguments,
        request?: DebugProtocol.Request): Promise<void>
    {
        return new Promise(async (resolve, reject) => {
            const seq = request?.seq;
            if (GdbDisassembler.debug) {
                this.handleMsg('log', `Debug-${seq}: Dequeuing...\n`);
                ConsoleLog('disassembleRequest: ', args);
            }
            await this.getMemoryRegions();

            const baseAddress = parseInt(args.memoryReference);
            const offset = args.offset || 0;
            const instrOffset = args.instructionOffset || 0;
            const timer = this.doTiming ? new HrTimer() : undefined;

            // What VSCode gives us can be a very random address, instrOffset can be a negative number
            // start address can be in the middle of an instruction. Glad we are not doing x86 instrs.
            let startAddr = Math.max(0, baseAddress + offset + (instrOffset * this.maxInstrSize));
            while ((startAddr % 8) !== 0) {     // Alight to 8 bytes. May only need 4 bytes for most processors we deal with
                startAddr--;
            }
            const endAddr = startAddr + args.instructionCount * this.maxInstrSize;
            const trueStart = Math.max(0, Math.min(baseAddress - this.maxInstrSize, startAddr));
            const trueEnd = Math.max(baseAddress + this.maxInstrSize, endAddr);

            if (true) {
                const ranges = this.findDisasmRanges(trueStart, trueEnd, baseAddress);
            }

            // We are using 'baseAddress' as the validation address. Instead of 'baseAddress + offset'
            // Generally, 'baseAddress' is something we returned previously either through here
            // or as part of a stacktrace so it is likely a valid instruction. But there could be other
            // clients who could give us a random address...but hopefully, it is a function start address
            this.getProtocolDisassembly(trueStart, trueEnd, baseAddress, args).then((ret) => {
                try {
                    assert(offset === 0, 'VSCode using non-zero disassembly offset? Need to determine validation address. Please report this problem');
                    let instrs = ret.instructions;
                    let foundIx = ret.foundAt;
                    if (GdbDisassembler.debug) {
                        ConsoleLog(`Found ${instrs.length}. baseInstrIndex = ${foundIx}.`);
                        ConsoleLog(instrs[foundIx]);
                        // ConsoleLog(instrs.map((x) => x.address));
                    }
                    // Spec says must have exactly `count` instructions. Kinda harsh but...gotta do it
                    // These are corner cases that are hard to test. This would happen if we are falling
                    // of an edge of a memory and VSCode is making requests we can't exactly honor. But,
                    // if we have a partial match, do the best we can by padding
                    let tmp = instrs.length > 0 ? instrs[0].pvtAddress : baseAddress;
                    let nPad = (-instrOffset) - foundIx;
                    const junk: ProtocolInstruction[] = [];
                    for (; nPad > 0; nPad--) {          // Pad at the beginning
                        tmp -= this.minInstrSize;      // Yes, this can go negative
                        junk.push(dummyInstr(tmp));
                    }
                    if (junk.length > 0) {
                        instrs = junk.reverse().concat(instrs);
                        foundIx += junk.length;
                    }

                    const extra = foundIx + instrOffset;
                    if (extra > 0) {            // Front heavy
                        instrs.splice(0, extra);
                        foundIx -= extra;       // Can go negative, thats okay
                    }

                    tmp = instrs[instrs.length - 1].pvtAddress;
                    while (instrs.length < args.instructionCount) {
                        tmp += this.minInstrSize;
                        instrs.push(dummyInstr(tmp));
                    }
                    if (instrs.length > args.instructionCount) {    // Tail heavy
                        instrs.splice(args.instructionCount);
                    }

                    if (GdbDisassembler.debug) {
                        ConsoleLog(`Returning ${instrs.length} instructions of ${ret.instructions.length} queried. baseInstrIndex = ${foundIx}.`);
                        // ConsoleLog(instrs.map((x) => x.address));
                        if ((foundIx >= 0) && (foundIx < instrs.length)) {
                            ConsoleLog(instrs[foundIx]);
                        } else if ((foundIx !== instrOffset) && (foundIx !== (instrs.length + instrOffset))) {
                            console.error(`This may be a problem. Referenced index should be exactly ${instrOffset} off`);
                        }
                    }
                    this.cleaupAndCheckInstructions(instrs);
                    assert(instrs.length === args.instructionCount, `Instruction count did not match. Please reports this problem ${JSON.stringify(request)}`);
                    response.body = {
                        instructions: instrs
                    };
                    if (this.doTiming) {
                        const ms = timer.createPaddedMs(3);
                        this.handleMsg('log', `Debug-${seq}: Timing Request: ${ms} ms\n`);
                    }
                    this.gdbSession.sendResponse(response);
                    resolve();
                }
                catch (e) {
                    const msg = `Unable to disassemble: ${e.toString()}: ${JSON.stringify(request)}`;
                    if (GdbDisassembler.debug) {
                        ConsoleLog(msg + '\n');
                    }
                    this.gdbSession.sendErrorResponsePub(response, 1, msg);
                    resolve();
                }
            }, (e) => {
                const msg = `Unable to disassemble: ${e.toString()}: ${JSON.stringify(request)}`;
                if (GdbDisassembler.debug) {
                    ConsoleLog(msg + '\n');
                }
                this.gdbSession.sendErrorResponsePub(response, 1, msg);
                resolve();
            });
        });

        function dummyInstr(tmp: number): ProtocolInstruction {
            return {
                address: hexFormat(tmp),
                instruction: '<mem-out-of-bounds>',
                pvtAddress: tmp
            };
        }
    }

    private findDisasmRanges(trueStart: number, trueEnd: number, baseAddress: number): DisasmRange[] {
        const printFunc = (item: SymbolNode) => {
            const file = item.func.parsedFile || '<unknown-file>';
            const msg = `(${hexFormat(item.low)}, ${item.low}), (${hexFormat(item.high)}, ${item.high}) ${item.func.name} ${file}`;
            this.handleMsg('stdout', msg + '\n');
            ConsoleLog(msg);
        };

        this.handleMsg('stdout', `${hexFormat(trueStart)}, ${hexFormat(trueEnd)} Search range\n`);
        this.handleMsg('stdout', '-'.repeat(80) + '\n');
        const ret: DisasmRange[] = [];
        const functions = this.gdbSession.symbolTable.functionsAsTree.search(trueStart, trueEnd);
        let current: DisasmRange = {
            start: trueStart,
            qStart: trueStart,
            qEnd: trueEnd,
            end: trueEnd,
            verify: baseAddress
        };
        ret.push(current);
        if (functions.length > 0) {
            const first = functions[0];
            printFunc(first);
            current.qStart = first.low;
            current.qEnd = first.high + 1;
            current.end = first.high + 1;
            current.verify = first.low;
            current.start = Math.min(trueStart, current.qStart)
            for (let ix = 1; ix < functions.length; ix++ ) {
                const item = functions[ix];
                const diff = item.low - current.qEnd;
                if (diff <= this.maxInstrSize) {
                    current.end = current.qEnd = item.high + 1;
                } else {
                    current.end = item.low;
                    current = {
                        start: current.end,
                        qStart: item.low,
                        qEnd: item.high + 1,
                        end: item.high + 1,
                        verify: item.low
                    };
                    ret.push(current);
                }
                current.end = Math.max(current.end, trueEnd);
                printFunc(item);
            }
            current.qEnd = Math.max(current.qEnd, trueEnd);
        }
        console.table(ret);
        return ret;
    }

    // Remove location information for any consecutive instructions having the
    // same location. This will remove lot of redundant source lines from presentation
    private cleaupAndCheckInstructions(instrs: ProtocolInstruction[]) {
        if (instrs.length > 0) {
            let prev = null;
            const maxBytes = this.maxInstrSize * 2;
            const minBytes = this.minInstrSize * 2;
            let count = 0;
            for (let ix = 0; ix < instrs.length; ix++ ) {
                const instr = instrs[ix];
                const bytes = instr.pvtInstructionBytes ? instr.pvtInstructionBytes.replace(/\s/g, '') : '';
                if ((bytes.length < minBytes) || (bytes.length > maxBytes)) {
                    throw new Error('Bad/corrupted disassembly? Please report this problem');
                }
                if (prev && (instr.line === prev.line) && instr.location && prev.location && (instr.location.path === prev.location.path)) {
                    // If you remove too many instructions because the source line is same, then VSCode
                    // does not display any source for any line. Real threshold may be more than 10 but
                    // even visually, doesn't hurt to repeat
                    if (count < 10) {
                        // Don't modify the original source as they also exist in the cache. produce a copy
                        const copy = Object.assign({}, instr);
                        count++;
                        delete copy.location;
                        delete copy.line;
                        instrs[ix] = copy;
                    } else {
                        count = 0;
                    }
                } else {
                    count = 0;
                }
                prev = instr;
            }
        }
    }

    public async customDisassembleRequest(response: DebugProtocol.Response, args: any): Promise<void> {
        if (args.function) {
            try {
                const funcInfo: SymbolInformation = await this.getDisassemblyForFunction(args.function, args.file);
                response.body = {
                    instructions: funcInfo.instructions,
                    name: funcInfo.name,
                    file: funcInfo.parsedFile,
                    address: funcInfo.address,
                    length: funcInfo.length
                };
                this.gdbSession.sendResponse(response);
            }
            catch (e) {
                this.gdbSession.sendErrorResponsePub(response, 1, `Unable to disassemble: ${e.toString()}`);
            }
            return;
        }
        else if (args.startAddress) {
            try {
                let funcInfo = this.gdbSession.symbolTable.getFunctionAtAddress(args.startAddress);
                if (funcInfo) {
                    funcInfo = await this.getDisassemblyForFunction(funcInfo.name, funcInfo.parsedFile);
                    response.body = {
                        instructions: funcInfo.instructions,
                        name: funcInfo.name,
                        file: funcInfo.parsedFile,
                        address: funcInfo.address,
                        length: funcInfo.length
                    };
                    this.gdbSession.sendResponse(response);
                }
                else {
                    // tslint:disable-next-line:max-line-length
                    const instructions: DisassemblyInstruction[] = await this.getDisassemblyForAddresses(args.startAddress, args.length || 256);
                    response.body = { instructions: instructions };
                    this.gdbSession.sendResponse(response);
                }
            }
            catch (e) {
                this.gdbSession.sendErrorResponsePub(response, 1, `Unable to disassemble: ${e.toString()}`);
            }
            return;
        }
        else {
            this.gdbSession.sendErrorResponsePub(response, 1, 'Unable to disassemble; invalid parameters.');
        }
    }

    public async getDisassemblyForFunction(functionName: string, file?: string): Promise<SymbolInformation> {
        const symbol: SymbolInformation = this.gdbSession.symbolTable.getFunctionByName(functionName, file);

        if (!symbol) { throw new Error(`Unable to find function with name ${functionName}.`); }

        if (symbol.instructions) { return symbol; }

        const startAddress = symbol.address;
        const endAddress = symbol.address + symbol.length;

        // tslint:disable-next-line:max-line-length
        const result = await this.miDebugger.sendCommand(`data-disassemble -s ${hexFormat(startAddress)} -e ${hexFormat(endAddress)} -- 2`);
        const rawInstructions = result.result('asm_insns');
        const instructions: DisassemblyInstruction[] = rawInstructions.map((ri) => {
            const address = MINode.valueOf(ri, 'address');
            const functionName = MINode.valueOf(ri, 'func-name');
            const offset = parseInt(MINode.valueOf(ri, 'offset'));
            const inst = MINode.valueOf(ri, 'inst');
            const opcodes = MINode.valueOf(ri, 'opcodes');

            return {
                address: address,
                functionName: functionName,
                offset: offset,
                instruction: inst,
                opcodes: opcodes
            };
        });
        symbol.instructions = instructions;
        return symbol;
    }

    private async getDisassemblyForAddresses(startAddress: number, length: number): Promise<DisassemblyInstruction[]> {
        const endAddress = startAddress + length;

        // tslint:disable-next-line:max-line-length
        const result = await this.miDebugger.sendCommand(`data-disassemble -s ${hexFormat(startAddress)} -e ${hexFormat(endAddress)} -- 2`);
        const rawInstructions = result.result('asm_insns');
        const instructions: DisassemblyInstruction[] = rawInstructions.map((ri) => {
            const address = MINode.valueOf(ri, 'address');
            const functionName = MINode.valueOf(ri, 'func-name');
            const offset = parseInt(MINode.valueOf(ri, 'offset'));
            const inst = MINode.valueOf(ri, 'inst');
            const opcodes = MINode.valueOf(ri, 'opcodes');

            return {
                address: address,
                functionName: functionName,
                offset: offset,
                instruction: inst,
                opcodes: opcodes
            };
        });

        return instructions;
    }
}
