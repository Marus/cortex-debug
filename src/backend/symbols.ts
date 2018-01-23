import * as childProcess from 'child_process';
import * as os from 'os';
import * as path from 'path';

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

	constructor(private toolchainPath: string, private executable: string) {
		this.symbols = [];
	}

	loadSymbols() {
		try {
			let objdumpExePath = os.platform() !== 'win32' ? 'arm-none-eabi-objdump' : 'arm-none-eabi-objdump.exe';
			if (this.toolchainPath) {
				objdumpExePath = path.normalize(path.join(this.toolchainPath, objdumpExePath));
			}

			let objdump = childProcess.spawnSync(objdumpExePath, ['--syms', this.executable]);
			let output = objdump.stdout.toString();
			let lines = output.split('\n');
			let current_file: string = null;
			
			for (let line of lines) {
				let match = line.match(SYMBOL_REGEX);
				if (match) {
					if (match[7] === 'd' && match[8] == 'f') {
						current_file = match[11].trim()
					}
					let type = TYPE_MAP[match[8]];
					let scope = SCOPE_MAP[match[2]];

					this.symbols.push({
						address: parseInt(match[1], 16),
						type: type,
						scope: scope,
						section: match[9].trim(),
						length: parseInt(match[10], 16),
						name: match[11].trim(),
						file: scope == SymbolScope.Local ? current_file : null,
						instructions: null
					});
				}
			}
		}
		catch (e) {
			console.log('Error Loading Debug Symbol Table');
		}
	}

	getFunctionAtAddress(address: number): SymbolInformation {
		let matches = this.symbols.filter(s => s.type == SymbolType.Function && s.address <= address && (s.address + s.length) > address);
		if(!matches || matches.length == 0) { return undefined; }

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

	getFunctionByName(name: string, file?: string): SymbolInformation {
		// Try to find static function first
		let matches = this.symbols.filter(s => s.type == SymbolType.Function && s.scope == SymbolScope.Local && s.name == name && s.file == file);
		if (matches.length !== 0) { return matches[0]; }
		
		// Fall back to global scope
		matches = this.symbols.filter(s => s.type == SymbolType.Function && s.scope != SymbolScope.Local && s.name == name);
		return matches.length !== 0 ? matches[0] : null;
	}
}