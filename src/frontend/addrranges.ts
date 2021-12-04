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
export class AddressRangesUtils {
    constructor() {
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
            AddressRangesUtils.consoleLog(dbgMsg, newRanges[0].base, dbgLen, newRanges);
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
