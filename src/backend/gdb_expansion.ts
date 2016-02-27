/*
	{
		quit = false,
		_views = {
			{
				view = 0x7ffff7ece1e8,
				renderer = 0x7ffff7eccc50,
				world = 0x7ffff7ece480
			}
		},
		deltaTimer = {
			_flagStarted = false,
			_timeStart = {length = 0},
			_timeMeasured = {length = 0}
		},
		_start = {callbacks = 0x0},
		_stop = {callbacks = 0x0}
	}
*/

const resultRegex = /^([a-zA-Z_\-][a-zA-Z0-9_\-]*)\s*=\s*/;
const variableRegex = /^[a-zA-Z_\-][a-zA-Z0-9_\-]*/;
const errorRegex = /^\<.+?\>/;
const referenceRegex = /^0x[0-9a-fA-F]+/;
const numberRegex = /^[0-9]+/;

export function isExpandable(value: string): number {
	let primitive: any;
	let match;
	value = value.trim();
	if (value.length == 0) return 0;
	else if (value[0] == '{') return 1; // object
	else if (value.startsWith("true")) return 0;
	else if (value.startsWith("false")) return 0;
	else if (value.startsWith("0x0")) return 0;
	else if (match = referenceRegex.exec(value)) return 2; // reference
	else if (match = numberRegex.exec(value)) return 0;
	else if (match = variableRegex.exec(value)) return 0;
	else if (match = errorRegex.exec(value)) return 0;
	else return 0;
}

export function expandValue(variableCreate: Function, value: string): any {
	let parseCString = () => {
		value = value.trim();
		if (value[0] != '"')
			return "";
		let stringEnd = 1;
		let inString = true;
		let remaining = value.substr(1);
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
		let str = value.substr(0, stringEnd).trim();
		value = value.substr(stringEnd).trim();
		return str;
	};

	let parseValue, parseCommaResult, parseCommaValue, parseResult, createValue;

	let parseTupleOrList = () => {
		value = value.trim();
		if (value[0] != '{')
			return undefined;
		let oldContent = value;
		value = value.substr(1).trim();
		if (value[0] == '}')
			return [];
		let eqPos = value.indexOf("=");
		let newValPos1 = value.indexOf("{");
		let newValPos2 = value.indexOf(",");
		let newValPos = newValPos1;
		if (newValPos2 != -1 && newValPos2 < newValPos1)
			newValPos = newValPos2;
		if (newValPos != -1 && eqPos > newValPos || eqPos == -1) { // is value list
			let values = [];
			let val = parseValue();
			values.push(createValue("[0]", val));
			let remaining = value;
			let i = 0;
			while (val = parseCommaValue())
				values.push(createValue("[" + (++i) + "]", val));
			value = value.substr(1).trim(); // }
			return values;
		}

		let result = parseResult();
		if (result) {
			let results = [];
			results.push(result);
			while (result = parseCommaResult())
				results.push(result);
			value = value.substr(1).trim(); // }
			return results;
		}

		return undefined;
	};

	let parsePrimitive = () => {
		let primitive: any;
		let match;
		value = value.trim();
		if (value.length == 0)
			primitive = undefined;
		else if (value.startsWith("true")) {
			primitive = "true";
			value = value.substr(4).trim();
		}
		else if (value.startsWith("false")) {
			primitive = "false";
			value = value.substr(5).trim();
		}
		else if (value.startsWith("0x0")) {
			primitive = "<nullptr>";
			value = value.substr(3).trim();
		}
		else if (match = referenceRegex.exec(value)) {
			primitive = "*" + match[0];
			value = value.substr(match[0].length).trim();
		}
		else if (match = numberRegex.exec(value)) {
			primitive = match[0];
			value = value.substr(match[0].length).trim();
		}
		else if (match = variableRegex.exec(value)) {
			primitive = match[0];
			value = value.substr(match[0].length).trim();
		}
		else if (match = errorRegex.exec(value)) {
			primitive = match[0];
			value = value.substr(match[0].length).trim();
		}
		else {
			primitive = "<???>";
		}
		return primitive;
	};

	parseValue = () => {
		value = value.trim();
		if (value[0] == '"')
			return parseCString();
		else if (value[0] == '{')
			return parseTupleOrList();
		else
			return parsePrimitive();
	};

	parseResult = () => {
		value = value.trim();
		let variableMatch = resultRegex.exec(value);
		if (!variableMatch)
			return undefined;
		value = value.substr(variableMatch[0].length).trim();
		let variable = variableMatch[1];
		let val = parseValue();
		return createValue(variable, val);
	};

	createValue = (name, val) => {
		let ref = 0;
		if (typeof val == "object") {
			ref = variableCreate(val);
			val = "Object";
		}
		if (typeof val == "string" && val.startsWith("*0x")) {
			ref = variableCreate("*" + name);
			val = "Object@" + val;
		}
		return {
			name: name,
			value: val,
			variablesReference: ref
		};
	};

	parseCommaValue = () => {
		value = value.trim();
		if (value[0] != ',')
			return undefined;
		value = value.substr(1).trim();
		return parseValue();
	};

	parseCommaResult = () => {
		value = value.trim();
		if (value[0] != ',')
			return undefined;
		value = value.substr(1).trim();
		return parseResult();
	};


	value = value.trim();
	return parseValue();
}