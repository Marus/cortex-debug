export function hexFormat(value: number, padding: number = 8) : string {
	var base = value.toString(16);
	while(base.length < padding) { base = '0' + base; }
	return '0x' + base;
}

export function binaryFormat(value: number, padding: number = 0) : string {
	let base = (value >>> 0).toString(2);
	while(base.length < padding) { base = '0' + base; }
	return '0b' + base;
}

export function createMask(offset: number, width: number) {
	let r = 0;
	let a = offset;
	let b = offset + width - 1;
	for (var i=a; i<=b; i++) r = (r | (1 << i)) >>> 0;
	return r;
}

export function extractBits(value: number, offset: number, width: number) {
	let mask = createMask(offset, width);
	let bvalue = ((value & mask) >>> offset) >>> 0;
	return bvalue;
}