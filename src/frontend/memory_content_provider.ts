import * as vscode from 'vscode';
import { hexFormat } from './utils';

export class MemoryContentProvider implements vscode.TextDocumentContentProvider {
    // tslint:disable-next-line:variable-name
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    public readonly onDidChange = this._onDidChange.event;

    public provideTextDocumentContent(uri: vscode.Uri): Thenable<string> {
        return new Promise((resolve, reject) => {
            const highlightAt = -1;
            const query = this.parseQuery(uri.query);
            
            const addressExpr = query['address'];
            const length: number = this.parseHexOrDecInt(query['length']);

            vscode.debug.activeDebugSession.customRequest('read-memory', { address: addressExpr, length: length || 32 }).then((data) => {
                const bytes = data.bytes;
                const address = this.parseHexOrDecInt(data.startAddress);
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
                const msg = error.message || '';
                vscode.window.showErrorMessage(`Unable to read memory from ${addressExpr} of length ${hexFormat(length, 8)}: ${msg}`);
                reject(error.toString());
            });
        });
    }

    public update(doc: vscode.TextDocument) {
        this._onDidChange.fire(doc.uri);
    }

    private parseQuery(queryString) {
        const query = {};
        function addToQuery(str: string) {
            const pair = str.split('=');
            const name = pair.shift();      // First part is name
            query[name] = pair.join('=');   // Rest is the value
        }
        // THe API has already decoded the Uri or else we could have just split on '&' and '=' and be order-independent
        // We know that we will have three parameters and it is the first one that will have complex stuff in it
        const pairs = (queryString[0] === '?' ? queryString.substr(1) : queryString).split('&');
        addToQuery(pairs.pop());            // get timestamp
        addToQuery(pairs.pop());            // get length
        addToQuery(pairs.join('&'));        // Rest is the addr-expression
        return query;
    }

    private parseHexOrDecInt(str: string): number {
        return str.startsWith('0x') ? parseInt(str.substring(2), 16) : parseInt(str, 10);
    }

    /**
     * The code below took significant portions with small modification 
     * from the HexDump extension, which has the following license and copyright:
     * The MIT License (MIT)
     * **Copyright © 2016 Stef Levesque**
     */
    public firstBytePos = 10;
    public lastBytePos: number = this.firstBytePos + 3 * 16 - 1;
    public firstAsciiPos: number = this.lastBytePos + 3;
    public lastAsciiPos: number = this.firstAsciiPos + 16;

    private getOffset(pos: vscode.Position): number {
        // check if within a valid section
        if (pos.line < 1 || pos.character < this.firstBytePos) {
            return;
        }
    
        let offset = (pos.line - 1) * 16;
        const s = pos.character - this.firstBytePos;
        if (pos.character >= this.firstBytePos && pos.character <= this.lastBytePos) {
            // byte section
            offset += Math.floor(s / 3);
        } else if (pos.character >= this.firstAsciiPos) {
            // ascii section
            offset += (pos.character - this.firstAsciiPos);
        }
        return offset;
    }

    private getPosition(offset: number, ascii: boolean = false): vscode.Position {
        const row = 1 + Math.floor(offset / 16);
        let column = offset % 16;
    
        if (ascii) {
            column += this.firstAsciiPos;
        } else {
            column = this.firstBytePos + column * 3;
        }
    
        return new vscode.Position(row, column);
    }

    private getRanges(startOffset: number, endOffset: number, ascii: boolean): vscode.Range[] {
        const startPos = this.getPosition(startOffset, ascii);
        let endPos = this.getPosition(endOffset, ascii);
        endPos = new vscode.Position(endPos.line, endPos.character + (ascii ? 1 : 2));
    
        const ranges = [];
        const firstOffset = ascii ? this.firstAsciiPos : this.firstBytePos;
        const lastOffset = ascii ? this.lastAsciiPos : this.lastBytePos;
        for (let i = startPos.line; i <= endPos.line; ++i) {
            const start = new vscode.Position(i, (i === startPos.line ? startPos.character : firstOffset));
            const end = new vscode.Position(i, (i === endPos.line ? endPos.character : lastOffset));
            ranges.push(new vscode.Range(start, end));
        }

        return ranges;
    }
    
    private smallDecorationType = vscode.window.createTextEditorDecorationType({
        borderWidth: '1px',
        borderStyle: 'solid',
        overviewRulerColor: 'blue',
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        light: { // this color will be used in light color themes
            borderColor: 'darkblue'
        },
        dark: { // this color will be used in dark color themes
            borderColor: 'lightblue'
        }
    });

    public handleSelection(e: vscode.TextEditorSelectionChangeEvent) {
        const numLine = e.textEditor.document.lineCount;
        if (e.selections[0].start.line + 1 === numLine ||
            e.selections[0].end.line + 1 === numLine) {
            e.textEditor.setDecorations(this.smallDecorationType, []);
            return;
        }
        const startOffset = this.getOffset(e.selections[0].start);
        const endOffset = this.getOffset(e.selections[0].end);
        if (typeof startOffset === 'undefined' ||
            typeof endOffset === 'undefined') {
            e.textEditor.setDecorations(this.smallDecorationType, []);
            return;
        }
        
        let ranges = this.getRanges(startOffset, endOffset, false);
        ranges = ranges.concat(this.getRanges(startOffset, endOffset, true));
        e.textEditor.setDecorations(this.smallDecorationType, ranges);
    }
}
