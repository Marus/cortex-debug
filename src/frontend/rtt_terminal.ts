import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import { getAnyFreePort, RTTConsoleDecoderOpts, TerminalInputMode } from '../common';
import { SWORTTSource } from './swo/sources/common';
import EventEmitter = require('events');
import { getNonce } from './swo/common';

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
        public inputmode = options.inputmode,
        public binary    = options.type === 'binary',
        public scale     = options.scale || 1,
        public encoding  = options.encoding || (options.type === 'binary' ? 'unsigned' : 'utf8'),
    ) {}
}

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

        if (this.options.logfile) {
            try {
                fs.writeFileSync(this.options.logfile, "");
            }
            catch (e) {
                vscode.window.showErrorMessage(`RTT logging failed ${this.options.logfile}: ${e.toString()}`);
            }
        }

        try {
            this._rttTerminal = vscode.window.createTerminal(args);
            setTimeout(() => {
                this._rttTerminal.show();
            }, 100);
            this.rttTermServer.addClient(this.nonce);
            this.sendOptions(this.termOptions);
            this.connected = true;
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

export class TerminalServer {
    protected server: net.Server = null;
    protected port: number;
    protected socketByNonce: Map<string, net.Socket> = new Map();
    protected nonceBySocket: Map<net.Socket, string> = new Map();

    constructor() {
        this.createServer();
    }

    public portNumber(): number { return this.port; }
    public isConnected(): boolean { return !!this.server; }
    private createServer() {
        getAnyFreePort(55000).then((x) => {
            this.port = x;
            const newServer = net.createServer(this.onNewClient.bind(this));
            newServer.listen(this.port, 'localhost', () => {
                this.server = newServer;
            });
            newServer.on(('error'), (e) => {
                console.log(e);
            });
            newServer.on('close', () => { this.server = null; });
        }).catch((e) => {
        });
    }

    protected onNewClient(socket: net.Socket) {
        console.log('New client connected');
        socket.setKeepAlive(true);
        socket.on('close', () => {
            console.log('client closed');
            const nonce = this.nonceBySocket.get(socket);
            if (nonce) {
                this.nonceBySocket.delete(socket);
                this.socketByNonce.delete(nonce);
            }
        });
        socket.on('data', (data) => {
            const str = data.toString().trim();
            if (this.socketByNonce.has(str)) {
                // Client is alive and responded with proper nonce
                this.socketByNonce.set(str, socket);
                this.nonceBySocket.set(socket, str);
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
                }, 1);
            }
        });
    }

    public addClient(nonce:string) {
        console.log(`adding client ${nonce}`);
        this.socketByNonce.set(nonce, null);
    }
}
