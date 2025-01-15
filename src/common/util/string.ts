export function parseHexOrDecInt(str: string): number {
    return str.startsWith('0x') ? parseInt(str.substring(2), 16) : parseInt(str, 10);
}

export function toStringDecHexOctBin(val: number/* should be an integer*/): string {
    if (Number.isNaN(val)) {
        return 'NaN: Not a number';
    }
    if (!Number.isSafeInteger(val)) {
        // TODO: Handle bigNum's. We eventually have to. We need to use bigint as javascript
        // looses precision beyond 53 bits
        return 'Big Num: ' + val.toString() + '\nother-radix values not yet available. Sorry';
    }

    let ret = `dec: ${val}`;
    if (val < 0) {
        val = -val;
        val = (~(val >>> 0) + 1) >>> 0;
    }
    let str = val.toString(16);
    str = '0x' + '0'.repeat(Math.max(0, 8 - str.length)) + str;
    ret += `\nhex: ${str}`;

    str = val.toString(8);
    str = '0'.repeat(Math.max(0, 12 - str.length)) + str;
    ret += `\noct: ${str}`;

    str = val.toString(2);
    str = '0'.repeat(Math.max(0, 32 - str.length)) + str;
    let tmp = '';
    while (true) {
        if (str.length <= 8) {
            tmp = str + tmp;
            break;
        }
        tmp = ' ' + str.slice(-8) + tmp;
        str = str.slice(0, -8);
    }
    ret += `\nbin: ${tmp}`;
    return ret ;
}
