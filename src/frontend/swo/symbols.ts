import * as childProcess from 'child_process';

const SYMBOL_REGEX = /^([0-9a-f]{8})\s([lg\ !])([w\ ])([C\ ])([W\ ])([I\ ])([dD\ ])([FfO\ ])\s([^\s]+)\s([0-9a-f]+)\s(.*)$/;

enum SymbolType {
	Function,
	File,
	Object,
	Normal
};

export interface SymbolInformation {
	address: number;
	length: number;
	name: string;
	section: string;
	type: SymbolType
};

const TYPE_MAP: { [id: string]: SymbolType } = {
	'F': SymbolType.Function,
	'f': SymbolType.File,
	'O': SymbolType.Object,
	' ': SymbolType.Normal
};

export class SymbolTable {
	private symbols: SymbolInformation[];

	constructor(private executable: string) {
		this.symbols = [];
	}

	loadSymbols() {
		let objdump = childProcess.spawnSync('arm-none-eabi-objdump', ['--syms', this.executable]);
		let output = objdump.stdout.toString();
		let lines = output.split('\n');
		for (let line of lines) {
			let match = line.match(SYMBOL_REGEX);
			if(match) {
				this.symbols.push({
					address: parseInt(match[1], 16),
					type: TYPE_MAP[match[8]],
					section: match[9],
					length: parseInt(match[10], 16),
					name: match[11]
				});
			}
		}
	}

	getFunctionAtAddress(address: number): SymbolInformation {
		let matches = this.symbols.filter(s => s.type == SymbolType.Function && s.address <= address && (s.address + s.length) > address);
		if(!matches || matches.length == 0) { return undefined; }

		if (matches.length > 1) {
			console.log('Multiple Symbol Matches: ???');
			console.log(address, matches);
		}

		return matches[0];
	}
}