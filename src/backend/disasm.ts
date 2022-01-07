import { Source, Variable } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { hexFormat } from '../frontend/utils';
import { MI2 } from './mi2/mi2';
import { MINode } from './mi_parse';
import * as path from 'path';
import { GDBDebugSession } from '../gdb';
import { start } from 'repl';

interface  ProtocolInstruction extends DebugProtocol.DisassembledInstruction {
    pvtAddress: number;
    pvtInstructionBytes?: string;
}
class InstructionRange {
    public length: number;
    constructor(
        public startAddress: number,
        public endAddress: number,
        public instructions: ProtocolInstruction[])
    {
        this.length = endAddress - startAddress + 1;
    }

    public isInsideRange(startAddr: number, endAddr: number) {
        if ((startAddr >= this.startAddress) && (endAddr <= this.endAddress)) {
            return true;
        }
        return false;
    }

    public isOverlappingRange(startAddr: number, endAddr: number) {
        if ((startAddr >= this.startAddress) && (startAddr <= this.endAddress)) {
            return true;
        }
        if ((endAddr >= this.startAddress) && (endAddr <= this.endAddress)) {
            return true;
        }
        return false;
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
        const s = Math.min(this.startAddress, other.startAddress);
        const e = Math.max(this.endAddress, other.endAddress);
        const l = e - s + 1;
        if (l > (this.length + other.length)) {
            return false;
        }
        // We know they either overlap or adjacent
        if (this.length === other.length) {
            if (this.startAddress === other.startAddress) {
                return true;        // They are idendical
            } else if (this.startAddress < other.startAddress) {
                this.instructions = this.instructions.concat(other.instructions);
            } else {
                this.instructions = other.instructions.concat(this.instructions);
            }
            return true;
        }
        const left  = (this.startAddress < other.startAddress) ? this : other;
        const right = (this.startAddress < other.startAddress) ? other : this;
        const leftEnd = left.instructions[left.instructions.length - 1].pvtAddress;
        for (let ix = 0; ix < right.length; ix++) {
            if (right.instructions[ix].pvtAddress > leftEnd) {
                const rInstrs = right.instructions.slice(ix);
                left.instructions = left.instructions.concat(rInstrs);
                return false;
            }
        }
        throw new Error('Internal Error: Instruction merge failed');
    }
}

class DisassemblyReturn {
    constructor(public instructions: ProtocolInstruction[], public foundAt: number) {
    }
}

export class GdbDisassembler {
    public debug: boolean = true;
    private cache: InstructionRange[] = [];
    constructor(public gdbSession: GDBDebugSession) {
    }

    public get miDebugger(): MI2 {
        return this.gdbSession.miDebugger;
    }
    
    protected async getProtocolDisassembly(
        startAddress: number, endAddress: number,
        validationAddr: number,
        args: DebugProtocol.DisassembleArguments): Promise<DisassemblyReturn> {
        return new Promise<DisassemblyReturn>(async (resolve, reject) => {
            const instructions: ProtocolInstruction[] = [];
            let foundIx = -1;
            try {
                for (let iter = 0; (foundIx < 0) && (iter < 2); iter++ ) {
                    const old = this.findInCache(startAddress, endAddress);
                    if (old) {
                        foundIx = old.findInstrIndex(validationAddr);
                        if (foundIx < 0) {
                            throw new Error(`Bad instruction cache. Could not find address ${validationAddr} that should have been found`);
                        }
                        resolve(new DisassemblyReturn(old.instructions, foundIx));
                        return;
                    }
            
                    const cmd = `data-disassemble -s ${hexFormat(startAddress, 8)} -e ${hexFormat(endAddress, 8)} -- 5`;
                    if (this.debug) {
                        console.log('Adjusted request: ' + cmd);
                    }
                    const result = await this.miDebugger.sendCommand(cmd);
                    const asmInsns = result.result('asm_insns');
                    for (const srcLineVal of asmInsns) {
                        const props = srcLineVal[1];
                        const file = MINode.valueOf(props, 'file');
                        const fsPath = MINode.valueOf(props, 'fullname');
                        const line = MINode.valueOf(props, 'line');
                        const insns = MINode.valueOf(props, 'line_asm_insn');
                        const src = fsPath ? new Source(path.basename(fsPath || file), fsPath || file) : undefined;
                        for (const ri of insns) {
                            const address = MINode.valueOf(ri, 'address');
                            const functionName = MINode.valueOf(ri, 'func-name');
                            const offset = parseInt(MINode.valueOf(ri, 'offset'));
                            const ins = MINode.valueOf(ri, 'inst');
                            const opcodes = MINode.valueOf(ri, 'opcodes');
                            const nAddress = parseInt(address);
                            const instr: ProtocolInstruction = {
                                address: address,
                                pvtAddress: nAddress,
                                instruction: ins,
                                // VSCode doesn't do anything with 'symbol'
                                symbol: functionName ? `<${functionName}+${offset === undefined ? '??' : offset}>` : undefined,
                                // The UI is not good when we provide this using `instructionBytes` but we need it
                                pvtInstructionBytes: opcodes,
                                location: src,
                                line: line
                            };

                            if (validationAddr === nAddress) {
                                foundIx = instructions.length;
                            }
                            instructions.push(instr);
                        }
                    }
                    if (foundIx < 0) {
                        if (startAddress < 2) {
                            break;
                        }
                        startAddress -= 2;      // Try again with this address
                    }
                }
                if (foundIx < 0) {
                    reject('Could not disassemble at this address ' + JSON.stringify(args));
                    return;
                }
            }
            catch (e) {
                reject(e);
                return;
            }
            this.addToCache(new InstructionRange(startAddress, endAddress, instructions));
            resolve(new DisassemblyReturn(instructions, foundIx));
        });
    }

    private findInCache(startAddr: number, endAddr: number): InstructionRange {
        for (const old of this.cache) {
            if (old.isInsideRange(startAddr, endAddr)) {
                return old;
            }
        }
    }

    private addToCache(arg: InstructionRange) {
        for (const old of this.cache) {
            if (old.tryMerge(arg)) {
                return;
            }
        }
        this.cache.push(arg);
    }

    //
    // This is not normal disassembly. We have to conform to what VSCode expects even beyond
    // what the DAP spec says. This is how VSCode is working
    //
    // * They hinge off of the addresses reported during the stack trace. Which btw, is a string (memoryReference)
    // * Initially, they ask for 400 instructions with 200 instructions before and 200 after the frame PC address
    // * While it did work if we return more than 400 instructions, that is violating the spec. and may not work
    //   so we have to return precisely the number of instruction demanded (not a request)
    // * Since this is all based on strings (I don't think they interpret the address string). Yet another
    //   reason why we have to be careful
    // * When you scroll just beyond the limits of what is being displayed, they make another request. They use
    //   the address string for the last (or first) instructions last returned by us (depending on direction)
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
    public async disassembleProtocolRequest(
        response: DebugProtocol.DisassembleResponse,
        args: DebugProtocol.DisassembleArguments,
        request?: DebugProtocol.Request): Promise<void> {
        const baseAddress = parseInt(args.memoryReference);
        const offset = args.offset || 0;
        const instrOffset = args.instructionOffset || 0;
        if (this.debug) {
            console.log('disassembleRequest: ', args);
        }

        try {
            // What VSCode gives us can be a very random address, instrOffset can be a negative number
            // start address can be in the middle of an instruction. Glad we are not doing x86 instrs.
            let startAddr = Math.max(0, baseAddress + offset + (instrOffset * 4));
            while ((startAddr % 4) !== 0) {
                startAddr--;
            }
            const endAddr = startAddr + args.instructionCount * 4;
            const trueStart = Math.max(0, Math.min(baseAddress - 4, startAddr));
            const trueEnd = Math.max(baseAddress + 4, endAddr);
            const ret = await this.getProtocolDisassembly(trueStart, trueEnd, baseAddress, args);
            let instrs = ret.instructions;
            let foundIx = ret.foundAt;
            // Spec says must have exactly `count` instructions. Kinda harsh
            if (instrs.length < args.instructionCount) {
                // These are corner cases that are hard to test. This would happen if we are falling
                // of an edge of a memory and VSCode is making requests we can't exactly honor. But,
                // it looks like we have a partial match, so do the best we can. We create more instructions
                // than we need and let the code after this block clean it up
                if (args.instructionOffset < 0) {
                    const junk: ProtocolInstruction[] = [];
                    let tmp = instrs[0].pvtAddress - 2;
                    for (let cx = -args.instructionOffset; (tmp >= 0) && (cx > 0); cx--) {
                        const dummy: ProtocolInstruction = {
                            address: '0x' + hexFormat(tmp, 8),
                            instruction: 'padding by cortex-debug',
                            pvtAddress: tmp
                        };
                        junk.push(dummy);
                        tmp  -= 2;
                    }
                    instrs = junk.reverse().concat(instrs);
                }
                while (instrs.length < (args.instructionCount + 50)) {
                    const tmp = instrs[instrs.length - 1].pvtAddress + 2;
                    const dummy: ProtocolInstruction = {
                        address: '0x' + hexFormat(tmp, 8),
                        instruction: 'padding by cortex-debug',
                        pvtAddress: tmp
                    };
                    instrs.push(dummy);
                }
            }
            
            // Cleanup all the extra stuff.
            if ((args.instructionOffset < 0) && (foundIx > -args.instructionOffset)) {
                const extra = foundIx + args.instructionOffset;
                instrs = instrs.slice(extra);
                foundIx -= extra;
            } else if ((args.instructionOffset > 0) && (foundIx > args.instructionOffset)) {
                const extra = foundIx + args.instructionOffset;
                instrs = instrs.slice(extra);
                foundIx -= extra;       // Will go negative
            }
            if (instrs.length > args.instructionCount) {
                instrs = instrs.slice(0, args.instructionCount);
            }
            if (this.debug) {
                console.log(`Returning ${instrs.length} instructions of ${ret.instructions.length} queried. baseInstrIndex = ${foundIx}.`);
                if ((foundIx >= 0) && (foundIx < instrs.length)) {
                    console.log(instrs[foundIx]);
                } else if ((foundIx < -1) || (foundIx > instrs.length)) {
                    console.error('This may be a problem. We should be exactly one off based on how VSCode makes requests');
                }
            }
            response.body = {
                instructions: instrs
            };
            this.gdbSession.sendResponse(response);
        }
        catch (e) {
            throw(e);
        }
    }
}
