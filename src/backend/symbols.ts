import * as childProcess from 'child_process';
import { SymbolType, SymbolScope, SymbolInformation } from '../symbols';

const SYMBOL_REGEX = /^([0-9a-f]{8})\s([lg\ !])([w\ ])([C\ ])([W\ ])([I\ ])([dD\ ])([FfO\ ])\s([^\s]+)\s([0-9a-f]+)\s(.*)$/;

const TYPE_MAP: { [id: string]: SymbolType } = {
	'F': SymbolType.Function,
	'f': SymbolType.File,
	'O': SymbolType.Object,
	' ': SymbolType.Normal
};

const SCOPE_MAP: { [id: string]: SymbolScope } = {
	'l': SymbolScope.Local,
	'g': SymbolScope.Global,
	' ': SymbolScope.Neither,
	'!': SymbolScope.Both
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
		let current_file: string = null;
		
		for (let line of lines) {
			let match = line.match(SYMBOL_REGEX);
			if (match) {
				if (match[7] === 'd' && match[8] == 'f') {
					current_file = match[11].trim()
				}
				this.symbols.push({
					address: parseInt(match[1], 16),
					type: TYPE_MAP[match[8]],
					scope: SCOPE_MAP[match[2]],
					section: match[9].trim(),
					length: parseInt(match[10], 16),
					name: match[11].trim(),
					file: current_file
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

	getFunctionSymbols(): SymbolInformation[] {
		return this.symbols.filter(s => s.type == SymbolType.Function);
	}

	getGlobalVariables(): SymbolInformation[] {
		let matches = this.symbols.filter(s => s.type == SymbolType.Object && s.scope == SymbolScope.Global);
		return matches;
	}

	getStaticVariables(file: string): SymbolInformation[] {
		return this.symbols.filter(s => s.type == SymbolType.Object && s.scope == SymbolScope.Local && s.file == file);
	}
}