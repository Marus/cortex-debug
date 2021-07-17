import * as fs from 'fs';
import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { SWORTTSource } from './common';

export class FileSWOSource extends EventEmitter implements SWORTTSource {
    public connected: boolean = false;
    private fd: number = null;
    private interval: any = null;

    constructor(private SWOPath: string, private timeout: number = 500) {
        super();

        // We are on a reading end and a file may not have yet been created. Could have used
        // a file watcher but we may run out of handles (VSCode uses a LOT of them). Also,
        // intentionally did not use setInterval to progressively wait longer and not let
        // setInterval callbacks stackup
        const start = Date.now();
        function openFile(retryTime = 1) {
            if ((timeout <= 0) || fs.existsSync(SWOPath)) {
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
            } else if (timeout > 0) {
                const delta = Date.now() - start;
                if (delta >= timeout) {
                    vscode.window.showWarningMessage(`SWO File ${SWOPath} does not exist even after timeout of ${timeout}ms.`);
                } else {
                    setTimeout(openFile, Math.min(10, retryTime+1));
                }
            }
        }
        openFile(1);
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
