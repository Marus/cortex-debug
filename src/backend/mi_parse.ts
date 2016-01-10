export interface MIInfo {
	token: number;
	outOfBandRecord: { isStream: boolean, type: string, asyncClass: string, output: [string, any][], content: string }[];
	resultRecords: { resultClass: string, results: [string, any][] };
}

export class MINode implements MIInfo {
	token: number;
	outOfBandRecord: { isStream: boolean, type: string, asyncClass: string, output: [string, any][], content: string }[];
	resultRecords: { resultClass: string, results: [string, any][] };

	constructor(token: number, info: { isStream: boolean, type: string, asyncClass: string, output: [string, any][], content: string }[], result: { resultClass: string, results: [string, any][] }) {
		this.token = token;
		this.outOfBandRecord = info;
		this.resultRecords = result;
	}

	record(path: string): any {
		if (!this.outOfBandRecord)
			return undefined;
		return MINode.valueOf(this.outOfBandRecord[0].output, path);
	}

	result(path: string): any {
		if (!this.resultRecords)
			return undefined;
		return MINode.valueOf(this.resultRecords.results, path);
	}

	static valueOf(start: any, path: string): any {
		if (!start)
			return undefined;
		let pathRegex = /^\.?([a-zA-Z_\-][a-zA-Z0-9_\-]*)/;
		let indexRegex = /^\[(\d+)\](?:$|\.)/;
		path = path.trim();
		if (!path)
			return start;
		let current = start;
		do {
			let target = pathRegex.exec(path);
			if (target) {
				path = path.substr(target[0].length);
				if (current.length && typeof current != "string") {
					let found = [];
					for (let i = 0; i < current.length; i++) {
						let element = current[i];
						if (element[0] == target[1]) {
							found.push(element[1]);
						}
					}
					if (found.length > 1) {
						current = found;
					} else if (found.length == 1) {
						current = found[0];
					} else return undefined;
				} else return undefined;
			}
			else if (path[0] == '@') {
				current = [current];
				path = path.substr(1);
			}
			else {
				target = indexRegex.exec(path);
				if (target) {
					path = path.substr(target[0].length);
					let i = parseInt(target[1]);
					if (current.length && typeof current != "string" && i >= 0 && i < current.length) {
						current = current[i];
					} else if (i == 0) {
					} else return undefined;
				}
				else return undefined;
			}
			path = path.trim();
		} while (path);
		return current;
	}
}

const tokenRegex = /^[0-9]+/;
const outOfBandRecordRegex = /^(?:([0-9]*)([\*\+\=])|([\~\@\&]))/;
const resultRecordRegex = /^([0-9]*)\^(done|running|connected|error|exit)/;
const newlineRegex = /^\r\n?/;
const endRegex = /^\(gdb\)\r\n?/;
const variableRegex = /^([a-zA-Z_\-][a-zA-Z0-9_\-]*)/;
const asyncClassRegex = /^(.*?),/;

export function parseMI(output: string): MINode {
	/*
		output ==>
			(
				exec-async-output     = [ token ] "*" ("stopped" | others) ( "," variable "=" (const | tuple | list) )* \n
				status-async-output   = [ token ] "+" ("stopped" | others) ( "," variable "=" (const | tuple | list) )* \n
				notify-async-output   = [ token ] "=" ("stopped" | others) ( "," variable "=" (const | tuple | list) )* \n
				console-stream-output = "~" c-string \n
				target-stream-output  = "@" c-string \n
				log-stream-output     = "&" c-string \n
			)*
			[
				[ token ] "^" ("done" | "running" | "connected" | "error" | "exit") ( "," variable "=" (const | tuple | list) )* \n
			]
			"(gdb)" \n
	*/

	let token = undefined;
	let outOfBandRecord = [];
	let resultRecords = undefined;

	let asyncRecordType = {
		"*": "exec",
		"+": "status",
		"=": "notify"
	};
	let streamRecordType = {
		"~": "console",
		"@": "target",
		"&": "log"
	};

	let parseCString = () => {
		if (output[0] != '"')
			return "";
		let stringEnd = 1;
		let inString = true;
		let remaining = output.substr(1);
		let escaped = false;
		while (inString) {
			if (escaped)
				escaped = false;
			else if (remaining[0] == '\\')
				escaped = true;
			else if (remaining[0] == '"')
				inString = false;

			remaining = remaining.substr(1);
			stringEnd++;
		}
		// hax
		let str = JSON.parse(output.substr(0, stringEnd));
		output = output.substr(stringEnd);
		return str;
	};

	let parseValue, parseCommaResult, parseCommaValue, parseResult;

	let parseTupleOrList = () => {
		if (output[0] != '{' && output[0] != '[')
			return undefined;
		let oldContent = output;
		let canBeValueList = output[0] == '[';
		output = output.substr(1);
		if (output[0] == '}' || output[0] == ']')
			return [];
		if (canBeValueList) {
			let value = parseValue();
			if (value) { // is value list
				let values = [];
				values.push(value);
				let remaining = output;
				while (value = parseCommaValue())
					values.push(value);
				output = output.substr(1); // ]
				return values;
			}
		}
		let result = parseResult();
		if (result) {
			let results = [];
			results.push(result);
			while (result = parseCommaResult())
				results.push(result);
			output = output.substr(1); // }
			return results;
		}
		output = (canBeValueList ? '[' : '{') + output;
		return undefined;
	};

	parseValue = () => {
		if (output[0] == '"')
			return parseCString();
		else if (output[0] == '{' || output[0] == '[')
			return parseTupleOrList();
		else
			return undefined;
	};

	parseResult = () => {
		let variableMatch = variableRegex.exec(output);
		if (!variableMatch)
			return undefined;
		output = output.substr(variableMatch[0].length + 1);
		let variable = variableMatch[1];
		return [variable, parseValue()];
	};

	parseCommaValue = () => {
		if (output[0] != ',')
			return undefined;
		output = output.substr(1);
		return parseValue();
	};

	parseCommaResult = () => {
		if (output[0] != ',')
			return undefined;
		output = output.substr(1);
		return parseResult();
	};

	let match = undefined;

	while (match = outOfBandRecordRegex.exec(output)) {
		output = output.substr(match[0].length);
		if (match[1] && token === undefined) {
			token = parseInt(match[1]);
		}

		if (match[2]) {
			let classMatch = asyncClassRegex.exec(output);
			output = output.substr(classMatch[1].length);
			let asyncRecord = {
				isStream: false,
				type: asyncRecordType[match[2]],
				asyncClass: classMatch[1],
				output: []
			};
			let result;
			while (result = parseCommaResult())
				asyncRecord.output.push(result);
			outOfBandRecord.push(asyncRecord);
		}
		else if (match[3]) {
			let streamRecord = {
				isStream: true,
				type: streamRecordType[match[3]],
				content: parseCString()
			};
			outOfBandRecord.push(streamRecord);
		}

		output = output.replace(newlineRegex, "");
	}

	if (match = resultRecordRegex.exec(output)) {
		output = output.substr(match[0].length);
		if (match[1] && token === undefined) {
			token = parseInt(match[1]);
		}
		resultRecords = {
			resultClass: match[2],
			results: []
		};
		let result;
		while (result = parseCommaResult())
			resultRecords.results.push(result);

		output = output.replace(newlineRegex, "");
	}

	return new MINode(token, outOfBandRecord || [], resultRecords);
}