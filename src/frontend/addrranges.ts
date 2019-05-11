import {FixedBitSet} from './fixedbitset';

/*
 * This file contains classes to create address ranges that are in use in an address space.
 * We use a bitset implementation to handle large spaces. We could also have used an interval 
 * tree (Red-Black) but too much work and even if the space is large, we are not expecting
 * millions/billions of registers/addresses and short lifespan wrt. updates.
 * 
 * With a bit set, it is a mark and scan method. Mark each byte used O(1), then scan the
 * space O(N) where N is [size of address space] but we can skip in 32/8/4 byte chunks of
 * emptyness. Hence a bitset.
 * 
 * A tree implementation would have been more efficient for super large address spaces
 * in the range of 100's of megabytes.
 * 
 * Use case here is to calculate used addr-ranges once and cache them; actual data used
 * to caculate is likely transient. Since we are semi-tight on memory (1-bit per byte) you
 * can keep it. As a user you can decide 1-bit represents an arbitrary amount of bytes.
 * 
 * LIMITATION: Do not use beyond a 32-bit address span. It is okay for the base address to be more
 * than that. Javascript has limits beyond 53 bits for precise integers and even that is iffy
 * because this module has not been written/tested for more than 32 bits as shift and mask operators
 * are used abundantly.
 */

 /**
  * Represents a single address-range
  */
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
 * This is a bit set where each bit represents a byte of address used or unused.
 */
export class AddressRangesInUse extends FixedBitSet {
    constructor(len:number, doAsserts: boolean=false) {
        super(len, doAsserts);
    }

    public setAddrRange(offset:number, length:number=4) : void {
        if ((offset & 0x3) || (length & 0x3)) {
            // either offset or length not a multiple of 4
            for(let ix = 0; ix < length; ix++) {
                this.setBit(ix+offset);
            }
        } else {
            for (let n=0; n < length; n += 4) {
                this.setWord(n+offset);
            }
        }
    }

    public setWord(offset: number) : void {
        this.bitArray[offset >>> FixedBitSet.shft] |= (0xf << (offset & FixedBitSet.mask)) ;
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

        if (!aligned) {
            let lastIx = -2;                // This init value is intentional
            this.findBitItor((ix) : boolean => {
                // ix will always be >= 0
                if (++lastIx === ix) {
                    range!.length++;        // We KNOW range will not be null
                } else {
                    range = new AddrRange(base + ix, 1);
                    retVal.push(range);
                    lastIx = ix;
                }
                return true;
            });
            return retVal;
        }

        let addr = 0;
        const mask = 0xf;
        const incr = 4;
        for (let ix = 0; ix < this.bitArray.length; ix++) {
            let val = this.bitArray[ix];
            if (val !== 0) {                
                for (let bits = 0; bits < FixedBitSet.nBits ; bits += incr ) {
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
                addr += FixedBitSet.nBits;
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
     * @returns an array of ordered compressed address ranges containing. Can be an empty array
     */
    public getAddressRangesOptimized(base:number, aligned:boolean=false, minGap:number = 8) : AddrRange[] {
        const exactVals = this.getAddressRangesExact(base, aligned);
        if ((minGap <= 0) || (exactVals.length < 2)) {
            return exactVals;
        }

        const retVal = [];
        let lastRange : AddrRange | null = null;
        if (aligned) {
            minGap = (minGap + 3) & ~3;     // Make it a multiple of 4 rounding up
        }
        for (let ix = 0; ix < exactVals.length; ix++) {
            const range = exactVals[ix];
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
        for (let ix = 0; ix < ranges.length; ix++) {
            let r = ranges[ix];
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

    public static consoleLog(prefix:string, base:number, len:number, ranges: AddrRange[]) : void {
        console.log(prefix + `base=0x${base.toString(16)}, totalLen=${len}, #ranges=${ranges.length}\n`);
        let bc = 0;
        ranges.forEach((range,i,a) => {
            bc += range.length;
            console.log(`**** 0x${range.base.toString(16)}, len=${range.length}, bytes=${bc}\n`);
        });
    }
}