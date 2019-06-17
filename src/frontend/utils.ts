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

export function parseInteger(value: string): number {
    if ((/^0b([01]+)$/i).test(value)) {
        return parseInt(value.substring(2), 2);
    }
    else if ((/^0x([0-9a-f]+)$/i).test(value)) {
        return parseInt(value.substring(2), 16);
    }
    else if ((/^[0-9]+/i).test(value)) {
        return parseInt(value, 10);
    }
    else if ((/^#[0-1]+/i).test(value)) {
        return parseInt(value.substring(1), 2);
    }
    return undefined;
}

export function parseDimIndex(spec: string, count: number): string[] {
    if (spec.indexOf(',') !== -1) {
        const components = spec.split(',').map((c) => c.trim());
        if (components.length !== count) {
            throw new Error('dimIndex Element has invalid specification.');
        }
        return components;
    }

    if (/^([0-9]+)\-([0-9]+)$/i.test(spec)) {
        const parts = spec.split('-').map((p) => parseInteger(p));
        const start = parts[0];
        const end = parts[1];

        const numElements = end - start + 1;
        if (numElements < count) {
            throw new Error('dimIndex Element has invalid specification.');
        }

        const components = [];
        for (let i = 0; i < count; i++) {
            components.push(`${start + i}`);
        }

        return components;
    }

    if (/^[a-zA-Z]\-[a-zA-Z]$/.test(spec)) {
        const start = spec.charCodeAt(0);
        const end = spec.charCodeAt(2);

        const numElements = end - start + 1;
        if (numElements < count) {
            throw new Error('dimIndex Element has invalid specification.');
        }

        const components = [];
        for (let i = 0; i < count; i++) {
            components.push(String.fromCharCode(start + i));
        }

        return components;
    }

    return [];
}
