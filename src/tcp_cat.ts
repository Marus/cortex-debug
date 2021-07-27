import { EventEmitter } from 'stream';
import GetOpt = require('node-getopt');
import readline = require('readline');
// import * as ReadLine from 'readline';
import * as net from 'net';
import * as fs from 'fs';
import { decoders as DECODER_MAP } from '../src/frontend/swo/decoders/utils';
import { TerminalInputMode } from './common';
import { parseHostPort } from './frontend/swo/common';
import { IRTTTerminalOptions } from './frontend/rtt_terminal';

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

export class TcpCatReadLine extends EventEmitter {
    protected host: string;
    protected port: number;
    public connected = false;
    private logFd: number = -1;
    private firstConnect = true;
    protected rlIF: readline.Interface = null;
    protected closingRlIF: boolean;

    constructor(public options: IRTTTerminalOptions, public usingServer) {
        super();
        if ((this.options.inputmode !== TerminalInputMode.COOKED) && !process.stdin.isTTY) {
            this.options.inputmode = TerminalInputMode.COOKED;
        }
        this.initLineReader();
        const obj = parseHostPort(this.options.port);
        this.port = obj.port;
        this.host = obj.host;
        if (!this.options.prompt) {
            this.options.prompt = `${this.host}:${this.port}> `;
        }
        this.setPrompt(this.options.noprompt ? '' : this.options.prompt);
    }

    private initLineReader() {
        if (this.options.inputmode !== TerminalInputMode.COOKED) {
            process.stdin.setRawMode(true);
            process.stdin.on('data', (data) => { this.sendDataRaw(data); });
            process.stdin.on('end', () => { process.exit(0); });
        } else {
            this.closingRlIF = false;
            this.rlIF = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
                terminal: process.stdout.isTTY
            });
            this.rlIF.on('line', (line) => { this.sendData(line); });
            this.rlIF.on('close', () => {
                if (!this.closingRlIF) {    // We are not the ones closing it
                    process.exit(0);
                }
            });
        }
    }

    private sendDataRaw(data: string | Buffer) {
        if (this.connected) {
            // On the send side, maybe it should ways be 'ascii' or 'utf8'
            this.tcpClient.write(data, this.options.binary ? 'utf8' : this.options.encoding);
            this.logData(data);

            if (this.options.inputmode === TerminalInputMode.RAWECHO) {
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
            this.tcpClient.write(data, this.options.binary ? 'utf8' : this.options.encoding);
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

    private wiatForPort: NodeJS.Timeout = null;
    public start() {
        this.pause();
        this.writeAndFlush(`Waiting for connection on port ${this.host}:${this.port}...`);
        // Wait for the connection happen. Keep trying until we get a connection
        this.wiatForPort = setInterval(() => {
            this.setupCbsAndConnect(() => {
                this.connected = true;
                clearInterval(this.wiatForPort);
                this.wiatForPort = null;
                this.writeAndFlush('Connected.\n');
                this.openLogFile();
                this.resume();
                this.clearAndPrompt();
            });
        }, 100);
    }

    public end() {
        if (this.wiatForPort) {
            clearInterval(this.wiatForPort);
            this.onCloseCb(true);
        } else if (this.connected) {
            this.tcpClient.destroy();

            // If a close even neer happened, try to do it manually
            setTimeout(() => {
                if (this.connected) {   // Still connected. Nuke it
                    this.onCloseCb(true);
                }
            }, 2);
        }
    }

    readonly ESC = '\x1b';              // ASCII escape character
    readonly CSI = this.ESC + '[';      // control sequence introducer
    readonly KILLLINE = this.CSI + 'K';
    readonly CLEARBUFFER = this.CSI + '3J';
    readonly BOLD = this.CSI + '1m';
    readonly RESET = this.CSI + '0m';
    readonly BACKSPACE = '\x08';
    
    private openLogFile() {
        if (this.options.logfile) {
            try {
                this.logFd = fs.openSync(this.options.logfile, (this.options.clear || this.firstConnect) ? 'w' : 'a');
            }
            catch (e) {
                console.error(`Could not open file ${this.options.logfile} for writing. ${e.toString()}`);
            }
        }
        this.firstConnect = false;
    }
    
    private clearAndPrompt() {
        if (this.options.clear) {
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
        if (!this.options.binary) {
            this.tcpClient.setEncoding(this.options.encoding);
        }
        this.tcpClient.on  ('data', this.onDataCb.bind(this));
        this.tcpClient.once('close', this.onCloseCb.bind(this, false));
        this.tcpClient.on  ('error', (e) => {
            // It is normal to get 'ECONNREFUSED' but on Windows you may also get
            // ECONNRESET. We expect 'ECONNREFUSED' if the server has not yet started.
            // Just ignore the errors as the connection fails or closes anyways
            
            // const code = (e as any).code;
            // console.log(`Error code = ${code}`);
        });
        this.tcpClient.connect(this.port, this.host, cb);
    }

    private onCloseCb(forced: boolean = false) {
        if (this.connected || forced) {
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
            if (!this.usingServer) {
                process.nextTick(() => {
                    this.start();
                });
            } else {
                if (this.rlIF) {
                    this.closingRlIF = true;
                    this.rlIF.close();
                    this.rlIF = null;
                }
                process.stdin.setRawMode(false);
            }
            this.emit('close');
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
                console.error(`Write error on ${this.options.logfile}. Writing disabled: ${e.toString()}`);
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

        if (this.options.binary) {
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
                const decodedValue = parseEncoded(this.buffer, this.options.encoding);
                const decodedStr = padLeft(`${decodedValue}`, 12);
                const scaledValue = padLeft(`${decodedValue * this.options.scale}`, 12);
                
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

// Connection back to VSCode
export class serverConnection {
    protected tcpClient = new net.Socket();
    protected options: IRTTTerminalOptions = null;
    protected gdbServer: TcpCatReadLine = null;
    protected interval: NodeJS.Timeout = null;
    protected oldData: string = '';

    constructor(protected port: number, protected nonce: string) {
        process.stdin.pause();
        // If nonce is not given, it will never match
        this.nonce = this.nonce || Math.floor(Math.random() * 1e6).toString();
        this.tcpClient = new net.Socket();
        this.tcpClient.on('data', this.onDataCb.bind(this));
        this.tcpClient.on('close', () => {process.exit(0)});
        this.tcpClient.on('error', (e) => {
            // We should not get any errors at all
            const code = (e as any).code;
            console.error(`Error code = ${code}`);
            reportCrash(e, true);
            process.exit(101);
        });
        this.tcpClient.connect(this.port, '127.0.0.1', () => {
            process.stdout.write('Connected to VSCode.\n');
            this.tcpClient.write(this.nonce + '\n');
            this.tcpClient.uncork();
        });
        this.doWaitMsg()
    }

    protected doWaitMsg() {
        process.stdout.write('Waiting for VSCode session options...');
        const intervalMs = 10;
        let waitMs = 0;
        this.interval = setInterval(() => {
            // Do nothing for now
            if (!this.gdbServer) {
                waitMs = waitMs + intervalMs;
                if (waitMs > 1000) {
                    // process.stdout.write('.');
                    // process.stdout.uncork();
                    waitMs = 0;
                }
            } else if (this.interval) {
                clearInterval(this.interval);
            }
        }, intervalMs);
    }

    protected onDataCb(data: string | Buffer) {
        clearInterval(this.interval);
        this.interval = null;

        let str = data.toString('utf8');
        let options: any;
        try {
            str = this.oldData + str;
            if (str.endsWith('\n')) {
                options = JSON.parse(str);
            } else {
                this.oldData = str;
                return;
            }
        }
        catch (e) {
            console.error(`invalide JSON '${str}` + e.toString());
            reportCrash(e, false);
            return;
        }

        if (options.nonce === 'broadcast') {
            if (options.data === 'exit') {
                this.closeClient();
            }
        } else {
            process.stdout.write(str);
            process.stdout.uncork();            
            if (this.nonce === options.nonce) {
                if (this.gdbServer) {
                    if (this.gdbServer.connected) {
                        // We are not expecting a new message while the gdb server is already running.
                        const msg = `Invalid message ${str} while gdb connection is still active`;
                        reportCrash(new Error(msg), true);
                    } else {
                        this.closeClient();
                    }
                }
                this.options = options;
                process.stdin.resume();
                this.gdbServer = new TcpCatReadLine(this.options, true);
                this.gdbServer.on('close', () => {
                    this.gdbServer = null;
                    this.doWaitMsg();
                });
                this.gdbServer.start();
            } else {
                console.error(`Invalid message ${str} from VSCode. Nonce mismatch`);
            }
        }
    }

    private closeClient() {
        try {
            if (this.gdbServer) {
                this.gdbServer.end();
                this.gdbServer = null;
            }
        }
        catch (e) {
            console.error('gdb connection close failed');
            reportCrash(e, false);
        }
    }
}

function main() {
    let server: serverConnection;
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
        ['h',   'help',         'display this help'],
        ['',    'useserver=ARG','Reserved: all other options ignored. Options passed on socket'],
        ['',    'nonce=ARG',    'Reserved: a unique string id to indentify this instance']
    ]);
    
    opts.parse(process.argv.slice(2));

    if (opts.options.useserver) {
        
        if (!opts.options.nonce || (opts.options.nonce.length !== 32)) {
            console.error(`Invalid nonce ${opts.options.nonce}`);
            process.exit(102);
        }
        const port = parseInt(opts.options.useserver);
        server = new serverConnection(port, opts.options.nonce);
        return;
    }

    if (!opts.options.port || opts.options.help || (opts.options.prompt && opts.options.noprompt)) {
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

    let inpMode: TerminalInputMode = TerminalInputMode.COOKED;
    if (process.stdin.isTTY) {
        if (opts.options.rawecho) {
            inpMode = TerminalInputMode.RAWECHO;
        } else if (opts.options.raw) {
            inpMode = TerminalInputMode.RAW;
        }
    }

    const options: IRTTTerminalOptions = {
        port      : opts.options.port,
        prompt    : opts.options.prompt || '',
        noprompt  : !!opts.options.noprompt,
        clear     : !!opts.options.clear,
        logfile   : opts.options.logFile || '',
        inputmode : inpMode,
        binary    : !!opts.options.binary,
        scale     : opts.options.scale,
        encoding  : opts.options.encoding,
        nonce     : 'cmd-line'
    };
    const tcpCat = new TcpCatReadLine(options, false);
    tcpCat.start();
}

function reportCrash(e: any, hang: boolean = false) {
    console.error(e);
    if (e.stack) {
        console.error(e.stack);
    }
    if (hang) {
        console.error('tcpCat crashed... Use Ctrl-C to exit');
        setInterval(() => {
            console.error('tcpCat crashed... Use Ctrl-C to exit');
        }, 5000);
    }
}

try {
    process.on('uncaughtException', function(err) {
        reportCrash(err, true);
    });

    console.log('RTT Console: ' + process.argv.slice(2).join(' '));
    main();
}
catch (e) {
    reportCrash(e, true);
}

