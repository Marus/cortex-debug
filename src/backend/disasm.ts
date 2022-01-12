import { Source, Variable } from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { hexFormat } from '../frontend/utils';
import { MI2 } from './mi2/mi2';
import { MINode } from './mi_parse';
import * as path from 'path';
import { GDBDebugSession } from '../gdb';
import { DisassemblyInstruction, ConfigurationArguments } from '../common';
import { SymbolInformation } from '../symbols';
import { assert, debug } from 'console';
import { start } from 'repl';
import { off } from 'process';

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
            // combined length is greather than the sum of two engths
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

    public tryMerge(other: InstructionRange): boolean {
        if (!this.isOverlappingRange(other.startAddress, other.endAddress)) {
            return false;
        }

        // See if totally overlapping or adjacent
        if ((this.span === other.span) && (this.startAddress === other.startAddress)) {
            return true;                                        // They are idendical
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
                    console.log('Merge @', this.instructions[lx - 1], this.instructions[lx], this.instructions[lx + 1]);
                }
                return true;
            }
        }
        throw new Error('Internal Error: Instructions merge failed');
    }
}

class DisassemblyReturn {
    constructor(public instructions: ProtocolInstruction[], public foundAt: number, makeCopy = true) {
        // We onky want to return a copy so the caches are not corrupted
        this.instructions = makeCopy ? Array.from(this.instructions) : this.instructions;
    }
}

export class GdbDisassembler {
    public static debug: boolean = false;
    private maxInstrSize = 4;       // We only support ARM devices and that too 32-bit. But we got users with RISC, so need to check
    private instrMultiple = 2;      // granularity of instruction sizes, used to increment/decrement startAddr looking for instr. alignment
    private cache: InstructionRange[] = [];
    constructor(public gdbSession: GDBDebugSession) {
    }

    public get miDebugger(): MI2 {
        return this.gdbSession.miDebugger;
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

    protected getMemFlagForAddr(addr: number) {
        for (const region of this.gdbSession.symbolTable.memoryRegions) {
            if (region.inVmaRegion(addr) || region.inLmaRegion(addr)) {
                return '';
            }
        }
        return '?? ';
    }

    private parseDisassembleResults(result: MINode, validationAddr: number, entireRangeGood: boolean): DisassemblyReturn {
        const parseIntruction = (miInstr: string, src?: Source, line?: number) => {
            const address = MINode.valueOf(miInstr, 'address');
            // const functionName = MINode.valueOf(miInstr, 'func-name');
            const offset = parseInt(MINode.valueOf(miInstr, 'offset'));
            const ins = MINode.valueOf(miInstr, 'inst');
            const opcodes = MINode.valueOf(miInstr, 'opcodes');
            const nAddress = parseInt(address);
            // If entire range is valid, use that info but otherwise check specifically for this address
            const flag = entireRangeGood ? '' : this.getMemFlagForAddr(nAddress);
            const useInstr = ((opcodes as string) || ' ').padEnd(3 * this.maxInstrSize + 4) + flag + ins;
            const instr: ProtocolInstruction = {
                address: `${address} <+${offset}>`,
                pvtAddress: nAddress,
                instruction: useInstr,
                // VSCode doesn't do anything with 'symbol'
                // symbol: functionName ? `<${functionName}+${offset === undefined ? '??' : offset}>` : undefined,
                // The UI is not good when we provide this using `instructionBytes` but we need it
                pvtInstructionBytes: opcodes
            };
            if (src) {
                instr.location = src;
                instr.line = line || 1;
            }
    
            if (validationAddr === nAddress) {
                foundIx = instructions.length;
            }
            instructions.push(instr);
        };
    
        let foundIx = -1;
        const instructions: ProtocolInstruction[] = [];
        const asmInsns = result.result('asm_insns') || [];
        // You can have all non-source instructions, all source instructions or a mix where within
        // the source instructions, you can have instructions wihout source. I have not seen a mix
        // of 'src_and_asm_line' and naked ones as if we did not ask for source info. But, I have
        // seen records of 'src_and_asm_line' with no source info. Understandably, it can happen
        // due to compiler optimizations and us asking for a random range where insructions from
        // different object files are in the same area and compiled differently. None of this documente
        // though. Looked at gdb-soure and actually saw what i documented above.
        for (const srcLineVal of asmInsns) {
            if (srcLineVal[0] !== 'src_and_asm_line') {
                // When there is no source/line information, then  'src_and_asm_line' don't
                // exist and it will look like a request that was made without source information
                // It is not clear that there will be a mix of plan instructions and ones with
                // source info. Not documented. Even the fact that you ask for source info
                // and you get something quite different in schema is not documented
                // parseIntruction(srcLineVal, undefined, undefined);
                parseIntruction(srcLineVal);
            } else {
                const props = srcLineVal[1];
                const file = MINode.valueOf(props, 'file');
                const fsPath = MINode.valueOf(props, 'fullname') || file;
                const line = parseInt(MINode.valueOf(props, 'line') || '1');
                const insns = MINode.valueOf(props, 'line_asm_insn') || [];
                const src = fsPath ? new Source(path.basename(fsPath), fsPath) : undefined;
                for (const miInstr of insns) {
                    parseIntruction(miInstr, src, line);
                }
            }
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
            let iter = 0;
            const doWork = () => {
                const old = this.findInCache(startAddress, endAddress);
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
                const cmd = `data-disassemble -s ${hexFormat(startAddress)} -e ${hexFormat(endAddress)} -- 5`;
                if (GdbDisassembler.debug) {
                    console.log('Actual request: ' + cmd);
                }
                this.miDebugger.sendCommand(cmd).then((result) => {
                    const ret = this.parseDisassembleResults(result, validationAddr, entireRangeGood);
                    const foundIx = ret.foundAt;
                    if (foundIx < 0) {
                        if (GdbDisassembler.debug) {
                            const msg = `Could not disassemble at this address Looking for ${hexFormat(validationAddr)}: ${cmd} `;
                            console.log(msg, ret.instructions);
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
                }, (e) => {
                    reject(e);
                });
            };
            doWork();
        });
    }

    private findInCache(startAddr: number, endAddr: number): InstructionRange {
        for (const old of this.cache) {
            if (old.isInsideRange(startAddr, endAddr)) {
                if (GdbDisassembler.debug) {
                    console.log('Instruction cache hit: ',
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
        launchArgs: ConfigurationArguments,
        response: DebugProtocol.DisassembleResponse,
        args: DebugProtocol.DisassembleArguments,
        request?: DebugProtocol.Request): void
    {
        if (launchArgs.showDevDebugOutput) {
            GdbDisassembler.debug = true;       // Can't turn it off, once enabled. Intentional
            this.gdbSession.handleMsg('log', JSON.stringify(request));
        }
        if (GdbDisassembler.debug) {
            console.log('disassembleRequest: ', args);
        }
        const str = args.memoryReference.split(' ')[0];
        const baseAddress = parseInt(str);
        const offset = args.offset || 0;
        const instrOffset = args.instructionOffset || 0;

        // What VSCode gives us can be a very random address, instrOffset can be a negative number
        // start address can be in the middle of an instruction. Glad we are not doing x86 instrs.
        let startAddr = Math.max(0, baseAddress + offset + (instrOffset * this.maxInstrSize));
        while ((startAddr % 8) !== 0) {     // Alight to 8 bytes. May only need 4 bytes for most processors we deal with
            startAddr--;
        }
        const endAddr = startAddr + args.instructionCount * this.maxInstrSize;
        const trueStart = Math.max(0, Math.min(baseAddress - this.maxInstrSize, startAddr));
        const trueEnd = Math.max(baseAddress + this.maxInstrSize, endAddr);
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
                    console.log(`Found ${instrs.length}. baseInstrIndex = ${foundIx}.`);
                    console.log(instrs[foundIx]);
                    console.log(instrs.map((x) => x.address));
                }
                // Spec says must have exactly `count` instructions. Kinda harsh but...gotta do it
                // These are corner cases that are hard to test. This would happen if we are falling
                // of an edge of a memory and VSCode is making requests we can't exactly honor. But,
                // if we have a partial match, do the best we can by padding
                let tmp = instrs.length > 0 ? instrs[0].pvtAddress : baseAddress;
                let nPad = (-instrOffset) - foundIx;
                const junk: ProtocolInstruction[] = [];
                for (; nPad > 0; nPad--) {          // Pad at the beginning
                    tmp -= this.instrMultiple;      // Yes, this can go negative
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
                    tmp += this.instrMultiple;
                    instrs.push(dummyInstr(tmp));
                }
                if (instrs.length > args.instructionCount) {    // Tail heavy
                    instrs.splice(args.instructionCount);
                }

                if (GdbDisassembler.debug) {
                    console.log(`Returning ${instrs.length} instructions of ${ret.instructions.length} queried. baseInstrIndex = ${foundIx}.`);
                    console.log(instrs.map((x) => x.address));
                    if ((foundIx >= 0) && (foundIx < instrs.length)) {
                        console.log(instrs[foundIx]);
                    } else if ((foundIx !== instrOffset) && (foundIx !== (instrs.length + instrOffset))) {
                        console.error(`This may be a problem. Referenced index should be exactly ${instrOffset} off`);
                    }
                }
                this.cleaupInstructions(instrs);
                assert(instrs.length === args.instructionCount, `Instruction count did not match. Please reports this problem ${JSON.stringify(request)}`);
                response.body = {
                    instructions: instrs
                };
                this.gdbSession.sendResponse(response);
            }
            catch (e) {
                sendError(e, request);
            }
        }, (e) => {
            sendError(e, request);
        });

        function sendError(e: any, request: DebugProtocol.Request) {
            this.gdbSession.sendErrorResponsePub(response, 1, `Unable to disassemble: ${e.toString()}: ${JSON.stringify(request)}`);
        }

        function dummyInstr(tmp: number): ProtocolInstruction {
            return {
                address: hexFormat(tmp),
                instruction: 'cortex-debug pad',
                pvtAddress: tmp
            };
        }
    }

    // Remove location information for any consecutive instructions having the
    // same location. This will remove lot of redundant source lines from presentation
    private cleaupInstructions(instrs: ProtocolInstruction[]) {
        if (instrs.length > 0) {
            let prev = instrs[0];
            for (let ix = 1; ix < instrs.length; ix++ ) {
                const instr = instrs[ix];
                if ((instr.line === prev.line) && instr.location && prev.location && (instr.location.path === prev.location.path)) {
                    // Don't modify the original source as they also exist in the cache. produce a copy
                    const copy = Object.assign({}, instr);
                    delete copy.location;
                    delete copy.line;
                    instrs[ix] = copy;
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
                    file: funcInfo.file,
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
                    funcInfo = await this.getDisassemblyForFunction(funcInfo.name, funcInfo.file);
                    response.body = {
                        instructions: funcInfo.instructions,
                        name: funcInfo.name,
                        file: funcInfo.file,
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
