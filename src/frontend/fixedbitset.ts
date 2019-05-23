// Author to Blame: haneefdm on github

/**
 * Helpful constants. We use 32bit quantities, they are safe in JavaScript.
 * Do not use anything larger because we use many bitwise operators and they all
 * operate in 32-bit quantities
 */
export const enum BitSetConsts {
    // We define them here in an ugly way to guarantee constant folding.
    // Let me know if there is a better way. Things like const,
    // etc. are syntactic sugar -- take a look at generated code.
    SHFT  = 5,
    NBITS = (1 << SHFT),
    MASK  = (NBITS - 1)
}

/**
 * A simple implementation of a bitset of fixed size. You can make it dynamic by
 * extending this class and overriding the setters (setBit, clrBit and invBit) to
 * auto-resize. A resize function is provided.
 * 
 * You can use it store flags in a very compact form and if your data is sparse, then you
 * can iterate over them faster. Gigantic space, yet super-sparse, consider a balanced tree
 * or a set/map/something-else
 * 
 * Get/Set is O(1)
 * Traversal is O(N) => N = length of the array, but able to skip large empty spaces
 *
 * It is also a very efficient way of doing unions/intersections using bitwise operations.
 */
export class FixedBitSet {
    protected bitArray: Uint32Array ;
    protected xnumBits: number;
    public get numBits(): number {
        return this.xnumBits;
    }

    // Enable this to do error checking. Maybe there is a better waay, to remove assert overhead
    public static doAsserts: boolean = false;

    constructor(len: number) {
        if (FixedBitSet.doAsserts) {
            console.assert(Number.isInteger(len) && (len >= 0));
        }
        this.xnumBits = len;
        this.bitArray = new Uint32Array(FixedBitSet.calcAryLen(len));
    }

    public dup(): FixedBitSet {
        const ret = new FixedBitSet(this.numBits);
        ret.bitArray.set(this.bitArray);
        return ret;
    }

    private ixRangeCheck(ix: number): boolean {
        return Number.isInteger(ix) && (ix >= 0) && (ix < this.numBits);
    }
    /**
     * Get bit at specified index
     * @return a number that is either zero or non-zero
     */
    public getBit(ix: number): number {
        if (FixedBitSet.doAsserts) {
            console.assert(this.ixRangeCheck(ix), 'getBit: invalid index ', ix, this);
        }
        return this.bitArray[ix >>> BitSetConsts.SHFT] & (1 << (ix & BitSetConsts.MASK)) ;
    }
    /** Sets the bit at index 'ix' to 1 */
    public setBit(ix: number): void {
        if (FixedBitSet.doAsserts) {
            console.assert(this.ixRangeCheck(ix), 'setBit: invalid index ', ix, this);
        }
        this.bitArray[ix >>> BitSetConsts.SHFT] |= (1 << (ix & BitSetConsts.MASK)) ;
    }
    /** Sets the bit at index 'ix' to 0 */
    public clrBit(ix: number): void {
        if (FixedBitSet.doAsserts) {
            console.assert(this.ixRangeCheck(ix), 'clrBit: invalid index ', ix, this);
        }
        this.bitArray[ix >>> BitSetConsts.SHFT] &= ~(1 << (ix & BitSetConsts.MASK)) ;
    }
    /** Inverts the bit at index 'ix' to 0 */
    public invBit(ix: number): void {
        if (FixedBitSet.doAsserts) {
            console.assert(this.ixRangeCheck(ix), 'invBit: invalid index ', ix, this);
        }
        this.bitArray[ix >>> BitSetConsts.SHFT] ^= (1 << (ix & BitSetConsts.MASK)) ;
    }

    /** clears all bits */
    public clearAll(): void {
        this.bitArray.fill(0);
    }

    /** Sets a set of four consecutive bits
     * @param ix: Must a multiple of four and in range
     */
    public setNibble(ix: number): void {
        if (FixedBitSet.doAsserts) {
            console.assert(this.ixRangeCheck(ix + 3), 'setNibble: invalid index ', ix, this);
            console.assert((ix & 0x3) === 0, 'setNibble: ix must be >= 0 & multiple of 4');
        }
        this.bitArray[ix >>> BitSetConsts.SHFT] |= ((0xf << (ix & BitSetConsts.MASK)) >>> 0);
    }

    public toString(): string {
        return this.bitArray.toString();
    }

    /**
     * Iterator built for efficiency. No guarantees if you modify this object
     * while iterating (especially a resize)
     * 
     * @param cb: a function called with the next bit position that is non-zero. If
     * callback returns false, iterator will terminate
     */
    public findBitItor(cb: (ix: number) => boolean): void {
        // Could have used an actual Iterator interface but we have to keep too much
        // state to make a next() work properly.   
        let bitIx = 0;
        let aryIx = 0;
        while (bitIx < this.xnumBits) {
            let elem = this.bitArray[aryIx++];
            if (elem === 0) {
                bitIx += BitSetConsts.NBITS;
                continue;
            }
            for (let byteIx = 0; (byteIx < (BitSetConsts.NBITS / 8)) && (bitIx < this.numBits); byteIx++) {
                const byteVal = elem & 0xff;
                elem >>>= 8;
                if (byteVal === 0) {    // Try to skip byte at a time
                    bitIx += 8;
                    continue;
                }
                // We do not bail early or skip bits to keep bitIx updated
                for (let bitPos = 1; (bitPos < (1 << 8)) && (bitIx < this.numBits); bitPos <<= 1) {
                    if (byteVal & bitPos) {
                        if (!cb(bitIx)) { return; }
                    }
                    bitIx++;
                }
            }
        }
    }

    /** Return an array of indices where a bit positions are non-zero */
    public findAllBits(): number[] {
        const ret: number[] = [];
        this.findBitItor((ix): boolean => {
            ret.push(ix);
            return true;
        });
        return ret;
    }

    /**
     * Iterator built for efficiency. No guarantees if you modify this object
     * while iterating (especially a resize). It scans four bits at a time.
     * We don't check if the entire nibble is set - any bit in the nibble being set
     * 
     * @param cb: a function called with the next nibble position that is non-zero. If
     * callback returns false, iterator will terminate
     */
    public findNibbleItor(cb: (ix: number) => boolean): void {
        let addr = 0;
        const stop = this.bitArray.length;
        for (let ix = 0; ix < stop; ix++) {
            let val = this.bitArray[ix];
            if (val !== 0) {
                for (let bits = 0; bits < BitSetConsts.NBITS; bits += 4) {
                    if ((0xf & val) !== 0) {       // got something
                        if (addr < this.numBits) {
                            if (!cb(addr)) { return; }
                        } else {
                            console.assert(false, 'Defect in FixedBitset. Not expecting a value in trailing bits');
                        }
                    }
                    addr += 4;
                    val >>>= 4;
                }
            } else {
                addr += BitSetConsts.NBITS;
            }
        }
    }
    
    /**
     * Not sure what this looks like on a big endian machine. We can correct for that
     * if needed. Expecting this to be used mostly for debugging. Note that the nibbles
     * are also backards in each byte. One char represents a nibble.
     */
    public toHexString(): string {
        const buf = Buffer.from(this.bitArray.buffer);
        const str = buf.toString('hex');
        return str;
    }

    /** resizes the number of bits --  not yet tested */
    public reSize(len: number): void {
        if (FixedBitSet.doAsserts) {
            console.assert(Number.isInteger(len) && (len >= 0));
        }
        if (len <= 0) {
            this.xnumBits = 0;
            this.bitArray = new Uint32Array(0);
        } else if (len !== this.xnumBits) {
            const numUnits = FixedBitSet.calcAryLen(len);
            let newAry: Uint32Array;
            if (numUnits <= this.bitArray.length) {
                newAry = this.bitArray.subarray(0, numUnits);
                const diff = (numUnits * BitSetConsts.NBITS) - len;
                if (diff > 0) {             // clear any traiiing bits in most sig. portion
                    // We HAVE to clear trailing bits in case the nibble iterator is being used
                    const mask = (0xffffffff << (BitSetConsts.NBITS - diff)) >>> 0;
                    newAry[numUnits - 1] &= mask;
                }
            } else {
                newAry = new Uint32Array(numUnits);
                newAry.set(this.bitArray);
            }
            this.xnumBits = len;
            this.bitArray = newAry;
        }
    }

    /** Basically does a Math.ceil(len / NBITS) using integer ops. */
    protected static calcAryLen(len: number): number {
        const ret = (len <= 0) ? 0 : ((len + BitSetConsts.MASK) >>> BitSetConsts.SHFT);
        return ret;
    }
}
