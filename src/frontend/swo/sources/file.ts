import * as fs from 'fs';
import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { SWOSource } from './common';

export class FileSWOSource extends EventEmitter implements SWOSource {
    public connected: boolean = false;
    private fd: number = null;
    private interval: any = null;

    constructor(private SWOPath: string) {
        super();
        fs.open(SWOPath, 'r', (err, fd) => {
            if (err) {
                vscode.window.showWarningMessage(`Unable to open path: ${SWOPath} - Unable to read SWO data.`);
            }
            else {
                this.fd = fd;
                this.interval = setInterval(this.read.bind(this), 2);
                this.connected = true;
                this.emit('connected');
            }
        });
    }

    private read() {
        const buf: Buffer = Buffer.alloc(64);
        fs.read(this.fd, buf, 0, 64, null, (err, bytesRead, buffer) => {
            if (bytesRead > 0) {
                this.emit('data', buffer.slice(0, bytesRead));
            }
        });
    }

    public dispose() {
        this.emit('disconnected');
        clearInterval(this.interval);
        fs.closeSync(this.fd);
    }
}
