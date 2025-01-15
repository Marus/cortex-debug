import * as net from 'net';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IPtyTerminalOptions, magentaWrite, PtyTerminal } from './pty';
import { TerminalInputMode } from '@common/types';
import { getAnyFreePort } from '@common/util';

//      vscode.commands.executeCommand('workbench.action.terminal.renameWithArg', { name: 'myName' });

let consoleLogFd = -1;
export class GDBServerConsoleInstance {
    protected static allConsoles: GDBServerConsoleInstance[] = [];
    public ptyTerm: PtyTerminal = null;
    protected ptyOptions: IPtyTerminalOptions;
    protected toBackend: net.Socket = null;

    private constructor() {
        this.ptyOptions = {
            name      : 'gdb-server',
            prompt    : '',             // Can't have a prompt since the gdb-server or semihosting may have one
            inputMode : TerminalInputMode.COOKED
        };
    }

    public static newOrExistingConsole(): GDBServerConsoleInstance {
        let inst = GDBServerConsoleInstance.allConsoles.find((c) => c.isClosed());
        if (inst) {
            return inst;
        }
        inst = new GDBServerConsoleInstance();
        GDBServerConsoleInstance.allConsoles.push(inst);
        return inst;
    }

    public static disposeAll() {
        const saved = GDBServerConsoleInstance.allConsoles;
        GDBServerConsoleInstance.allConsoles = [];
        for (const c of saved) {
            if (c.toBackend) {
                c.toBackend.destroy();
                c.toBackend = null;
            }
            if (c.ptyTerm) {
                c.ptyTerm.dispose();
            }
        }
    }

    public newBackendConnection(socket: net.Socket) {
        this.createAndShowTerminal();
        this.toBackend = socket;
        this.ptyTerm.resume();
        this.clearTerminal();
        this.debugMsg('onBackendConnect: gdb-server session connected. You can switch to "DEBUG CONSOLE" to see GDB interactions.');
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
            this.toBackend = null;
            this.ptyTerm.pause();
        });
    }

    public isClosed() {
        return this.toBackend === null;
    }

    protected createAndShowTerminal() {
        if (!this.ptyTerm) {
            this.setupTerminal();
        }
    }

    public clearTerminal() {
        this.ptyTerm.clearTerminalBuffer();
    }

    private setupTerminal() {
        this.ptyOptions.name = GDBServerConsoleInstance.createTermName(this.ptyOptions.name, null);
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
            }, 10);
        }
    }

    public sendToBackend(data: string | Buffer) {
        if (this.toBackend) {
            this.toBackend.write(data.toString());
            this.toBackend.uncork();
        }
    }

    public logData(data: Buffer | string) {
         GDBServerConsole.logDataStatic(this.ptyTerm, data);
    }

    public debugMsg(msg: string) {
        GDBServerConsole.debugMsgStatic(this.ptyTerm, msg);
    }

    public static createTermName(want: string, existing: string | null): string {
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
}

export class GDBServerConsole {
    protected toBackendServer: net.Server = null;
    protected toBackend: net.Socket = null;
    protected toBackendPort: number = -1;
    protected logFName = '';
    protected allConsoles: GDBServerConsoleInstance[] = [];
    public static BackendPort: number = -1;

    constructor(public context: vscode.ExtensionContext, public logFileName = '') {
        this.createLogFile(logFileName);
    }

    public createLogFile(logFileName: string) {
        this.logFName = logFileName;
        const showErr = !!this.logFName;

        if (consoleLogFd >= 0) {
            try {
                fs.closeSync(consoleLogFd);
            }
            finally {
                consoleLogFd = -1;
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
            consoleLogFd = fs.openSync(this.logFName, 'w');
        }
        catch (error) {
            if (showErr) {
                vscode.window.showErrorMessage(`Could not open log file: ${this.logFName}\n${error}`);
            }
        }
    }

    public isServerAlive() {
        return this.toBackendServer !== null;
    }

    public static debugMsgStatic(ptyTerm: PtyTerminal, msg: string) {
        try {
            const date = new Date();
            msg = `[${date.toISOString()}] SERVER CONSOLE DEBUG: ` + msg;
            // console.log(msg);
            if (ptyTerm) {
                msg += msg.endsWith('\n') ? '' : '\n';
                magentaWrite(msg, ptyTerm);
            }
            GDBServerConsole.logDataStatic(ptyTerm, msg);
        }
        finally {}
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

    // The gdb-server running in the backend (debug adapter)
    protected onBackendConnect(socket: net.Socket) {
        const inst = GDBServerConsoleInstance.newOrExistingConsole();
        inst.newBackendConnection(socket);
    }

    public static logDataStatic(ptyTerm: PtyTerminal, data: Buffer | string) {
        try {
            if (consoleLogFd >= 0) {
                if (!ptyTerm || !ptyTerm.isReady) {
                    // Maybe we should do our own buffering rather than the pty doing it. This can
                    // help if the user kills the terminal. But we would have lost previous data anyways
                    const date = new Date();
                    const msg = `[${date.toISOString()}] SERVER CONSOLE DEBUG: ******* Terminal not yet ready, buffering... ******`;
                    // console.log(msg);
                    // fs.writeFileSync(logFd, msg);
                }
                fs.writeFileSync(consoleLogFd, data.toString());
                fs.fdatasyncSync(consoleLogFd);
            }
        }
        catch (e) {
            consoleLogFd = -1;
        }
    }

    public dispose() {
        GDBServerConsoleInstance.disposeAll();
    }
}
