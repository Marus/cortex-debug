// Author to Blame: haneefdm on github
import { FixedBitSet } from './fixedbitset';

/*
 * This file contains classes to create address ranges that are in use in an address space.
 *
 * Implementation: (can change at a later date)
 * We use a bitset implementation to handle spaces in the range of small megabytes. We could
 * also have used an interval tree (Red-Black) but too much work.
 * 
 * With a bit-set, it is a mark and scan method. Each bit in the bitset represents a byte.
 * Mark each byte used which is O(1), then scan the space O(N) where N is [size of address space]
 * but we can skip in 32/8/4 byte chunks of emptyness easily. Hence a bitset.
 * 
 * Use case here is to calculate used addr-ranges. As a user you can decide what 1-bit represents
 */

/** Represents a single address-range */
export class AddrRange {
    constructor(public base: number, public length: number) {
    }

    /** return next address after this addr. range */
    public nxtAddr() {
        return this.base + this.length;
    }

    /** return last address in this range */
    public endAddr() {
        return this.nxtAddr() - 1;
    }
}

/**
 * Register each byte of an address used, this class can calculate a set of
 * address ranges that are in use
 */
export class AddressRangesInUse {
    // We could have derived from bitSet but want to be able to change implementation
    protected bitSet: FixedBitSet;

    constructor(len: number) {
        this.bitSet = new FixedBitSet(len);
    }

    public get length(): number {
        return this.bitSet.numBits;
    }

    public setAddrRange(offset: number, length: number = 4): void {
        if ((offset & 0x3) || (length & 0x3)) {
            // either offset or length not a multiple of 4
            for (let ix = 0; ix < length; ix++) {
                this.bitSet.setBit(ix + offset);
            }
        } else {
            while (length > 0) {
                this.setWord(offset);
                offset += 4;
                length -= 4;
            }
        }
    }

    public setWord(offset: number): void {
        this.bitSet.setNibble(offset);
    }

    /**
     * Calculates a set of consecutive words/bytes that contain valid addresses.
     * 
     * @param base all the return values will have this base address added to them
     * @param aligned if true, we look for 4 byte chunks or it is byte at a time
     * @returns an array of ordered unique address ranges containing valid addresses. Can be an empty array
     */
    public getAddressRangesExact(base: number, aligned: boolean = false): AddrRange[] {
        const retVal: AddrRange[] = [];
        const incr = aligned ? 4 : 1;
        let nxtIx = -1;                 // init to an impossible value
        let range: AddrRange | null = null;

        function gotOne(ix: number): boolean {
            if (nxtIx !== ix) {
                range = new AddrRange(base + ix, incr);
                retVal.push(range);
            } else {                    // continuation of prev. range
                range!.length += incr;  // range! because it can't be null, lint will complain
            }
            nxtIx = ix + incr;          // Got a hit, start watching for adjacents
            return true;
        }

        if (aligned) {
            this.bitSet.findNibbleItor(gotOne);
        } else {
            this.bitSet.findBitItor(gotOne);
        }
        return retVal;
    }

    /**
     * Calculates a set of ranges that contain valid address ranges and eliminates small gaps
     * to combine ranges and a fewer set of ranges
     * 
     * @param base all the return values will havd this base address added to them
     * @param aligned if true, we look for 4 byte chunks or it is byte at a time
     * @param minGap gaps less than specified number of bytes will be merged in multiple of 8
     * @returns an array of ordered compressed address ranges. Can be an empty array
     */
    public getAddressRangesOptimized(base: number, aligned: boolean = false, minGap: number = 8): AddrRange[] {
        const exactVals = this.getAddressRangesExact(base, aligned);
        if ((minGap <= 0) || (exactVals.length < 2)) {
            return exactVals;
        }

        const retVal = [];
        let lastRange: AddrRange | null = null;
        if (aligned) {
            minGap = (minGap + 7) & ~7;     // Make it a multiple of 8 rounding up
        }
        for (const nxtRange of exactVals) {
            if (lastRange && ((lastRange.nxtAddr() + minGap) >= nxtRange.base)) {
                lastRange.length = nxtRange.base - lastRange.base + nxtRange.length;
            } else {
                retVal.push(nxtRange);
                lastRange = nxtRange;
            }
        }

        return retVal;
    }

    public toHexString(): string {
        return this.bitSet.toHexString();
    }

    public clearAll(): void {
        this.bitSet.clearAll();
    }

    /**
     * Returns a set of address ranges that have 0 < length <= maxBytes
     * 
     * @param ranges array of ranges to check an split
     * @param maxBytes limit of each range
     * @param dbgMsg To output debug messages -- name of address space
     * @param dbgLen To output debug messages -- total length of addr space
     */
    public static splitIntoChunks(ranges: AddrRange[], maxBytes: number, dbgMsg: string = '', dbgLen: number = 0): AddrRange[] {
        const newRanges = new Array<AddrRange>();
        for (const r of ranges) {
            while (r.length > maxBytes) {
                newRanges.push(new AddrRange(r.base, maxBytes));
                r.base += maxBytes;
                r.length -= maxBytes;
            }
            if (r.length > 0) {     // Watch out, can be negative
                newRanges.push(r);
            }
        }
        const logIt = false;
        if (newRanges.length && logIt) {
            AddressRangesInUse.consoleLog(dbgMsg, newRanges[0].base, dbgLen, newRanges);
        }
        return newRanges;
    }

    public static consoleLog(prefix: string, base: number, len: number, ranges: AddrRange[]): void {
        console.log(prefix + ` base=0x${base.toString(16)}, totalLen=${len}, #ranges=${ranges.length}\n`);
        let bc = 0;
        for (const range of ranges) {
            bc += range.length;
            console.log(`**** 0x${range.base.toString(16)}, len=${range.length}, cum-bytes=${bc}\n`);
        }
        const diff = len - bc;
        if ((bc > 0) && (len > 0)) {
            const percent = (diff / len) * 100;
            console.log(prefix + ` totalLen=${len}, savings=${diff} ${percent.toFixed(2)}%`);
        }
    }
}
