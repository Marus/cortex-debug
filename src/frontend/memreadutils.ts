import { rawListeners } from 'process';
import * as vscode from 'vscode';
import { AddrRange, AddressRangesUtils } from './addrranges';

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
    public static readMemoryChunks(
        session: vscode.DebugSession, startAddr: number, specs: AddrRange[], storeTo: number[]): Promise<boolean> {
        const promises = specs.map((r) => {
            return new Promise((resolve, reject) => {
                const addr = '0x' + r.base.toString(16);
                session.customRequest('read-memory', { address: addr, length: r.length }).then((data) => {
                    let dst = r.base - startAddr;
                    const bytes: number[] = data.bytes;
                    for (const byte of bytes) {
                        storeTo[dst++] = byte;
                    }
                    resolve(true);
                }, (e) => {
                    let dst = r.base - startAddr;
                    // tslint:disable-next-line: prefer-for-of
                    for (let ix = 0; ix < r.length; ix++) {
                        storeTo[dst++] = 0xff;
                    }
                    reject(e);
                });
            });
        });

        return new Promise(async (resolve, reject) => {
            const results = await Promise.all(promises.map((p) => p.catch((e) => e)));
            const errs: string[] = [];
            results.map((e) => {
                if (e instanceof Error) {
                    errs.push(e.message);
                }
            });
            if (errs.length !== 0) {
                reject(new Error(errs.join('\n')));
            } else {
                resolve(true);
            }
        });
    }

    public static readMemory(
        session: vscode.DebugSession, startAddr: number, length: number, storeTo: number[]): Promise<boolean> {
        const maxChunk = (4 * 1024);
        const ranges = AddressRangesUtils.splitIntoChunks([new AddrRange(startAddr, length)], maxChunk);
        return MemReadUtils.readMemoryChunks(session, startAddr, ranges, storeTo);
    }
}
