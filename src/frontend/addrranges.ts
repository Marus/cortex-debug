// Author to Blame: haneefdm on github

import {BitSetConsts, FixedBitSet} from './fixedbitset';

/*
 * This file contains classes to create address ranges that are in use in an address space.
 * We use a bitset implementation to handle spaces in the range of small megabytes. We could
 * also have used an interval tree (Red-Black) but too much work.
 * 
 * With a bit-set, it is a mark and scan method. Each bit in the bitset represents a byte.
 * Mark each byte used which is O(1), then scan the space O(N) where N is [size of address space]
 * but we can skip in 32/8/4 byte chunks of emptyness. Hence a bitset.
 * 
 * Use case here is to calculate used addr-ranges. As a user you can decide what 1-bit represents
 * 
 * LIMITATION: Do not use beyond a 32-bit address span. It is okay for the base address
 * to be more than that.
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

/** This is a bit set where each bit represents a byte of address used or unused. */
export class AddressRangesInUse {
    // We could have derived from bitSet but want to be able to change the implementation
    protected bitSet : FixedBitSet;

    constructor(len:number) {
        this.bitSet = new FixedBitSet(len);
    }

    public get maxLen() : number {
        return this.bitSet.maxLen;
    }

    public setAddrRange(offset:number, length:number=4) : void {
        if ((offset & 0x3) || (length & 0x3)) {
            // either offset or length not a multiple of 4
            for(let ix = 0; ix < length; ix++) {
                this.bitSet.setBit(ix+offset);
            }
        } else {
            while (length > 0) {
                this.setWord(offset);
                offset += 4;
                length -= 4;
            }
        }
    }

    public setWord(offset: number) : void {
        this.bitSet.setNibble(offset);
    }

    /**
     * Calculates a set of consecutive words/bytes that contain valid addresses.
     * 
     * @param base all the return values will have this base address added to them
     * @param aligned if true, we look for 4 byte chunks or it is byte at a time
     * @returns an array of ordered unique address ranges containing valid addresses. Can be an empty array
     */
    public getAddressRangesExact(base:number, aligned:boolean=false) : AddrRange[] {
        const retVal: AddrRange[] = [];
        let range: AddrRange | null = null;
        const itor = aligned ? this.bitSet.findNibbleItor : this.bitSet.findBitItor;
        const inc = aligned ? 4 : 1;

        {
            let nxtIx = -2;
            function cb(ix:number): boolean {
                if (!range || (nxtIx !== ix)) {
                    range = new AddrRange(base + ix, inc);
                    retVal.push(range);
                } else {                    // continuation of prev. range
                    range.length += inc; 
                }
                nxtIx = ix + inc;
                return true;                
            }
            if (aligned) {
                this.bitSet.findNibbleItor(cb);
            } else {
                this.bitSet.findBitItor(cb);
            }
            return retVal;
        }

        if (!aligned) {
            let lastIx = -2;
            this.bitSet.findBitItor((ix) : boolean => {
                if (!range || ((lastIx + 1) !== ix)) {
                    range = new AddrRange(base + ix, 1);
                    retVal.push(range);
                } else {                    // continuation of prev. range
                    range.length++; 
                }
                lastIx = ix;
                return true;
            });
            return retVal;
        } else {
            let lastIx = -2;
            this.bitSet.findNibbleItor((ix) : boolean => {
                if (!range || ((lastIx + 4) !== ix)) {
                    range = new AddrRange(base + ix, 4);
                    retVal.push(range);
                } else {                    // continuation of prev. range
                    range.length += 4; 
                }
                lastIx = ix;
                return true;
            });
            return retVal;            
        }

        let addr = 0;
        const mask = 0xf;
        const incr = 4;
        const bitAry = this.bitSet.bitArray;
        for (let ix = 0; ix < bitAry.length; ix++) {
            let val = bitAry[ix];
            if (val !== 0) {                
                for (let bits = 0; bits < BitSetConsts.NBITS ; bits += incr ) {
                    if ((mask & val) !== 0) {       // got something
                        if (range) {                // consecutive words
                            range.length += incr;   // just increase previous ranges length
                        } else {
                            range = new AddrRange(base + addr, incr);
                            retVal.push(range);
                        }
                    } else {
                        range = null;
                    }
                    addr += incr;
                    val = val >>> incr;
                }                
            } else {
                range = null;
                addr += BitSetConsts.NBITS;
            }
        }
        return retVal;
    }

    /**
     * Calculates a set of ranges that contain valid address ranges and eliminates small gaps
     * to combine ranges and a fewer set of ranges
     * 
     * @param base all the return values will havd this base address added to them
     * @param aligned if true, we look for 4 byte chunks or it is byte at a time
     * @param minGap gaps less than specified number of bytes will be merged
     * @returns an array of ordered compressed address ranges. Can be an empty array
     */
    public getAddressRangesOptimized(base:number, aligned:boolean=false, minGap:number = 8) : AddrRange[] {
        const exactVals = this.getAddressRangesExact(base, aligned);
        if ((minGap <= 0) || (exactVals.length < 2)) {
            return exactVals;
        }

        const retVal = [];
        let lastRange : AddrRange | null = null;
        if (aligned) {
            minGap = (minGap + 7) & ~7;     // Make it a multiple of 8 rounding up
        }
        for (let range of exactVals) {
            if (lastRange && ((lastRange.base + lastRange.length + minGap) >= range.base)) {
                lastRange.length = range.base - lastRange.base + range.length;
            } else {
                retVal.push(range);
                lastRange = range;                
            }
        }

        return retVal;
    }

    /** Returns new set of address ranges that have length > 0 && <= maxBytes */
    public static splitIntoChunks(ranges: AddrRange[], maxBytes:number) : AddrRange[] {
        let newRanges = new Array<AddrRange>();
        for (let r of ranges) {
            while (r.length > maxBytes) {
                newRanges.push(new AddrRange(r.base, maxBytes));
                r.base += maxBytes;
                r.length -= maxBytes;
            }
            if (r.length > 0) {
                newRanges.push(r);
            }
        }
        return newRanges;
    }

    public toHexString() : string {
        return this.bitSet.toHexString(); 
    }

    public clearAll() : void {
        this.bitSet.clearAll();
    }

    public static consoleLog(prefix:string, base:number, len:number, ranges: AddrRange[]) : void {
        console.log(prefix + `base=0x${base.toString(16)}, totalLen=${len}, #ranges=${ranges.length}\n`);
        let bc = 0;
        ranges.forEach((range,i,a) => {
            bc += range.length;
            console.log(`**** 0x${range.base.toString(16)}, len=${range.length}, bytes=${bc}\n`);
        });
    }
}