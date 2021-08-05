import * as vscode from 'vscode';
import * as net from 'net';
import * as fs from 'fs';
import { parseHostPort, RTTConsoleDecoderOpts, TerminalInputMode } from '../common';
import { IPtyTerminalOptions, PtyTerminal } from './pty';
import { decoders as DECODER_MAP } from './swo/decoders/utils';

export class RTTTerminal {
    public connected = false;
    protected socket: net.Socket = null;
    protected ptyTerm: PtyTerminal;
    protected ptyOptions: IPtyTerminalOptions;
    protected binaryFormatter: BinaryFormatter;
    public inUse = true;
    protected logFd: number;
    public get terminal(): vscode.Terminal {
        return this.ptyTerm ? this.ptyTerm.terminal : null;
    }

    constructor(
        protected context: vscode.ExtensionContext,
        public options: RTTConsoleDecoderOpts) {
        this.ptyOptions = this.createTermOptions(null);
        this.createTerminal();
        this.openLogFile();
        setTimeout(() => this.terminal.show(), 100);
    }

    public startConnection(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.connected) {
                resolve();
                return;
            }

            this.connected = false;
            this.socket = new net.Socket();
            this.socket.on  ('data', (data) => { this.onData(data); });
            this.socket.once('close', () => { this.onClose(); });
            this.socket.once('error', (e) => {
                this.ptyTerm.write(e.toString() + '\n');
                this.connected = false;
                this.socket = null;
                reject(e);
            });
            const hostPort = parseHostPort(this.options.tcpPort);
            this.socket.connect(hostPort.port, hostPort.host, () => {
                this.connected = true;
                resolve();
            });
        });
    }

    private onClose() {
        this.connected = false;
        this.socket = null;
        this.inUse = false;
        this.binaryFormatter.reset();
        if (!this.options.noclear && (this.logFd >= 0)) {
            try { fs.closeSync(this.logFd); } catch { };
        }
        this.logFd = -1;
    }

    private onData(data: Buffer) {
        try {
            if (this.logFd >= 0) {
                fs.writeSync(this.logFd, data);
            }
            if (this.options.type === 'binary') {
                this.binaryFormatter.writeBinary(data);
            } else {
                this.writeNonBinary(data);
            }
        }
        catch (e) {
            this.ptyTerm.write(`Error writing data: ${e}\n`);
        }
    }

    private openLogFile() {
        this.logFd = -1;
        if (this.options.logfile) {
            try {
                this.logFd = fs.openSync(this.options.logfile, 'w');
            }
            catch (e) {
                console.error(`Could not open file ${this.options.logfile} for writing. ${e.toString()}`);
            }
        }
    }

    private writeNonBinary(buf: Buffer) {
        let start = 0;
        for (let ix = 1; ix < buf.length; ix++ ) {
            if (buf[ix-1] !== 0xff) { continue; }
            const chr = buf[ix];
            if (((chr >= 48) && (chr <= 57)) || ((chr >= 65) && (chr <= 90))) {
                if (ix >= 1) {
                    this.ptyTerm.write(buf.slice(start, ix-1));
                }
                this.ptyTerm.write(`<switch to vTerm#${String.fromCharCode(chr)}>\n`);
                buf = buf.slice(ix+1);
                ix = 0;
                start = 0;
            }
        }
        if (buf.length > 0) {
            this.ptyTerm.write(buf);
        }
    }

    protected createTermOptions(existing: string | null): IPtyTerminalOptions {
        const ret: IPtyTerminalOptions = {
            name: RTTTerminal.createTermName(this.options, existing),
            prompt: this.createPrompt(),
            inputMode: this.options.inputmode || TerminalInputMode.COOKED
        }
        return ret;
    }

    protected createTerminal() {
        this.ptyTerm = new PtyTerminal(this.createTermOptions(null));
        this.ptyTerm.on('data', this.sendData.bind(this));
        this.ptyTerm.on('close', this.terminalClosed.bind(this));
        this.binaryFormatter = new BinaryFormatter(this.ptyTerm, this.options.encoding, this.options.scale);
    }

    protected createPrompt(): string {
        return this.options.noprompt ? '' : this.options.prompt || `RTT:${this.options.port}> `
    }

    static createTermName(options: RTTConsoleDecoderOpts, existing: string | null): string {
        const orig = options.label || `RTT Ch:${options.port}`;
        let ret = orig;
        let count = 1;
        while (vscode.window.terminals.findIndex((t) => t.name === ret) >= 0) {
            if (existing === ret) {
                return existing;
            }
            ret = `${orig}-${count}`;
            count++;
        }
        return ret;
    }

    protected terminalClosed() {
        this.dispose();
    }

    public sendData(str: string) {
        if (this.connected) {
            try {
                this.socket.write(str);
            }
            catch (e) {
                console.error(`RTTTerminal:sendData failed ${e}`);
            }
        }
    }

    // If all goes well, this will reset the terminal options. Label for the VSCode terminal has to match
    // since there no way to rename it. If successful, tt will reset the Terminal options and mark it as
    // used (inUse = true) as well
    public tryReuse(options: RTTConsoleDecoderOpts): boolean {
        const newPtyOptions = this.createTermOptions(this.ptyOptions.name)
        if (newPtyOptions.name === this.ptyOptions.name) {
            this.inUse = true;
            if (!this.options.noclear || (this.options.type !== options.type)) {
                this.ptyTerm.clearTerminalBuffer();
                try {
                    if (this.logFd >= 0) {
                        fs.closeSync(this.logFd);
                        this.logFd = -1;
                    }
                    this.openLogFile();
                }
                catch (e) {
                    this.ptyTerm.write(`Error: closing fille ${e}\n`);
                }
            }
            this.options = options;
            this.ptyOptions = newPtyOptions;
            this.ptyTerm.resetOptions(newPtyOptions);
            this.startConnection();
            return true;
        }
        return false;
    }

    dispose() {
        if (this.socket) {
            try {
                this.socket.destroy();
            }
            finally {
                this.socket = null;
                this.connected = false;
            }
        }
        this.ptyTerm.dispose();
        if (this.logFd >= 0) {
            try { fs.closeSync(this.logFd); } catch {};
            this.logFd = -1;
        }
    }
}

function parseEncoded(buffer: Buffer, encoding: string) {
    return DECODER_MAP[encoding] ? DECODER_MAP[encoding](buffer) : DECODER_MAP.unsigned(buffer);
}

function padLeft(str: string, len: number, chr = ' '): string {
    if (str.length >= len) {
        return str;
    }
    str = chr.repeat(len - str.length) + str;
    return str;
}

class BinaryFormatter {
    private readonly bytesNeeded = 4;
    private buffer = Buffer.alloc(4);
    private bytesRead = 0;
    public readonly encodings: string[] = ['signed', 'unsigned', 'Q16.16', 'float'];

    constructor(
        protected ptyTerm: PtyTerminal,
        protected encoding: string,
        protected scale: number) {
        this.reset();
        if (this.encodings.indexOf(encoding) < 0) {
            this.encoding = 'unsigned';
        }
        this.scale = scale || 1;
    }

    public reset() {
        this.bytesRead = 0;
    }

    public writeBinary(input: string | Buffer) {
        let data: Buffer = Buffer.from(input);
        const date = new Date();
        for (let ix = 0; ix < data.length; ix = ix + 1) {
            this.buffer[this.bytesRead] = data[ix];
            this.bytesRead = this.bytesRead + 1;
            if (this.bytesRead === this.bytesNeeded) {
                let chars = '';
                for (const byte of this.buffer) {
                    if (byte <= 32 || (byte >= 127 && byte <= 159)) {
                        chars += '.';
                    } else {
                        chars	+= String.fromCharCode(byte);
                    }                    
                }
                const blah = this.buffer.toString();
                const hexvalue = padLeft(this.buffer.toString('hex'), 8, '0');
                const decodedValue = parseEncoded(this.buffer, this.encoding);
                const decodedStr = padLeft(`${decodedValue}`, 12);
                const scaledValue = padLeft(`${decodedValue * this.scale}`, 12);
                
                this.ptyTerm.write(`[${date.toISOString()}]  ${chars}  0x${hexvalue} - ${decodedStr} - ${scaledValue}\n`);
                this.bytesRead = 0;
            }
        }
    }
}
