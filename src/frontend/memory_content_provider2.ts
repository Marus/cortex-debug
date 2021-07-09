import * as vscode from 'vscode';
import * as tmp from 'tmp';
import * as fs from 'fs';
import * as path from 'path';
import { hexFormat } from './utils';

export class MemoryVSCodeHexEditors {
    public memEditors: MemoryWindowCreator[] = [];

    public updateMemWindows() {
        for (const item of this.memEditors) {
            item.openHexEditor(false);
        }
    }

    public Add(addressExpr: string, lenghStr: string) {
        new MemoryWindowCreator(addressExpr, lenghStr, this);
    }
}

export class MemoryWindowCreator{
    constructor(private addressExpr: string, private lenghStr: string, private container: MemoryVSCodeHexEditors) {
        this.openHexEditor(true);
    }

    public openHexEditor(forceView: boolean) {
        const length: number = MemoryWindowCreator.parseHexOrDecInt(this.lenghStr);
        vscode.debug.activeDebugSession.customRequest('read-memory',
            { address: this.addressExpr, length: length || 32 }).then((data) => {
            // const filePath = path.join(this.tmpDir, uri.fsPath);
            const addrEnc = encodeURIComponent(`${this.addressExpr}`);
            // const fName = `Memory[${addrEnc},${length}].cdmem`;
            const fName = `Memory-${addrEnc}-${length}.cdmem`
            const filePath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, '.vscode', 'cdmem', fName);
            const fsURI = vscode.Uri.parse(`file://${filePath}?baseAddress=${data.startAddress}`);

            try {
                fs.unlinkSync(fsURI.fsPath);
            }
            catch (e) {
                console.log(e);
            }

            vscode.workspace.fs.writeFile(fsURI, Uint8Array.from(data.bytes)).then(() => {
                if (forceView || !MemoryWindowCreator.isAlreadyOpen(fsURI.fsPath)) {                 
                    vscode.commands.executeCommand("vscode.openWith", fsURI, "hexEditor.hexedit", { preview: false });
                    vscode.commands.executeCommand("vscode.removeFromRecentlyOpened", fsURI.fsPath);
                    this.container.memEditors.push(this);
                }
            }, (error) => {
                const msg = (error.message || '') + '\nPerhaps expression for "address" contains invalid file name characters';
                vscode.window.showErrorMessage(`Unable to create/write memory file memory from ${fsURI.toString()}: ${msg}`);
            });
        }, (error) => {
            const msg = error.message || '<Unknown error>';
            vscode.window.showErrorMessage(`Unable to read memory from ${this.addressExpr} of length ${hexFormat(length, 8)}: ${msg}`);
        });
    }

    public static parseHexOrDecInt(str: string): number {
        return str.startsWith('0x') ? parseInt(str.substring(2), 16) : parseInt(str, 10);
    }

    private static isAlreadyOpen(fsPath: string) {
        fsPath = path.normalize(fsPath);
        for (const doc of vscode.workspace.textDocuments) {
            const docPath = path.normalize(doc.fileName);
            if (docPath.endsWith(".cdmem") && (fsPath === docPath)) {
                return true;
            }
        }
        return false;
    }
}
