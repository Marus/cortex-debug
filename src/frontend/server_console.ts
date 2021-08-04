import * as net from 'net';
import * as vscode from 'vscode';
import { IMyPtyTerminalOptions, MyPtyTerminal } from './pty';
import { getAnyFreePort, parseHostPort, TerminalInputMode } from '../common';

export class GDBServerConsole {
    protected toBackendServer: net.Server = null;
    protected toBackend: net.Socket = null;
    protected toBackendPort: number = -1;    

    public ptyTerm: MyPtyTerminal = null;
    protected ptyOptions: IMyPtyTerminalOptions;
    static BackendPort: number = -1;

    constructor(public context: vscode.ExtensionContext) {
        this.ptyOptions = {
            name      : 'gdb-server',
            prompt    : '',             // Can't have a prompt since the gdb-server or semihosting may have one
            inputMode : TerminalInputMode.COOKED
        };
        this.ptyOptions.name = GDBServerConsole.createTermName(this.ptyOptions.name, null)
        this.setupTerminal();
    }

    private setupTerminal() {
        this.ptyTerm = new MyPtyTerminal(this.ptyOptions);
        this.ptyTerm.on('close', () => { this.onTerminalClosed(); });
        this.ptyTerm.on('data', (data) => { this.sendToBackend(data); });
        if (this.toBackend === null) {
            this.ptyTerm.write('Waiting for gdb server to start...');
            this.ptyTerm.pause();
        } else {
            this.ptyTerm.write('Resuming connection to gdb server...\n');
            this.ptyTerm.resume();
        }
    }

    private onTerminalClosed() {
        vscode.window.showInformationMessage('gdb-server terminal closed unexpectedly. Trying to reopen it');
        this.setupTerminal();
    }

    public startServer(): Promise<void> {
        return this.initToBackendSocket();
    }

    public isServerAlive() {
        return this.toBackendServer !== null;
    }

    // Create a server for the GDBServer running in the adapter process. Any data
    // from the gdb-server (like OpenOCD) is sent here and sent to the terminal
    // and any usr input in the terminal is sent back (like semi-hosting)
    protected initToBackendSocket() : Promise<void> {
        return new Promise((resolve, reject) => {
            getAnyFreePort(55878).then((p) => {
                this.toBackendPort = p;
                GDBServerConsole.BackendPort = p;
                const newServer = net.createServer(this.onBackendConnect.bind(this));
                newServer.listen(this.toBackendPort, '127.0.0.1', () => {
                    this.toBackendServer = newServer;
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
        console.log('onBackendConnect: gdb-server program connected');
        socket.setKeepAlive(true);
        socket.on('close', () => {
            console.log('onBackendConnect: gdb-server program closed');
            this.ptyTerm.write('GDB server exited. Waiting for next server to start...')
            this.toBackend = null;
            this.ptyTerm.pause();
        });
        socket.on('data', (data) => {
            this.ptyTerm.write(data);
        });
        socket.on('error', (e) => {
            this.ptyTerm.write(`GDBServerConsole: onBackendConnect: gdb-server program client error ${e}`)
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

    static createTermName(want: string, existing: string | null): string {
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
