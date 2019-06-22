import { Parser } from 'binary-parser';

const SignedParser = new Parser().endianess('little').int32('value');
const UnsignedParser = new Parser().endianess('little').uint32('value');
const FloatParser = new Parser().endianess('little').floatle('value');

export function parseFloat(buffer: Buffer): number {
    if (buffer.length < 4) {
        const tmp = Buffer.alloc(4);
        buffer.copy(tmp);
        buffer = tmp;
    }

    const result = FloatParser.parse(buffer);
    return result.value;
}

export function parseSigned(buffer: Buffer): number {
    if (buffer.length < 4) {
        const tmp = Buffer.alloc(4);
        buffer.copy(tmp);
        buffer = tmp;
    }
    
    const result = SignedParser.parse(buffer);
    return result.value;
}

export function parseUnsigned(buffer: Buffer): number {
    if (buffer.length < 4) {
        const tmp = Buffer.alloc(4);
        buffer.copy(tmp);
        buffer = tmp;
    }

    const result = UnsignedParser.parse(buffer);
    return result.value;
}

export function parseQ(buffer: Buffer, mask: number, shift: number) {
    const value = parseSigned(buffer);

    const fractional = value & mask;
    const integer = value >> shift;

    return integer + (fractional / mask);
}

export function parseUQ(buffer: Buffer, mask: number, shift: number) {
    const value = parseUnsigned(buffer);

    const fractional = value & mask;
    const integer = value >>> shift;

    return integer + (fractional / mask);
}

export const decoders = {
    signed: parseSigned,
    float: parseFloat,
    Q8_24: (buffer) => parseQ(buffer, 0xFFFFFF, 24),
    Q16_16: (buffer) => parseQ(buffer, 0xFFFF, 16),
    Q24_8: (buffer) => parseQ(buffer, 0xFF, 8),
    UQ8_24: (buffer) => parseUQ(buffer, 0xFFFFFF, 24),
    UQ16_16: (buffer) => parseUQ(buffer, 0xFFFF, 16),
    UQ24_8: (buffer) => parseUQ(buffer, 0xFF, 8),
    unsigned: parseUnsigned
};
