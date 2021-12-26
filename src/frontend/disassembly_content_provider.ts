import * as vscode from 'vscode';
import { DisassemblyInstruction } from '../common';
import { CortexDebugExtension } from './extension';

export class DisassemblyContentProvider implements vscode.TextDocumentContentProvider {
    public provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): Thenable<string> {
        return new Promise((resolve, reject) => {
            let funcName: string;
            let file: string;
            const path = uri.path;
            const pathParts = path.substring(1, path.length - 6).split(':::');
            
            if (pathParts.length === 1) {
                file = null;
                funcName = pathParts[0];
            }
            else {
                file = pathParts[0];
                funcName = pathParts[1];
            }
            
            const session = CortexDebugExtension.getActiveCDSession();
            if (session) {
                session.customRequest('disassemble', { function: funcName, file: file }).then((data) => {
                    const instructions: DisassemblyInstruction[] = data.instructions;

                    let output = '';
                    instructions.forEach((i) => {
                        output += `${i.address}: ${this.padEnd(15, i.opcodes)} \t${i.instruction}\n`;
                    });

                    resolve(output);
                }, (error) => {
                    vscode.window.showErrorMessage(error.message);
                    reject(error.message);
                });
            } else {
                reject(new Error('DisassemblyContentProvider: unknown debug session type'));
            }
        });
    }

    private padEnd(len: number, value: string): string {
        for (let i = value.length; i < len; i++) { value += ' '; }
        return value;
    }
}
