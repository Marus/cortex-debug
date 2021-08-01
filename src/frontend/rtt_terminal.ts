import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import { getAnyFreePort, getNonce, RTTConsoleDecoderOpts, TerminalInputMode } from '../common';
import { SWORTTSource } from './swo/sources/common';
import EventEmitter = require('events');

export interface IRTTTerminalOptions
{
    port      : string;
    prompt    : string;
    noprompt  : boolean;
    clear     : boolean;
    logfile   : string;
    inputmode : TerminalInputMode;
    binary    : boolean;
    scale     : number;
    encoding  : string;
    nonce     : string;
}

export class RTTTerminalOptions implements IRTTTerminalOptions {
    constructor(options: RTTConsoleDecoderOpts,
        public nonce,
        public port      = options.tcpPort,
        public prompt    = options.prompt || `RTT-${options.port}> `,
        public noprompt  = !!options.noprompt,
        public clear     = !!options.clear,
        public logfile   = options.logfile || '',
        public inputmode = (options.inputmode === undefined) ? TerminalInputMode.COOKED : options.inputmode,
        public binary    = options.type === 'binary',
        public scale     = (options.scale === undefined) ? 1 : options.scale,
        public encoding  = options.encoding || (options.type === 'binary' ? 'unsigned' : 'utf8'),
    ) {}
}

/**
 * This class creates an instance of a terminal intended to display RTT/semihosting/SWO output
 * but technically, it can be anything. It provides a limited set of options that hopefully
 * will meet most needs
 * 
 * The goal here is to re-use the terminal as much as possible so the user would find it in
 * a stable place and preferably in the place they docked it.
 */
export class RTTTerminal extends EventEmitter implements SWORTTSource   {
    protected termOptions: RTTTerminalOptions;
    protected nonce = getNonce();
    connected: boolean;
    protected _rttTerminal: vscode.Terminal = null;
    public get rttTerminal(): vscode.Terminal {
        return this._rttTerminal;
    }

    private _name: string;
    public get name(): string {
        return this._name;
    }

    private _inUse: boolean = false;
    public get inUse(): boolean {
        return this._inUse;
    }
    public set inUse(value: boolean) {
        this._inUse = value;
    }

    constructor(
        protected context: vscode.ExtensionContext,
        public options: RTTConsoleDecoderOpts,
        protected rttTermServer: TerminalServer) {
        super();
        this.termOptions = new RTTTerminalOptions(options, this.nonce);
    }

    dispose() {
        // process.kill(this.rttTerminal.processId)
        if (this.rttTerminal) {
            this.rttTerminal.dispose();
        }
        this._rttTerminal = null;
        this.connected = false;
        this.inUse = false;
    }

    public startTerminal(): boolean {
        if (this.connected) {
            return true;
        }
        const script = path.join(this.context.extensionPath, 'dist', 'tcp_cat.bundle.js');
        this._name = RTTTerminal.createTermName(this.options, null);
        const args = {
            name: this.name,
            shellPath: 'node',
            shellArgs: [script,
                "--useserver", this.rttTermServer.portNumber().toString(),
                "--nonce", this.termOptions.nonce
            ]
        };

        // Even in append mode, we start off with an empty file
        // and the terminal appends (or truncates) with its own lifetime
        if (this.options.logfile) {
            try {
                fs.writeFileSync(this.options.logfile, "");
            }
            catch (e) {
                vscode.window.showErrorMessage(`RTT logging failed ${this.options.logfile}: ${e.toString()}`);
            }
        }

        try {
            this.rttTermServer.once('register', (str) => {
                if (str === this.nonce) {
                    this.sendOptions(this.termOptions);
                    this.connected = true;                }
            });
            this._rttTerminal = vscode.window.createTerminal(args);
            setTimeout(() => {
                this._rttTerminal.show();
            }, 100);
            this.rttTermServer.addClient(this.nonce);
            this.inUse = true;
            return true;
        }
        catch (e) {
            vscode.window.showErrorMessage(`Terminal start failed: ${e.toString()}`);
            return false;
        }     
    }

    static createTermName(options: RTTConsoleDecoderOpts, existing: string | null): string {
        const channel = options.port || 0;
        const orig = options.label || `RTT Ch:${channel}`;
        let ret = orig;
        let count = 1;
        while (vscode.window.terminals.findIndex((t) => t.name === ret) >= 0) {
            if (existing === ret) {
                return existing;
            }
            ret = `${orig}-${count}`;
            count = count + 1;
        }
        return ret;
    }

    // If all goes well, this will reset the terminal options. The original port (meaning channel) name
    // has to match and the label for the VSCode terminal has to match. If successful, tt will reset the
    // Terminal options and mark it as used (inUse = true) as well.
    public async tryReuse(options: RTTConsoleDecoderOpts): Promise<boolean> {
        if (this.options.port === options.port) {
            // See if we are going to get the same label as before because that cannot be changed
            const newName = RTTTerminal.createTermName(options, this._rttTerminal.name);
            if (newName !== this._rttTerminal.name) {
                return false;
            }
            const termOptions = new RTTTerminalOptions(options, this.termOptions.nonce);
            const ret = await this.sendOptions(termOptions);
            return ret;
        }
        return false;
    }

    private sendOptions(options: RTTTerminalOptions): boolean {
        const str = JSON.stringify(options) + '\n';
        if (this.rttTermServer.sendToClient(this.nonce, str)) {
            this.termOptions = options;
            this.inUse = true;
            return true;
        }
        return false;
    }
}

/**
 * This class creates a server which communicates with all the registered channels
 * and is able to send information to indivitual sockets. Each terminal identifies
 * and authenticates itself with a nonce. This process knows nothing about the
 * terminals themselves are what is going on within them
 */
export class TerminalServer extends EventEmitter {
    protected server: net.Server = null;
    protected port: number;
    protected socketByNonce: Map<string, net.Socket> = new Map();
    protected nonceBySocket: Map<net.Socket, string> = new Map();
    protected noBroadExit: string[] = [];

    constructor() {
        super();
    }

    public portNumber(): number { return this.port; }
    public isConnected(): boolean { return !!this.server; }
    public createServer(): Promise<void> {
        return new Promise((resolve, reject) => {
            getAnyFreePort(55678).then((x) => {
                this.port = x;
                const newServer = net.createServer(this.onNewClient.bind(this));
                newServer.listen(this.port, '127.0.0.1', () => {
                    this.server = newServer;
                    resolve();
                });
                newServer.on(('error'), (e) => {
                    console.log(e);
                });
                newServer.on('close', () => { this.server = null; });
            }).catch((e) => {
                reject(e)
            });
        });
    }

    protected onNewClient(socket: net.Socket) {
        this.emit('connect');
        console.log('TerminalServer: New client connected');
        socket.setKeepAlive(true);
        socket.on('close', () => {
            console.log('client closed');
            const nonce = this.nonceBySocket.get(socket);
            if (nonce) {
                this.nonceBySocket.delete(socket);
                this.socketByNonce.delete(nonce);
                this.noBroadExit = this.noBroadExit.filter((item) => item !== nonce);
            }
            this.emit('disconnect');
        });
        socket.on('data', (data) => {
            const str = data.toString().trim();
            if (this.socketByNonce.has(str)) {
                // Client is alive and responded with proper nonce
                console.log(`client ${str} registered`);
                this.socketByNonce.set(str, socket);
                this.nonceBySocket.set(socket, str);
                this.emit('register', str);
            } else {
                console.error(`Unknown message '${str}' from client`);
            }
        });
        socket.on('error', (e) => {
            console.error(`client error ${e}`)
        });
    }

    public dispose() {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }

    public sendToClient(nonce: string, data: string | Buffer): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            if (!this.socketByNonce.has(nonce)) {
                resolve(false);
                return;
            }
            let socket: net.Socket = this.socketByNonce[nonce];
            function send() {
                try {
                    socket.write(data);   
                    socket.uncork();   
                    resolve(true);
                }
                catch (e) {
                    resolve(false);
                }
            }
            if (socket) {
                send();
            } else {
                // This can happen the very first time we are sending something. Technically, return
                // should be a promise
                const interval = setInterval(() => {
                    socket = this.socketByNonce.get(nonce);
                    if (socket) {
                        clearInterval(interval);
                        send();
                    }
                }, 10);
            }
        });
    }

    public addClient(nonce:string, allowExitBroadcast: boolean = true) {
        console.log(`adding client ${nonce}`);
        this.socketByNonce.set(nonce, null);
        if (!allowExitBroadcast) {
            this.noBroadExit.push(nonce);
        }
    }

    public broadcast(msg: string) {
        const obj = {
            nonce: 'broadcast',
            data: msg
        }
        msg = JSON.stringify(obj) + '\n';
        this.socketByNonce.forEach((socket,nonce,map) => {
            if (this.noBroadExit.findIndex((item) => item === nonce) < 0) {
                try {
                    socket.write(msg);   
                    socket.uncork();   
                }
                catch (e) {
                }
            }
        });
    }

    public broadcastExit() {
        this.broadcast('exit');
    }
}

export class GDBServerConsole {
    protected toTerminalServer: net.Server = null;
    protected toTerminal: net.Socket = null;
    protected toTerminalPort: number = -1;

    protected toBackendServer: net.Server = null;
    protected toBackend: net.Socket = null;
    protected toBackendPort: number = -1;    

    public terminal: vscode.Terminal = null;
    protected options: IRTTTerminalOptions;
    protected name: string;
    protected connected: boolean;
    static BackendPort: number = -1;

    constructor(public context: vscode.ExtensionContext, public termServer: TerminalServer) {
        this.options = {
            port      : '',
            prompt    : '',
            noprompt  : true,
            clear     : true,
            logfile   : '',
            inputmode : TerminalInputMode.COOKED,
            binary    : false,
            scale     : 1.0,
            encoding  : 'utf8',
            nonce     : getNonce()
        };
    }

    public startServer(): Promise<[void, void]> {
        return Promise.all<void, void>([
            this.initToTerminalSocket(),
            this.initToBackendSocket()
        ]);
    }

    // Create a server that communicates between the terminal and this extension
    // The gdb-server terminal connects to this server and gets does the IO with it
    // It does not directly talk to the gdb-server. Any input entered into the terminal
    // is sent to the gdb-server via the backend socket
    protected initToTerminalSocket() : Promise<void> {
        return new Promise((resolve, reject) => {
            getAnyFreePort(55778).then((p) => {
                this.toTerminalPort = p;
                this.options.port = p.toString();
                const newServer = net.createServer(this.onTerminalConnect.bind(this));
                newServer.listen(this.toTerminalPort, '127.0.0.1', () => {
                    this.toTerminalServer = newServer;
                    resolve();
                });
                newServer.on(('error'), (e) => {
                    console.error(e);
                    reject(e);
                });
                newServer.on('close', () => {
                    this.toTerminalServer = null;
                });
            });
        });     
    }

    // Create a server that serves the GDBServer running in the adapter process
    // Any data from the gdb-server is received here and sent to the terminal
    // via the terminal socket
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

    // The program running in the terinal is just connected
    protected onTerminalConnect(socket: net.Socket) {
        this.toTerminal = socket;
        console.log('onTerminalConnect gdb-server console connected');
        socket.setKeepAlive(true);
        socket.once('close', () => {
            console.log('onTerminalConnect gdb-server console closed');
            this.toTerminal = null;
            vscode.window.showErrorMessage(
                'Cortex-Debug GDB Server console terminal window quit unexpectedly. Please report this problem.\n' +
                'Many things may not work. Do you want to try re-starting the terminal window', 'Yes', 'Np').then((str) => {
                    if (str === 'Yes') {
                        try { this.terminal.dispose(); } catch (e) {}
                        this.terminal = null;
                        this.createTerminal();
                    }
                })
        });
        socket.on('data', (data) => {
            // route this data to the gdb-server through the gdb-adapter. very long trip
            this.sendToBackend(data);
        });
        socket.on('error', (e) => {
            console.error(`onTerminalConnect: gdb-server console client error ${e}`)
        });
        socket.setKeepAlive(true);
    }

    // The gdb-server running in the backend
    protected onBackendConnect(socket: net.Socket) {
        this.toBackend = socket;
        this.clearTerminal();
        console.log('onBackendConnect: gdb-server program connected');
        socket.setKeepAlive(true);
        socket.on('close', () => {
            console.log('onBackendConnect: gdb-server program closed');
            this.sendToTerminal('GDB server exited. Waiting for next server start...')
            this.toBackend = null;
        });
        socket.on('data', (data) => {
            this.sendToTerminal(data);
        });
        socket.on('error', (e) => {
            console.error(`onBackendConnect: gdb-server program client error ${e}`)
        });
        socket.setKeepAlive(true);
    }

    public sendToBackend(data: string | Buffer) {
        if (this.toBackend) {
            this.toBackend.write(data.toString());
            this.toBackend.uncork();
        }
    }

    //
    // There are two sockets going on. It can happen that the socket to the gdb-server 
    // starts streaming before the terminal is even ready. Just buffer it until we have
    // the terminal is alice
    //
    private termBuffer = Buffer.alloc(0);
    public sendToTerminal(data: string | Buffer) {
        if (this.toTerminal) {
            if (this.termBuffer.length > 0) {
                this.toTerminal.write(this.termBuffer, 'utf8');
                this.termBuffer = Buffer.alloc(0);
            }
            this.toTerminal.write(data, 'utf8');
            this.toTerminal.uncork();
        } else {
            this.termBuffer = Buffer.concat([this.termBuffer, Buffer.from(data)]);
        }
    }

    public clearTerminal() {
        const obj = {
            nonce: this.options.nonce,
            data: 'clear'
        }
        const msg = JSON.stringify(obj) + '\n';
        this.termServer.sendToClient(this.options.nonce, msg);
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
        if (this.terminal) {
            this.terminal.dispose();
        }
        this.terminal = null;
        this.connected = false;
        if (this.toBackend) {
            this.toBackend.destroy();
            this.toBackend = null;
        }
        if (this.toTerminal) {
            this.toTerminal.destroy();
            this.toTerminal = null;
        }
    }

    public createTerminal(): boolean {
        if (this.terminal) {
            return true;
        }
        const script = path.join(this.context.extensionPath, 'dist', 'tcp_cat.bundle.js');
        this.name = GDBServerConsole.createTermName('gdb-server', null);
        const portStr = this.termServer.portNumber().toString();
        const args = {
            name: this.name,
            shellPath: 'node',
            shellArgs: [//'inspect',
                script,
                "--useserver", portStr,
                "--nonce",     this.options.nonce
            ]
        };

        try {
            this.termServer.once('register', (str) => {
                if (str === this.options.nonce) {
                    this.connected = true;
                    this.sendTerminalOptions(this.options);
                }
            });
            this.termServer.addClient(this.options.nonce, false);
            this.terminal = vscode.window.createTerminal(args);
            setTimeout(() => {
                this.terminal.show();
            }, 100);
            return true;
        }
        catch (e) {
            vscode.window.showErrorMessage(`Terminal start for gdb-server failed: ${e.toString()}`);
            return false;
        }     
    }

    private sendTerminalOptions(options: RTTTerminalOptions): boolean {
        const str = JSON.stringify(options) + '\n';
        if (this.termServer.sendToClient(this.options.nonce, str)) {
            return true;
        }
        return false;
    }
}
