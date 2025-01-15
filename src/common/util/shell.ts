import * as os from 'os';
import * as path from 'path';

// Both arguments are expected to be full path names
export function getPathRelative(base: string, target: string) {
    if (os.platform() === 'win32') {
        base = base.replace(/\\/g, '/');
        target = target.replace(/\\/g, '/');
    }
    if (!path.isAbsolute(base) || !path.isAbsolute(target)) {
        return target;
    }
    const baseElts = base.split('/');
    const targetElts = target.split('/');
    if (!base || !target || (base.length > target.length) || (baseElts[0] !== targetElts[0])) {
        // Roots don't even match or base is larger than the target, so no point
        return target;
    }
    while (baseElts.length && targetElts.length) {
        if (baseElts[0] !== targetElts[0]) {
            break;
        }
        baseElts.shift();
        targetElts.shift();
    }
    if (baseElts.length === 0) {
        return './' + targetElts.join('/');
    }
    if (baseElts.length > 4) {
        return target;
    }
    while (baseElts.length) {
        targetElts.unshift('..');
        baseElts.shift();
    }
    const ret = targetElts.join('/');
    return ret;
}

// This is not very precise. It is for seeing if the string has any special characters
// where will need to put the string in quotes as a precaution. This is more a printing
// aid rather an using for an API
export function quoteShellAndCmdChars(s): string {
    const quote = /[\s\"\*\[\]!@#$%^&*\(\)\\:]/g.test(s) ? '"' : '';
    s = s.replace(/"/g, '\\"').replace(/\\/g, '\\\\');
    return quote + s.replace(/"/g, '\\"') + quote;
}

export function quoteShellCmdLine(list: string[]): string {
    return list.map((s) => quoteShellAndCmdChars(s)).join(' ');
}
