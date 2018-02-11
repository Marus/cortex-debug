export function hexFormat(value: number, padding: number = 8, includePrefix: boolean = true): string {
    let base = value.toString(16);
    while (base.length < padding) { base = '0' + base; }
    return includePrefix ? '0x' + base : base;
}

export function binaryFormat(value: number, padding: number = 0, includePrefix: boolean = true, group: boolean = false): string {
    let base = (value >>> 0).toString(2);
    while (base.length < padding) { base = '0' + base; }

    if (group) {
        const nibRem = 4 - (base.length % 4);
        for (let i = 0; i < nibRem; i++) { base = '0' + base; }
        const groups = base.match(/[01]{4}/g);
        base = groups.join(' ');

        base = base.substring(nibRem);
    }

    return includePrefix ? '0b' + base : base;
}

export function createMask(offset: number, width: number) {
    let r = 0;
    const a = offset;
    const b = offset + width - 1;
    for (let i = a; i <= b; i++) { r = (r | (1 << i)) >>> 0; }
    return r;
}

export function extractBits(value: number, offset: number, width: number) {
    const mask = createMask(offset, width);
    const bvalue = ((value & mask) >>> offset) >>> 0;
    return bvalue;
}
