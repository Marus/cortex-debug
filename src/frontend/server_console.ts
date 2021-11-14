import * as net from 'net';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {IPtyTerminalOptions, magentaWrite, PtyTerminal } from './pty';
import { getAnyFreePort, TerminalInputMode } from '../common';

export class GDBServerConsole {
    protected toBackendServer: net.Server = null;
    protected toBackend: net.Socket = null;
    protected toBackendPort: number = -1;
    protected logFd = -1;
    protected logFName = '';

    public ptyTerm: PtyTerminal = null;
    protected ptyOptions: IPtyTerminalOptions;
    public static BackendPort: number = -1;

    constructor(public context: vscode.ExtensionContext, public logFileName = '') {
        this.ptyOptions = {
            name      : 'gdb-server',
            prompt    : '',             // Can't have a prompt since the gdb-server or semihosting may have one
            inputMode : TerminalInputMode.COOKED
        };

        this.createLogFile(logFileName);
    }

    public createLogFile(logFileName: string) {
        this.logFName = logFileName;
        const showErr = !!this.logFName;

        if (this.logFd >= 0) {
            try {
                fs.closeSync(this.logFd);
            }
            finally {
                this.logFd = -1;
            }
        }

        try {
            if (this.logFName) {
                const dir = path.dirname(this.logFName);
                if (dir) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                this.logFName = this.logFName.replace('${PID}', process.pid.toString());
            } else {
                const tmpdir = os.tmpdir();
                this.logFName = `${tmpdir}/gdb-server-console-${process.pid}.log`;
            }
            this.logFd = fs.openSync(this.logFName, 'w');
        }
        catch (error) {
            if (showErr) {
                vscode.window.showErrorMessage(`Could not open log file: ${this.logFName}\n${error}`);
            }
        }
    }

    protected createAndShowTerminal() {
        if (!this.ptyTerm) {
            this.setupTerminal();
        }
    }

    private setupTerminal() {
        this.ptyOptions.name = GDBServerConsole.createTermName('gdb-server', null);
        this.ptyTerm = new PtyTerminal(this.ptyOptions);
        this.ptyTerm.terminal.show();
        this.ptyTerm.on('close', () => { this.onTerminalClosed(); });
        this.ptyTerm.on('data', (data) => { this.sendToBackend(data); });
        if (this.toBackend === null) {
            magentaWrite('Waiting for gdb server to start...', this.ptyTerm);
            this.ptyTerm.pause();
        } else {
            magentaWrite('Resuming connection to gdb server...\n', this.ptyTerm);
            this.ptyTerm.resume();
        }
    }

    private onTerminalClosed() {
        this.ptyTerm = null;
        if (this.toBackend) {
            // Let the terminal close completely and try to re-launch
            setTimeout(() => {
                vscode.window.showInformationMessage('gdb-server terminal closed unexpectedly. Trying to reopen it');
                this.setupTerminal();
            }, 1);
        }
    }

    public isServerAlive() {
        return this.toBackendServer !== null;
    }

    protected debugMsg(msg: string) {
        if (true) {
            try {
                const date = new Date();
                msg = `[${date.toISOString()}] SERVER CONSOLE DEBUG: ` + msg;
                console.log(msg);
                if (this.ptyTerm) {
                    msg += msg.endsWith('\n') ? '' : '\n';
                    magentaWrite(msg, this.ptyTerm);
                }
                this.logData(msg);
            }
            finally {}
        }
    }

    // Create a server for the GDBServer running in the adapter process. Any data
    // from the gdb-server (like OpenOCD) is sent here and sent to the terminal
    // and any usr input in the terminal is sent back (like semi-hosting)
    public startServer(): Promise<void> {
        return new Promise((resolve, reject) => {
            getAnyFreePort(55878).then((p) => {
                this.toBackendPort = p;
                const newServer = net.createServer(this.onBackendConnect.bind(this));
                newServer.listen(this.toBackendPort, '127.0.0.1', () => {
                    this.toBackendServer = newServer;
                    GDBServerConsole.BackendPort = this.toBackendPort;
                    resolve();
                });
                newServer.on(('error'), (e) => {
                    console.error(e);
                    reject(e);
                });
                newServer.on('close', () => {
                    this.toBackendServer = null;
                });
            });
        });
    }

    // The gdb-server running in the backend
    protected onBackendConnect(socket: net.Socket) {
        this.toBackend = socket;
        this.createAndShowTerminal();
        this.ptyTerm.resume();
        this.clearTerminal();
        this.debugMsg('onBackendConnect: gdb-server session connected');
        socket.setKeepAlive(true);
        socket.on('close', () => {
            this.debugMsg('onBackendConnect: gdb-server session closed');
            magentaWrite('GDB server session ended. This terminal will be reused, waiting for next session to start...', this.ptyTerm);
            this.toBackend = null;
            this.ptyTerm.pause();
        });
        socket.on('data', (data) => {
            this.ptyTerm.write(data);
            this.logData(data);
        });
        socket.on('error', (e) => {
            this.debugMsg(`GDBServerConsole: onBackendConnect: gdb-server program client error ${e}`);
        });
    }

    private logData(data: Buffer | string) {
        try {
            if (this.logFd >= 0) {
                if (!this.ptyTerm.isReady) {
                    // Maybe we should do our own buffering rather than the pty doing it. This can
                    // help if the user kills the terminal. But we would have lost previous data anyways
                    const date = new Date();
                    const msg = `[${date.toISOString()}] SERVER CONSOLE DEBUG: ******* Terminal not yet ready, buffering... ******`;
                    console.log(msg);
                    // fs.writeFileSync(this.logFd, msg);
                }
                fs.writeFileSync(this.logFd, data.toString());
                fs.fdatasyncSync(this.logFd);
            }
        }
        catch (e) {
            this.logFd = -1;
        }
    }

    public sendToBackend(data: string | Buffer) {
        if (this.toBackend) {
            this.toBackend.write(data.toString());
            this.toBackend.uncork();
        }
    }

    public clearTerminal() {
        this.ptyTerm.clearTerminalBuffer();
    }

    private static createTermName(want: string, existing: string | null): string {
        let ret = want;
        let count = 1;
        while (vscode.window.terminals.findIndex((t) => t.name === ret) >= 0) {
            if (existing === ret) {
                return existing;
            }
            ret = `${want}-${count}`;
            count = count + 1;
        }
        return ret;
    }

    public dispose() {
        if (this.toBackend) {
            this.toBackend.destroy();
            this.toBackend = null;
        }
        if (this.ptyTerm) {
            this.ptyTerm.dispose();
            this.ptyTerm = null;
        }
    }
}
