/**
 * A significant portion of this module is taken from 
 * [hexdump](https://github.com/stef-levesque/vscode-hexdump/),
 * which has the following copyright:
 * 
 * Copyright © 2016 Stef Levesque
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the “Software”), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';

import { sprintf } from 'sprintf-js';
import * as hexy from 'hexy';
import { hexFormat } from './utils';

export class MemoryContentProvider implements vscode.TextDocumentContentProvider {
	private _onDidChange = new vscode.EventEmitter<vscode.Uri>();

    public provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): Thenable<string> {
        const config = vscode.workspace.getConfiguration('cortex-debug').memoryDump;
        const hexLineLength = config['width'] * 2;
        const firstByteOffset = config['showAddress'] ? 10 : 0;
        const lastByteOffset = firstByteOffset + hexLineLength + hexLineLength / config['nibbles'] - 1;
        const firstAsciiOffset = lastByteOffset + (config['nibbles'] == 2 ? 4 : 2);
        const lastAsciiOffset = firstAsciiOffset + config['width'];
        const charPerLine = lastAsciiOffset + 1;
        const sizeWarning = config['sizeWarning'];
        const sizeDisplay = config['sizeDisplay'];

        return new Promise( (resolve, reject)=> {
            let query = this.parseQuery(uri.query);
			
            let address: number = query['address'].startsWith('0x') ? 
                                    parseInt(query['address'].substring(2), 16) : 
                                    parseInt(query['address'], 10);
            let length: number = query['length'].startsWith('0x') ? 
                                    parseInt(query['length'].substring(2), 16) : 
                                    parseInt(query['length'], 10);

            let hexyFmt = {
                format      : config['nibbles'] == 8 ? 'eights' : 
                            config['nibbles'] == 4 ? 'fours' : 
                            'twos',
                width       : config['width'],
                caps        : config['uppercase'] ? 'upper' : 'lower',
                numbering   : config['showAddress'] ? "hex_digits" : "none",
                annotate    : config['showAscii'] ? "ascii" : "none",
                length      : sizeDisplay,
                display_offset: address
            };
            let header = config['showOffset'] ? this.getHeader(config['showAddress'], config['width'], config['nibbles']) : "";

            vscode.debug.activeDebugSession
                .customRequest('read-memory', { address: address, length: length || 32 })
                .then((data) => {
                    let buffer = new Buffer(data.bytes)
                    let hexString = header;
                    hexString += hexy.hexy(buffer, hexyFmt).toString();
                    resolve(hexString);
                }, (error) => {
                    vscode.window.showErrorMessage(`Unable to read memory from ${hexFormat(address, 8)} to ${hexFormat(address + length, 8)}`);
                    reject(error.toString());
                })
        });
    }

    private parseQuery(queryString) {
		var query = {};
		var pairs = (queryString[0] === '?' ? queryString.substr(1) : queryString).split('&');
		for (var i = 0; i < pairs.length; i++) {
			var pair = pairs[i].split('=');
			query[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || '');
		}
		return query;
	}

    private getHeader(showAddress: boolean, width: number, nibbles: number): string {
        const config = vscode.workspace.getConfiguration('cortex-debug').memoryDump;
        let header = showAddress ? "  Offset: " : "";

        for (var i = 0; i < config['width']; ++i) {
            header += sprintf('%02X', i);
            if ((i+1) % (config['nibbles'] / 2) == 0) {
                header += ' ';
            }
        }

        header += "\t\n";
        return header;
	}
	
	get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }
    
    public update(uri: vscode.Uri) {
        this._onDidChange.fire(uri);
    }
}