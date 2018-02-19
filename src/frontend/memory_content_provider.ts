import * as vscode from 'vscode';
import { hexFormat } from './utils';

export class MemoryContentProvider implements vscode.TextDocumentContentProvider {
    public provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): Thenable<string> {
        return new Promise((resolve, reject) => {
            const highlightAt = -1;
            const query = this.parseQuery(uri.query);
            
            const address: number = query['address'].startsWith('0x') ? parseInt(query['address'].substring(2), 16) : parseInt(query['address'], 10);
            const length: number = query['length'].startsWith('0x') ? parseInt(query['length'].substring(2), 16) : parseInt(query['length'], 10);
            
            vscode.debug.activeDebugSession.customRequest('read-memory', { address: address, length: length || 32 }).then((data) => {
                const bytes = data.bytes;
                
                let lineAddress = address - (address % 16);
                const lineLength = 16;
                const offset = address - lineAddress;

                let output = '';
                output += '  Offset: 00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F 	\n';
                output += hexFormat(lineAddress, 8, false) + ': ';

                let lineend = '';

                for (let i = 0; i < offset; i++) { output += '   '; lineend += ' '; }

                for (let i = 0; i < length; i++) {
                    const byte = bytes[i];
                    output += hexFormat(byte, 2, false).toUpperCase() + ' ';
                    if (byte <= 32 || (byte >= 127 && byte <= 159)) {
                        lineend += '.';
                    }
                    else {
                        lineend	+= String.fromCharCode(bytes[i]);
                    }

                    if ((address + i) % 16 === 15 && i < length - 1) {
                        output += '  ' + lineend;
                        lineend = '';
                        output += '\n';
                        lineAddress += 16;
                        output += hexFormat(lineAddress, 8, false) + ': ';
                    }
                }

                const endaddress = address + length;
                const extra = (16 - (endaddress % 16)) % 16;

                for (let i = 0; i < extra; i++) { output += '   '; }
                output += '  ' + lineend;
                output += '\n';

                resolve(output);
            }, (error) => {
                vscode.window.showErrorMessage(`Unable to read memory from ${hexFormat(address, 8)} to ${hexFormat(address + length, 8)}`);
                reject(error.toString());
            });
        });
    }

    private parseQuery(queryString) {
        const query = {};
        const pairs = (queryString[0] === '?' ? queryString.substr(1) : queryString).split('&');
        for (const pairstr of pairs) {
            const pair = pairstr.split('=');
            query[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || '');
        }
        return query;
    }
}
