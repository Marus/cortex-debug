import { Source } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { hexFormat } from '../frontend/utils';
import { MI2 } from './mi2/mi2';
import { MINode } from './mi_parse';
import * as path from 'path';
import { GDBDebugSession } from '../gdb';

class InstructionRange {
    protected instructions: DebugProtocol.DisassembledInstruction[];
}

export class GdbDisassembler {
    constructor(public gdbSession: GDBDebugSession) {
    }

    public get miDebugger(): MI2 {
        return this.gdbSession.miDebugger;
    }
    
    protected async getProtocolDisassembly(
        startAddress: number, endAddress: number): Promise<DebugProtocol.DisassembledInstruction[]> {
        const instructions: DebugProtocol.DisassembledInstruction[] = [];

        try {
            const cmd = `data-disassemble -s ${hexFormat(startAddress, 8)} -e ${hexFormat(endAddress, 8)} -- 5`;
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

                    const instr: DebugProtocol.DisassembledInstruction = {
                        address: address,
                        instruction: ins,
                        // VSCode doesn't do anything with 'symbol'
                        symbol: functionName ? `<${functionName}+${offset === undefined ? '??' : offset}>` : undefined,
                        instructionBytes: opcodes,
                        location: src,
                        line: line
                    };
                    instructions.push(instr);
                }
            }
        }
        catch (e) {
            throw e;
        }
        return instructions;
    }

    public async disassembleRequest(
        response: DebugProtocol.DisassembleResponse,
        args: DebugProtocol.DisassembleArguments,
        request?: DebugProtocol.Request): Promise<void> {
        const baseAddress = parseInt(args.memoryReference);
        const offset = args.offset || 0;
        const instrOffset = args.instructionOffset || 0;
        console.log('disassembleRequest:');
        console.log(args);

        try {
            // What VSCode gives us can be a very random address, offset is usually a negative number
            // start address can be in the middle of an instruction. Glad we are not doing x86 instrs.
            // Here, all instrs are 2 or 4 byte aligned. Assume 4 bytes per instr. even though quite
            // a few uses 2 instructions
            let startAddr = Math.max(0, baseAddress + offset + (instrOffset * 4));
            while ((startAddr % 4) !== 0) {
                startAddr--;
            }
            const endAddr = startAddr + args.instructionCount * 4;
            const trueStart = Math.min(baseAddress, startAddr);
            console.log(`disassembleRequest: request adjusted to disassemble start-addr=${hexFormat(trueStart, 8)}, end-addr=${hexFormat(endAddr, 8)}`);

            const startAddrStr = '0x' + baseAddress.toString(16).padStart(8, '0');
            let found = false;
            let instrs: DebugProtocol.DisassembledInstruction[] = [];
            let foundIx = -1;
            for (let iter = 0; !found && (iter < 2); iter++) {
                instrs = await this.getProtocolDisassembly(trueStart, endAddr);
                response.body = {
                    instructions: instrs
                };
                const len = instrs.length;
                foundIx = 0;
                for (; foundIx < len; foundIx++) {
                    if (instrs[foundIx].address === startAddrStr) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    foundIx = -1;
                    startAddr -= 2;
                    if (startAddr < 0) {
                        break;
                    }
                }
            }
            if (found) {
                // Spec says must have exactly `count` instructions. Kinda harsh
                if (instrs.length < args.instructionCount) {
                    this.gdbSession.handleMsg('log', `Needed to read ${args.instructionCount} instructions @${hexFormat(startAddr, 8)} but only got ${instrs.length}. Padding rest\n`);
                    this.gdbSession.handleMsg('log', 'Dissassembly Request from VSCode: ' + JSON.stringify(args) + '\n');
                    let tmp = parseInt(instrs[instrs.length - 1].address);
                    while (instrs.length < args.instructionCount) {
                        tmp += 4;
                        const dummy: DebugProtocol.DisassembledInstruction = {
                            address: '0x' + hexFormat(tmp, 8),
                            instruction: 'dummy'
                        };
                        instrs.push(dummy);
                    }
                }
                while (instrs.length > args.instructionCount) {
                    // Lop off whichever side has more instructions first. I know don't need a loop but, keeping it simple
                    const numFront = foundIx;
                    const numBack = instrs.length - foundIx - 1;
                    const extra = instrs.length - args.instructionCount;
                    const chop = Math.min(extra, Math.abs(numFront - numBack));
                    if (chop === 0) {
                        instrs = instrs.slice(Math.floor(extra / 2));
                        instrs = instrs.slice(0, instrs.length - (extra - Math.floor(extra / 2)));
                    } else if (numFront < numBack) {
                        instrs = instrs.slice(0, instrs.length - chop);     // Remove from end
                    } else {
                        instrs = instrs.slice(chop);                        // Reove from front
                    }
                }
                response.body.instructions = instrs;
            }
            if (!found) {
                response.body.instructions = [];
                throw new Error('Could not disassemble at this address ' + JSON.stringify(args));
            }
            this.gdbSession.sendResponse(response);
        }
        catch (e) {
            throw(e);
        }
    }
}
