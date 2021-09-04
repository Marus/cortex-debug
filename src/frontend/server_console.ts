import * as net from 'net';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import {IPtyTerminalOptions, magentaWrite, PtyTerminal } from './pty';
import { getAnyFreePort, TerminalInputMode } from '../common';

export class GDBServerConsole {
    protected toBackendServer: net.Server = null;
    protected toBackend: net.Socket = null;
    protected toBackendPort: number = -1;
    protected logFd = -1;

    public ptyTerm: PtyTerminal = null;
    protected ptyOptions: IPtyTerminalOptions;
    public static BackendPort: number = -1;

    constructor(public context: vscode.ExtensionContext) {
        this.ptyOptions = {
            name      : 'gdb-server',
            prompt    : '',             // Can't have a prompt since the gdb-server or semihosting may have one
            inputMode : TerminalInputMode.COOKED
        };
        this.ptyOptions.name = GDBServerConsole.createTermName(this.ptyOptions.name, null);
        this.setupTerminal();
        setTimeout(() => {
            this.ptyTerm.terminal.show();
        }, 10);
        try {
            const tmpdir = os.platform() === 'win32' ? process.env.TEMP || process.env.TMP || '.' : '/tmp';
            const fname = `${tmpdir}/gdb-server-console-${process.pid}`;
            this.logFd = fs.openSync(fname, 'w');
        }
        catch {}
    }

    private setupTerminal() {
        this.ptyTerm = new PtyTerminal(this.ptyOptions);
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
        vscode.window.showInformationMessage('gdb-server terminal closed unexpectedly. Trying to reopen it');
        this.setupTerminal();
    }

    public isServerAlive() {
        return this.toBackendServer !== null;
    }

    protected debugMsg(msg: string) {
        if (true) {
            try {
                msg = 'SERVER CONSOLE DEBUG: ' + msg;
                console.log(msg);
                if (this.ptyTerm) {
                    msg += msg.endsWith('\n') ? '' : '\n';
                    magentaWrite(msg, this.ptyTerm);
                }
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
        this.ptyTerm.resume();
        this.clearTerminal();
        this.debugMsg('onBackendConnect: gdb-server session connected');
        socket.setKeepAlive(true);
        socket.on('close', () => {
            this.debugMsg('onBackendConnect: gdb-server session closed');
            magentaWrite('GDB server session ended. Waiting for next server session to start...', this.ptyTerm);
            this.toBackend = null;
            this.ptyTerm.pause();
        });
        socket.on('data', (data) => {
            this.ptyTerm.write(data);
            try {
                if (this.logFd >= 0) {
                    if (!this.ptyTerm.isReady) {
                        // Maybe we should do our own buffering rather than the pty doing it. This can
                        // help if the user kills the terminal. But we would have lost previous data anyways
                        fs.writeFileSync(this.logFd, '******* Terminal not yet ready, buffering ******');
                    }
                    fs.writeFileSync(this.logFd, data.toString());
                }
            }
            catch (e) {
                this.logFd = -1;
            }
        });
        socket.on('error', (e) => {
            this.debugMsg(`GDBServerConsole: onBackendConnect: gdb-server program client error ${e}`);
        });
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
