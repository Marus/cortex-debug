import { MINode } from './mi_parse';

const resultRegex = /^([a-zA-Z_\-][a-zA-Z0-9_\-]*|\[\d+\])\s*=\s*/;
const variableRegex = /^[a-zA-Z_\-][a-zA-Z0-9_\-]*/;
const errorRegex = /^\<.+?\>/;
const referenceStringRegex = /^(0x[0-9a-fA-F]+\s*)"/;
const referenceRegex = /^0x[0-9a-fA-F]+/;
const nullpointerRegex = /^0x0+\b/;
const charRegex = /^(\d+) ['"]/;
const numberRegex = /^\d+(\.\d+)?/;
const pointerCombineChar = '.';

export function isExpandable(value: string): number {
    let match;
    value = value.trim();
    if (value.length === 0) { return 0; }
    else if (value.startsWith('{...}')) { return 2; } // lldb string/array
    else if (value[0] === '{') { return 1; } // object
    else if (value.startsWith('true')) { return 0; }
    else if (value.startsWith('false')) { return 0; }
    else if (match = nullpointerRegex.exec(value)) { return 0; }
    else if (match = referenceStringRegex.exec(value)) { return 0; }
    else if (match = referenceRegex.exec(value)) { return 2; } // reference
    else if (match = charRegex.exec(value)) { return 0; }
    else if (match = numberRegex.exec(value)) { return 0; }
    else if (match = variableRegex.exec(value)) { return 0; }
    else if (match = errorRegex.exec(value)) { return 0; }
    else { return 0; }
}

// tslint:disable-next-line:ban-types
export function expandValue(variableCreate: Function, value: string, root: string = '', extra?: any): any {
    const parseCString = () => {
        value = value.trim();
        if (value[0] !== '"' && value[0] !== '\'') {
            return '';
        }
        let stringEnd = 1;
        let inString = true;
        const charStr = value[0];
        let remaining = value.substr(1);
        let escaped = false;
        while (inString) {
            if (escaped) {
                escaped = false;
            }
            else if (remaining[0] === '\\') {
                escaped = true;
            }
            else if (remaining[0] === charStr) {
                inString = false;
            }

            remaining = remaining.substr(1);
            stringEnd++;
        }
        const str = value.substr(0, stringEnd).trim();
        value = value.substr(stringEnd).trim();
        return str;
    };

    const stack = [root];
    let parseValue;
    let parseCommaResult;
    let parseCommaValue;
    let parseResult;
    let createValue;
    let variable = '';

    const getNamespace = (variable) => {
        let namespace = '';
        let prefix = '';
        stack.push(variable);
        stack.forEach((name) => {
            prefix = '';
            if (name !== '') {
                if (name.startsWith('[')) {
                    namespace = namespace + name;
                }
                else {
                    if (namespace) {
                        while (name.startsWith('*')) {
                            prefix += '*';
                            name = name.substr(1);
                        }
                        namespace = namespace + pointerCombineChar + name;
                    }
                    else {
                        namespace = name;
                    }
                }
            }
        });
        stack.pop();
        return prefix + namespace;
    };

    const parseTupleOrList = () => {
        value = value.trim();
        if (value[0] !== '{') {
            return undefined;
        }
        const oldContent = value;
        value = value.substr(1).trim();
        if (value[0] === '}') {
            value = value.substr(1).trim();
            return [];
        }
        if (value.startsWith('...')) {
            value = value.substr(3).trim();
            if (value[0] === '}') {
                value = value.substr(1).trim();
                return '<...>' as any;
            }
        }
        const eqPos = value.indexOf('=');
        const newValPos1 = value.indexOf('{');
        const newValPos2 = value.indexOf(',');
        let newValPos = newValPos1;
        if (newValPos2 !== -1 && newValPos2 < newValPos1) {
            newValPos = newValPos2;
        }
        if (newValPos !== -1 && eqPos > newValPos || eqPos === -1) { // is value list
            const values = [];
            stack.push('[0]');
            let val = parseValue();
            stack.pop();
            values.push(createValue('[0]', val));
            const remaining = value;
            let i = 0;
            while (true) {
                stack.push('[' + (++i) + ']');
                if (!(val = parseCommaValue())) {
                    stack.pop();
                    break;
                }
                stack.pop();
                values.push(createValue('[' + i + ']', val));
            }
            value = value.substr(1).trim(); // }
            return values;
        }

        let result = parseResult(true);
        if (result) {
            const results = [];
            results.push(result);
            while (result = parseCommaResult(true)) {
                results.push(result);
            }
            value = value.substr(1).trim(); // }
            return results;
        }

        return undefined;
    };

    const parsePrimitive = () => {
        let primitive: any;
        let match;
        value = value.trim();
        if (value.length === 0) {
            primitive = undefined;
        }
        else if (value.startsWith('true')) {
            primitive = 'true';
            value = value.substr(4).trim();
        }
        else if (value.startsWith('false')) {
            primitive = 'false';
            value = value.substr(5).trim();
        }
        else if (match = nullpointerRegex.exec(value)) {
            primitive = '<nullptr>';
            value = value.substr(match[0].length).trim();
        }
        else if (match = referenceStringRegex.exec(value)) {
            value = value.substr(match[1].length).trim();
            primitive = parseCString();
        }
        else if (match = referenceRegex.exec(value)) {
            primitive = '*' + match[0];
            value = value.substr(match[0].length).trim();
        }
        else if (match = charRegex.exec(value)) {
            primitive = match[1];
            value = value.substr(match[0].length - 1);
            primitive += ' ' + parseCString();
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
            primitive = value;
        }
        return primitive;
    };

    parseValue = () => {
        value = value.trim();
        if (value[0] === '"') {
            return parseCString();
        }
        else if (value[0] === '{') {
            return parseTupleOrList();
        }
        else {
            return parsePrimitive();
        }
    };

    parseResult = (pushToStack: boolean = false) => {
        value = value.trim();
        const variableMatch = resultRegex.exec(value);
        if (!variableMatch) {
            return undefined;
        }
        value = value.substr(variableMatch[0].length).trim();
        const name = variable = variableMatch[1];
        if (pushToStack) {
            stack.push(variable);
        }
        const val = parseValue();
        if (pushToStack) {
            stack.pop();
        }
        return createValue(name, val);
    };

    createValue = (name, val) => {
        let ref = 0;
        if (typeof val === 'object') {
            ref = variableCreate(val);
            val = 'Object';
        }
        if (typeof val === 'string' && val.startsWith('*0x')) {
            if (extra && MINode.valueOf(extra, 'arg') === '1')
            {
                ref = variableCreate(getNamespace('*(' + name), { arg: true });
                val = '<args>';
            }
            else
            {
                ref = variableCreate(getNamespace('*' + name));
                val = 'Object@' + val;
            }
        }
        if (typeof val === 'string' && val.startsWith('<...>')) {
            ref = variableCreate(getNamespace(name));
            val = '...';
        }
        return {
            name: name,
            value: val,
            variablesReference: ref
        };
    };

    parseCommaValue = () => {
        value = value.trim();
        if (value[0] !== ',') {
            return undefined;
        }
        value = value.substr(1).trim();
        return parseValue();
    };

    parseCommaResult = (pushToStack: boolean = false) => {
        value = value.trim();
        if (value[0] !== ',') {
            return undefined;
        }
        value = value.substr(1).trim();
        return parseResult(pushToStack);
    };

    value = value.trim();
    return parseValue();
}
