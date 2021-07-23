import { EventEmitter } from 'stream';
import GetOpt = require('node-getopt');
import readline = require('readline');
// import * as ReadLine from 'readline';
import * as net from 'net';
import * as fs from 'fs';
import { decoders as DECODER_MAP } from '../src/frontend/swo/decoders/utils';

const encodings: string[] = ["ascii", "utf8", "ucs2", "utf16le"];
const bencodings: string[] = ["signed", "unsigned", "Q16.16", "float"];

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

export enum InputMode {
    COOKED = 0,
    RAW,
    RAWECHO
}
/*
export class TcpCat extends EventEmitter {
    protected waiting: false;
    protected connected = false;
    public logFile: string = '';
    private logFd: number = -1;
    private firstConnect = true;
    public encoding; string = 'utf8';
    public echoChars = false;

    constructor (
        public readonly host: string,
        private readonly port: number,
        private readonly inputMode: InputMode,
        public clearOnConnect = false) {
        super();
        if ((this.inputMode !== InputMode.COOKED) && !process.stdin.isTTY) {
            this.inputMode = InputMode.COOKED;
        }
        if (this.inputMode != InputMode.COOKED) {
            process.stdin.setRawMode(true);
        }
        process.stdin.on('data', (data) => { this.sendData(data); });
        process.stdin.on('end', () => { process.exit(0); });
        this.setPrompt(`${this.host}:${this.port}> `);
    }

    private sendData(data: string) {
        if (this.connected) {
            // On the send side, maybe it should ways be 'ascii' or 'utf8'
            this.tcpClient.write(data, this.encoding);
            this.logData(data);

            if (process.stdin.isRaw && this.echoChars) {
                if (this.endsWithNl(data)) {
                    this.writeAndFlush('\r\n');
                    this.writePrompt();
                } else {
                    this.writeAndFlush(data);
                }
            } else {
                this.writePrompt();
            }
        } else {
            // Yes, we choose to lose any data that came in before the connection was ready
        }        
    }

    public start() {
        this.writeAndFlush(`Waiting for connection on port ${this.host}:${this.port}...`);
        // Wait for the connection happen. Keep trying until we get a connection
        const wiatForPort = setInterval(() => {
            this.setupCbsAndConnect(() => {
                this.connected = true;
                clearInterval(wiatForPort);                
                this.writeAndFlush('Connected.\n')
                this.clearAndPrompt();
                this.openLogFile();
            });
        }, 100);
    }

    readonly ESC = '\x1b';              // ASCII escape character
    readonly CSI = this.ESC + '[';      // control sequence introducer
    readonly KILLLINE = this.CSI + 'K';
    
    private openLogFile() {
        if (this.logFile) {
            try {
                this.logFd = fs.openSync(this.logFile, (this.clearOnConnect || this.firstConnect) ? 'w' : 'a');
            }
            catch (e) {
                console.error(`Could not open file ${this.logFile} for writing. ${e.toString()}`);
            }
        }
        this.firstConnect = false;
    }
    
    private clearAndPrompt() {
        if (this.clearOnConnect) {
            process.stdout.write(this.CSI + '3J');
        }
        this.writePrompt();
    }

    protected tcpClient: net.Socket = null;
    protected setupCbsAndConnect(cb: () => void) {
        this.tcpClient = new net.Socket();
        this.tcpClient.setEncoding(this.encoding);
        this.tcpClient.on('data', this.onDataCb.bind(this));
        this.tcpClient.once('close', this.onCloseCb.bind(this));
        this.tcpClient.once('error', (e) => {
            if ((e as any).code === 'ECONNREFUSED') {
                // We expect this when there is no server running. Do nothing
            } else {
                console.log(e);
                process.exit(0);
            }
        });
        this.tcpClient.connect(this.port, this.host, cb);
    }

    private onCloseCb() {
        if (this.connected) {
            this.connected = false;
            this.tcpClient = null;
            this.writeAndFlush('\nConnection ended. ');
            if (this.logFd >= 0) {
                try {
                    fs.closeSync(this.logFd);
                }
                finally {
                    this.logFd = -1;
                }
            }
            process.nextTick(() => {
                this.start();
            });
        }
    }

    private onDataCb(data)
    {
        try {
            this.writeData(data);
            this.logData(data);
        }
        catch (e) {
            console.error(e);
        }
    }

    private logData(data) {
        if (this.logFd >= 0) {
            try {
                fs.writeSync(this.logFd, data);
            }
            catch (e) {
                console.error(`Write error on ${this.logFile}. Writing disabled: ${e.toString()}`);
                this.logFd = -1;
            }
        }
    }

    private prompt = '';
    private unPrompt = '';
    private didPrompt: boolean;
    public setPrompt(p: string) {
        this.prompt = p;
        this.unPrompt = '';
        if (p.length) {
            for (let x = 0; x < p.length; x = x + 1) {
                this.unPrompt = this.unPrompt + '\x08';
            }
            this.unPrompt = this.unPrompt + this.KILLLINE;
        }
    }

    private writeAndFlush(msg: string) {
        process.stdout.write(msg);
        process.stdout.uncork();        
    }

    private writePrompt() {
        this.didPrompt = true;
        this.writeAndFlush(this.prompt);
    }

    private writeData(data: any) {
        if (this.didPrompt) {
            data = this.unPrompt + data;
            this.didPrompt = false;
        }

        process.stdout.write(data, this.encoding);

        // If we have a partial line or even a prompt from the server end,
        // do not print a prompt
        if (this.endsWithNl(data)) {
            this.writePrompt();
        } else {
            process.stdout.uncork();
        }
    }

    private endsWithNl(data: any) {
        const type = typeof data;
        if (false) {
            // We are sometimes getting a string and others a Uint8Array
            console.error(Object.prototype.toString.call(data));
            console.error(type);
        }

        let endsWithNl = false;
        if (type === 'string') {
            endsWithNl = (data as string).endsWith('\n');
        } else {
            const ary = (data as unknown as Uint8Array);
            const chr = ary[data.length - 1];
            endsWithNl = (chr === 10) || (chr === 13);
        }
        return endsWithNl;
    }
}
*/
export class TcpCatReadLine extends EventEmitter {
    protected waiting: false;
    protected connected = false;
    public logFile: string = '';
    private logFd: number = -1;
    private firstConnect = true;
    public encoding; string = 'utf8';
    protected rlIF: readline.Interface = null;

    constructor (
        public readonly host: string,
        public readonly port: number,
        public readonly inputMode: InputMode,
        public readonly binary: boolean,
        public readonly scale: number,
        public clearOnConnect?: boolean) {
        super();
        if ((this.inputMode !== InputMode.COOKED) && !process.stdin.isTTY) {
            this.inputMode = InputMode.COOKED;
        }
        this.encoding = !binary ? 'utf8' : 'unsigned';
        this.initLineReader();
        this.setPrompt(`${this.host}:${this.port}> `);
    }

    private initLineReader() {
        if (this.inputMode !== InputMode.COOKED) {
            process.stdin.setRawMode(true);
            process.stdin.on('data', (data) => { this.sendDataRaw(data); });
            process.stdin.on('end', () => { process.exit(0); });
        } else {
            this.rlIF = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
                terminal: process.stdout.isTTY
            });
            this.rlIF.on('line', (line) => { this.sendData(line); });
            this.rlIF.on('close', () => { process.exit(0); });
        }
    }

    private sendDataRaw(data: string | Buffer) {
        if (this.connected) {
            // On the send side, maybe it should ways be 'ascii' or 'utf8'
            this.tcpClient.write(data, this.binary ? 'utf8' : this.encoding);
            this.logData(data);

            if (this.inputMode === InputMode.RAWECHO) {
                if (this.endsWithNl(data)) {
                    this.writeAndFlush('\r\n');
                    this.writePrompt();
                } else {
                    this.writeAndFlush(data);
                }
            }
        } else {
            // Yes, we choose to lose any data that came in before the connection was ready
        }
    }

    private sendData(data: string) {
        if (this.connected) {
            // On the send side, maybe it should ways be 'ascii' or 'utf8'
            data = data + '\n';     // readline strips the line ending
            this.tcpClient.write(data, this.binary ? 'utf8' : this.encoding);
            this.logData(data);
            this.writePrompt();
        } else {
            // Yes, we choose to lose any data that came in before the connection was ready
        }        
    }

    private pause() {
        if (this.rlIF) {
            this.rlIF.pause();
        } else {
            process.stdin.pause();
        }        
    }
    private resume() {
        if (this.rlIF) {
            this.rlIF.resume();
        } else {
            process.stdin.resume();
        }        
    }

    public start() {
        this.pause();
        this.writeAndFlush(`Waiting for connection on port ${this.host}:${this.port}...`);
        // Wait for the connection happen. Keep trying until we get a connection
        const wiatForPort = setInterval(() => {
            this.setupCbsAndConnect(() => {
                this.connected = true;
                clearInterval(wiatForPort);                
                this.writeAndFlush('Connected.\n');
                this.openLogFile();
                this.resume();
                this.clearAndPrompt();
            });
        }, 100);
    }

    readonly ESC = '\x1b';              // ASCII escape character
    readonly CSI = this.ESC + '[';      // control sequence introducer
    readonly KILLLINE = this.CSI + 'K';
    readonly CLEARBUFFER = this.CSI + '3J';
    readonly BOLD = this.CSI + '1m';
    readonly RESET = this.CSI + '0m';
    readonly BACKSPACE = '\x08';
    
    private openLogFile() {
        if (this.logFile) {
            try {
                this.logFd = fs.openSync(this.logFile, (this.clearOnConnect || this.firstConnect) ? 'w' : 'a');
            }
            catch (e) {
                console.error(`Could not open file ${this.logFile} for writing. ${e.toString()}`);
            }
        }
        this.firstConnect = false;
    }
    
    private clearAndPrompt() {
        if (this.clearOnConnect) {
            process.stdout.write(this.CLEARBUFFER);
            if (this.rlIF) {
                // I am not sure why have to Ctrl-L as well. Sending CLEARBUFFER should be enough, but
                // it is not working. Tried many combinations and this is the only thing that works
                this.rlIF.write('', {ctrl: true, name: 'l'});   // This will reset the cursor
            }
        }
        this.writePrompt();
    }

    protected tcpClient: net.Socket = null;
    protected setupCbsAndConnect(cb: () => void) {
        this.tcpClient = new net.Socket();
        if (!this.binary) {
            this.tcpClient.setEncoding(this.encoding);
        }
        this.tcpClient.on('data', this.onDataCb.bind(this));
        this.tcpClient.once('close', this.onCloseCb.bind(this));
        this.tcpClient.once('error', (e) => {
            if ((e as any).code === 'ECONNREFUSED') {
                // We expect this when there is no server running. Do nothing
            } else {
                console.log(e);
                process.exit(0);
            }
        });
        this.tcpClient.connect(this.port, this.host, cb);
    }

    private onCloseCb() {
        if (this.connected) {
            this.connected = false;
            this.tcpClient = null;
            readline.clearLine(process.stdout, 0);
            this.writeAndFlush('\nConnection ended. ');
            if (this.logFd >= 0) {
                try {
                    fs.closeSync(this.logFd);
                }
                finally {
                    this.logFd = -1;
                }
            }
            process.nextTick(() => {
                this.start();
            });
        }
    }

    private onDataCb(data: string | Buffer)
    {
        try {
            this.writeData(data);
            this.logData(data);
        }
        catch (e) {
            console.error(e);
        }
    }

    private logData(data: string | Buffer) {
        if (this.logFd >= 0) {
            try {
                fs.writeSync(this.logFd, data);
            }
            catch (e) {
                console.error(`Write error on ${this.logFile}. Writing disabled: ${e.toString()}`);
                this.logFd = -1;
            }
        }
    }

    private prompt = '';
    private unPrompt = '';
    private didPrompt: boolean;
    public setPrompt(p: string) {
        this.prompt = p;
        this.unPrompt = '\x08'.repeat(p.length) + this.KILLLINE;
        if (this.rlIF) {
            this.rlIF.setPrompt(this.prompt);
        }
    }

    private writeAndFlush(msg: string | Buffer) {
        process.stdout.write(msg);
        process.stdout.uncork();        
    }

    private writePrompt() {
        this.didPrompt = true;
        if (this.rlIF) {
            this.rlIF.prompt(true);
        } else {
            this.writeAndFlush(this.prompt);
        }
    }

    private writeData(data: any) {
        data = Buffer.from(data);
        let erase = this.rlIF ? '\x08'.repeat(this.rlIF.line.length) : '';
        if (this.didPrompt) {
            erase += this.unPrompt;
            this.didPrompt = false;
        }

        process.stdout.write(erase);

        if (this.binary) {
            this.writeBinary(data);
        } else {
            process.stdout.write(data);
            if (this.endsWithNl(data)) {
                this.writePrompt();
            }
        }
    }

    private readonly bytesNeeded = 4;
    private buffer = Buffer.alloc(4);
    private bytesRead = 0;
    private writeBinary(input: string | Buffer) {
        let data: Buffer = ((typeof input) === 'string') ? Buffer.from(input) : (input as Buffer) ;
        const date = new Date();
        for (let ix = 0; ix < data.length; ix = ix + 1) {
            this.buffer[this.bytesRead] = data[ix];
            this.bytesRead = this.bytesRead + 1;
            if (this.bytesRead === this.bytesNeeded) {
                const hexvalue = padLeft(this.buffer.toString('hex'), 8, '0');
                const decodedValue = parseEncoded(this.buffer, this.encoding);
                const decodedStr = padLeft(`${decodedValue}`, 12);
                const scaledValue = padLeft(`${decodedValue * this.scale}`, 12);
                
                process.stdout.write(`[${date.toISOString()}]  0x${hexvalue} - ${decodedStr} - ${scaledValue}\n`);
                this.bytesRead = 0;
            }
        }
        this.writePrompt();
    }

    private endsWithNl(data: string | Buffer) {
        const type = typeof data;
        if (false) {
            // We are sometimes getting a string and others a Uint8Array
            console.error(Object.prototype.toString.call(data));
            console.error(type);
        }

        let endsWithNl = false;
        if (type === 'string') {
            endsWithNl = (data as string).endsWith('\n');
        } else {
            const buf = (data as Buffer);
            const chr = buf[data.length - 1];
            // Revisit: This may not work for all encodings. We may want to convert everything to
            // a string
            endsWithNl = (chr === 10) || (chr === 13);
        }
        return endsWithNl;
    }
}

function main() {
    const args = process.argv.slice(2);
    const opts = new GetOpt([
        ['',    'port=ARG',     'tcpPort number with format "[host:]port'],
        ['',    'prompt=ARG',   'Optional prompt for terminal'],
        ['',    'noprompt',     'Do not display a prompt'],
        ['',    'clear',        'Clear screen/logfile on new connection'],
        ['',    'logfile=ARG',  'Log all IO to file'],
        ['',    'encoding=ARG', `Encoding for input and output. One of ${encodings.join(", ")}. For binary, ${bencodings.join(", ")}`],
        ['',    'raw',          'Input will not be buffered, raw mode'],
        ['',    'rawecho',      'Input will not be buffered, raw mode. Will echo chars and carriage returns'],
        ['',    'binary',       'Convert output to binary data with. Encoding must be signed, unsigned'],
        ['',    'scale=ARG,',   'Multiply binary data with given scale (float)'],
        ['h',   'help',         'display this help']
    ]);
    
    opts.parse(process.argv.slice(2));
    let port = opts.options.port;
    let host = '127.0.0.1';
    if (!port || opts.options.help || (opts.options.prompt && opts.options.noprompt)) {
        opts.showHelp();
        return;
    }

    const enc = opts.options.encoding;
    if (enc && !opts.options.binary && (encodings.findIndex((str) => (str === enc)) < 0)) {
        console.error(`Unknown encoding ${enc} for console. Must be ${encodings.join(', ')}`);
        opts.showHelp();
        return;
    }
    if (enc && opts.options.binary && (bencodings.findIndex((str) => (str === enc)) < 0)) {
        console.error(`Unknown encoding ${enc} for binary. Must be ${bencodings.join(', ')}`);
        opts.showHelp();
        return;
    }

    let match = port.trim().match(/(.+):([0-9]+)/);
    if (!match) {
        match = port.trim().match(/:?([0-9]+)/);
        port = match ? match[1] : '';
    } else {
        port = match[2];
        host = match[1];
    }
    if (!port) {
        opts.showHelp();
        return;
    }

    let inputMode = InputMode.COOKED;
    if (process.stdin.isTTY) {
        if (opts.options.rawecho) {
            inputMode = InputMode.RAWECHO;
        } else if (opts.options.raw) {
            inputMode = InputMode.RAW;
        }
    }
    const tcpCat = new TcpCatReadLine(
        host, parseInt(port), inputMode,
        !!opts.options.binary, parseFloat(opts.options.scale || '1'),
        !!opts.options.clear);

    if (opts.options.prompt) {
        tcpCat.setPrompt(opts.options.prompt);
    } else if (opts.options.noprompt) {
        tcpCat.setPrompt('');
    }
    if (opts.options.logfile) {
        tcpCat.logFile = opts.options.logfile;
    }

    if (enc) {
        tcpCat.encoding = enc;
        if (!tcpCat.binary) {
            process.stdin.setEncoding(enc);
            process.stdout.setEncoding(enc);
        }
    }

    tcpCat.start();
}

try {
    console.log('RTT Console: ' + process.argv.slice(2).join(' '));
    main();
}
catch (e) {
    console.error(e);
}
