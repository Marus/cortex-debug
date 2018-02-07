export function hexFormat(value: number, padding: number = 8, includePrefix: boolean = true) : string {
	var base = value.toString(16);
	while(base.length < padding) { base = '0' + base; }
	return includePrefix ? '0x' + base : base;
}

export function binaryFormat(value: number, padding: number = 0, includePrefix: boolean = true, group: boolean = false) : string {
	let base = (value >>> 0).toString(2);
	while(base.length < padding) { base = '0' + base; }

	if (group) {
		let nibRem = base.length % 4;
		for (let i = 0; i < nibRem; i++) { base = '0' + base; }
		let groups = base.match(/[01]{4}/g);
		base = groups.join(' ');
	}

	return includePrefix ? '0b' + base : base;;
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