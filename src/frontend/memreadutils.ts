import * as vscode from 'vscode';
import {AddrRange, AddressRangesInUse} from './addrranges';

/** Has utility functions to read memory in chunks into a storage space */
export module MemReadUtils
{
    /**
     * Make one or more memory reads and update values. For the caller, it should look like a single
     * memory read but, if one read fails, all reads are considered as failed.
     * 
     * @param startAddr The start address of the memory region. Everything else is relative to `startAddr`
     * @param specs The chunks of memory to read and and update. Addresses should be >= `startAddr`
	 * Can have gaps, overlaps, etc.
     * @param storeTo This is where read-results go. The first element represents item at `startAddr`
     */
    export function readMemoryChunks(startAddr:number, specs: AddrRange[], storeTo: number[]) : Promise<boolean> {
        const promises = specs.map((r) => {
            return new Promise((resolve,reject) => {
                vscode.debug.activeDebugSession.customRequest('read-memory', { address: r.base, length: r.length }).then((data) => {
                    let dst = r.base - startAddr;
                    const bytes: number[] = data.bytes;
                    for (let i = 0; i < bytes.length; i++) {
                        storeTo[dst++] = bytes[i];        // Yes, map is way too slow, where is my memcpy?
                    }
                    resolve(true);
                }, (e) => {
                    reject(e);
                });
            });
        });
    
        return new Promise((resolve,reject) => {
            Promise.all(promises).then((_x) => {
                resolve(true);
            }).catch((e) => {
                reject(`read-failed ${e}`);
            });
        });        
    }

    export function readMemory(startAddr:number, length:number, storeTo: number[]) : Promise<boolean> {
        const maxChunk = (4 * 1024);
        let ranges = AddressRangesInUse.splitIntoChunks([new AddrRange(startAddr, length)], maxChunk);
        return MemReadUtils.readMemoryChunks(startAddr, ranges, storeTo);
    }
}