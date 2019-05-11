/**
 * A simple implementation of a bitset of fixed size. You can make it dynamic by
 * extending this class and overriding the setters (setBit, clrBit and invBit) to
 * auto-resize. A resize function is provided.
 */
export class FixedBitSet {
    protected bitArray : Uint32Array ;
    protected _maxLen: number;
    public get maxLen(): number {
        return this._maxLen;
    }

    // Lets use 32bit quantities, they are safe in JavaScript. Do not use anything larger
    // because we have not tested for side effects
    protected static readonly shft  = 5;
    protected static readonly nBits = 1 << FixedBitSet.shft;
    protected static readonly mask  = FixedBitSet.nBits - 1;

    constructor(len: number, public readonly doAsserts: boolean=false) {
        if (doAsserts) {
            console.assert(Number.isInteger(len) && (len >= 0));
        }
        this._maxLen = len;
        this.bitArray = new Uint32Array(FixedBitSet.calcAryLen(len));
    }

    private ixRangeCheck(ix: number) : boolean {
        return Number.isInteger(ix) && (ix >= 0) && (ix < this.maxLen);
    }
    /**
     * Get bit at specified index
     * @return a number that is either zero or non-zero
     */
    public getBit(ix:number) : number {
        if (this.doAsserts) {
            console.assert(this.ixRangeCheck(ix), 'invalid index ', ix, this);
        }
        return this.bitArray[ix >>> FixedBitSet.shft] & (1 << (ix & FixedBitSet.mask)) ;
    }
    /** Sets the bit at index 'ix' to 1 */
    public setBit(ix:number) : void {
        if (this.doAsserts) {
            console.assert(this.ixRangeCheck(ix), 'invalid index ', ix, this);
        }
        this.bitArray[ix >>> FixedBitSet.shft] |= (1 << (ix & FixedBitSet.mask)) ;
    }
    /** Sets the bit at index 'ix' to 0 */
    public clrBit(ix:number) : void {
        if (this.doAsserts) {
            console.assert(this.ixRangeCheck(ix), 'invalid index ', ix, this);
        }
        this.bitArray[ix >>> FixedBitSet.shft] &= ~(1 << (ix & FixedBitSet.mask)) ;
    }
    /** Inverts the bit at index 'ix' to 0 */
    public invBit(ix:number) : void {
        if (this.doAsserts) {
            console.assert(this.ixRangeCheck(ix), 'invalid index ', ix, this);
        }
        this.bitArray[ix >>> FixedBitSet.shft] ^= (1 << (ix & FixedBitSet.mask)) ;
    }

    /** clears all bits */
    public clearAll() : void {
        this.bitArray.fill(0);
    }

    public toString() : string {
        return this.bitArray.toString();
    }

    /**
     * Iterator built for efficiency. No guarantees if you modify this object
     * while iterating (especially a resize)
     * 
     * @param cb: a function called with the next bit position that is non-zero. If
     * callback returns false, iterator will terminate
     */
    public findBitItor(cb: (ix:number) => boolean) : void {
        // Could have used an actual Iterator interface but we have to keep too much
        // state to make a next() work properly.   
        let bitIx = 0;
        let aryIx = 0;
        while (bitIx < this.maxLen) {
            let elem = this.bitArray[aryIx++];
            if (elem === 0) {
                bitIx += FixedBitSet.nBits;
                continue;
            }
            for (let byteIx = 0; (byteIx < (FixedBitSet.nBits/8)) && (bitIx < this.maxLen); byteIx++) {
                const byteVal = elem & 0xff;
                elem >>>= 8;
                if (byteVal === 0) {    // Try to skip byte at a time
                    bitIx += 8;
                    continue;
                }
                // We do not bail early or skip bits to keep bitIx updated
                for(let bitPos = 1; (bitPos < (1<<8)) && (bitIx < this.maxLen); bitPos <<= 1) {
                    if (byteVal & bitPos) {
                        if (!cb(bitIx)) {
                            return;
                        }
                    }
                    bitIx++;
                }
            }
        }
    }

    /** Return an array of indices where a bit positions are non-zero */ 
    public findAllBits() : number[] {
        const ret: number[] = [];
        this.findBitItor((ix): boolean => {
            ret.push(ix);
            return true;
        });
        return ret;
    }

    /**
     * Not sure what this looks like on a big endian machine. We can correct for that
     * if needed. Expecting this to be used mostly for debugging. Note that the nibbles
     * are also backards in each byte. One char represents a nibble.
     */
    public toHexString() {  
        const buf = Buffer.from(this.bitArray.buffer);
        const str = buf.toString('hex');
        return str;
    }

    /** resizes the number of bits --  not yet tested */
    public reSize(len: number) : void {
        if (this.doAsserts) {
            console.assert(Number.isInteger(len) && (len >= 0));
        }
        if (len <= 0) {
            this._maxLen = 0;
            this.bitArray = new Uint32Array(0);            
        } else if (len != this._maxLen) {
            const numUnits = FixedBitSet.calcAryLen(len);
            let newAry : Uint32Array;
            if (numUnits <= this.bitArray.length) {
                newAry = this.bitArray.subarray(0, numUnits);
            } else {
                newAry = new Uint32Array(numUnits);
                newAry.set(this.bitArray);
            }
            let diff = len - (numUnits << FixedBitSet.shft);
            if (diff > 0) {             // clear any traiiing bits in most sig. portion
                // Strictly speaking, we shouln't have to do this. Just to keep debugging
                // and testing easier.
                const mask = (((1 << diff) - 1) << (FixedBitSet.nBits - diff)) >>> 0;
                newAry[numUnits - 1] &= mask;
            }
            this._maxLen = len;
            this.bitArray = newAry;
        }
    }

    /** Basically does a Math.ceil(len / FixedBitSet.nBits) using integer ops. */
    protected static calcAryLen(len:number) : number {
        const ret = (len <= 0) ? 0 : ((len + FixedBitSet.mask) >>> FixedBitSet.shft);
        return ret;
    }
}
