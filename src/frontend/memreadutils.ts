import * as vscode from 'vscode';
import { AddrRange, AddressRangesInUse } from './addrranges';

/** Has utility functions to read memory in chunks into a storage space */
export class MemReadUtils {
    /**
     * Make one or more memory reads and update values. For the caller, it should look like a single
     * memory read but, if one read fails, all reads are considered as failed.
     * 
     * @param startAddr The start address of the memory region. Everything else is relative to `startAddr`
     * @param specs The chunks of memory to read and and update. Addresses should be >= `startAddr`, Can have gaps, overlaps, etc.
     * @param storeTo This is where read-results go. The first element represents item at `startAddr`
     */
    public static readMemoryChunks(startAddr: number, specs: AddrRange[], storeTo: number[]): Promise<boolean> {
        const promises = specs.map((r) => {
            return new Promise((resolve, reject) => {
                const addr = '0x' + r.base.toString(16);
                vscode.debug.activeDebugSession.customRequest('read-memory', { address: addr, length: r.length }).then((data) => {
                    let dst = r.base - startAddr;
                    const bytes: number[] = data.bytes;
                    for (const byte of bytes) {
                        storeTo[dst++] = byte;
                    }
                    resolve(true);
                }, (e) => {
                    reject(e);
                });
            });
        });

        return new Promise((resolve, reject) => {
            Promise.all(promises).then((_) => {
                resolve(true);
            }).catch((e) => {
                reject(e);
            });
        });
    }

    public static readMemory(startAddr: number, length: number, storeTo: number[]): Promise<boolean> {
        const maxChunk = (4 * 1024);
        const ranges = AddressRangesInUse.splitIntoChunks([new AddrRange(startAddr, length)], maxChunk);
        return MemReadUtils.readMemoryChunks(startAddr, ranges, storeTo);
    }
}
