import * as fs from 'fs';

//
// For callback `cb`, fatal = false when file exists but header does not match. fatal = true means
// we could not even read the file. Use `cb` to print what ever messages you want. It is optional.
//
// Returns true if the ELF header match the elf magic number, false in all other cases
//
export function validateELFHeader(exe: string, cb?: (str: string, fatal: boolean) => void): boolean {
    try {
        if (!fs.existsSync(exe)) {
            if (cb) {
                cb(`File not found "executable": "${exe}"`, true);
            }
            return false;
        }
        const buffer = Buffer.alloc(16);
        const fd = fs.openSync(exe, 'r');
        const n = fs.readSync(fd, buffer, 0, 16, 0);
        fs.closeSync(fd);
        if (n !== 16) {
            if (cb) {
                cb(`Could not read 16 bytes from "executable": "${exe}"`, true);
            }
            return false;
        }
        // First four chars are 0x7f, 'E', 'L', 'F'
        if ((buffer[0] !== 0x7f) || (buffer[1] !== 0x45) || (buffer[2] !== 0x4c) || (buffer[3] !== 0x46)) {
            if (cb) {
                cb(`Not a valid ELF file "executable": "${exe}". Many debug functions can fail or not work properly`, false);
            }
            return false;
        }
        return true;
    }
    catch (e) {
        if (cb) {
            cb(`Could not read file "executable": "${exe}" ${e ? e.toString() : ''}`, true);
        }
        return false;
    }
}
