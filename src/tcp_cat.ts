import { EventEmitter } from 'stream';
import GetOpt = require('node-getopt');
import readline = require('readline');
import * as net from 'net';
import * as fs from 'fs';
import { decoders as DECODER_MAP } from '../src/frontend/swo/decoders/utils';
import { parseHostPort, ResettableInterval, ResettableTimeout, TerminalInputMode } from './common';
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

export class TcpConsole extends EventEmitter {
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
        if (this.connected && (this.options.inputmode !==TerminalInputMode.DISABLED)) {
            // On the send side, maybe it should ways be 'ascii' or 'utf8'
            this.tcpClient.write(data);
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
            this.tcpClient.write(data, this.options.encoding);
            this.logData(data);
            this.writePrompt();
        } else {
            // Yes, we choose to lose any data that came in before the connection was ready
        }        
    }

    private wiatForPort: ResettableInterval = null;
    public start() {
        this.writeAndFlush(`Waiting for connection on port ${this.host}:${this.port}...`);
        // Wait for the connection happen. Keep trying until we get a connection
        this.wiatForPort = new ResettableInterval(() => {
            this.setupCbsAndConnect().then(() => {
                this.connected = true;
                this.wiatForPort.kill();
                this.wiatForPort = null;
                this.writeAndFlush('Connected.\n');
                this.openLogFile();
                this.clearAndPrompt();
            }).catch((e) => {});
        }, 100, false);
    }

    public end() {
        if (this.promptTimer) {
            this.promptTimer.kill();
            this.promptTimer = null;
        }
        if (this.wiatForPort && this.wiatForPort.isRunning()) {
            this.wiatForPort.kill();
            this.wiatForPort = null;
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
    
    public clearAndPrompt() {
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
    protected setupCbsAndConnect(): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this.tcpClient = new net.Socket();
            this.tcpClient.on  ('data', this.onDataCb.bind(this));
            this.tcpClient.once('close', this.onCloseCb.bind(this, false));
            this.tcpClient.on  ('error', (e) => {
                // It is normal to get 'ECONNREFUSED' but on Windows you may also get
                // ECONNRESET. We expect 'ECONNREFUSED' if the server has not yet started.
                // Just ignore the errors as the connection fails or closes anyways
                
                // const code = (e as any).code;
                // console.log(`Error code = ${code}`);
                reject(e);
            });
            this.tcpClient.connect(this.port, this.host, () => {
                resolve(true);
            });
        });
    }

    private onCloseCb(forced: boolean = false) {
        if (this.connected && !forced) {
            // JLink drops connection if it is not expecting input but user enters something
            // try to re-connect once and give up
            this.writeAndFlush('\nConnection ended...');
            setTimeout(() => {
                this.setupCbsAndConnect().then((v) => {
                    this.writeAndFlush('reconnected.\n');
                }).catch(() => {
                    this.writeAndFlush('reconnect failed\n');
                    this.finishClose();
                });
            }, 10);
        } else if (this.connected || forced) {
            if (forced) {
                this.writeAndFlush('\nConnection ended (forced).');
            }
            this.finishClose();
        }
    }

    private finishClose() {
        this.connected = false;
        this.tcpClient = null;
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

    private onDataCb(buf: Buffer)
    {
        try {
            this.logData(buf);
            if (!this.options.binary) {
                // Accorting to the protocol, SEGGER supports a SetTerminal() API which sends two chars
                // to indicate that the viewer should switch to a virtual terminal. The first char is 0xff
                // and the second char is 0-9 or A-F (16 virt. terinals). We don't do anything with it
                // except to let the user know that a terminal switch occured. Note that if the two chars
                // come in separate packets, we won't recognize the switch. This is a silly feature anyways
                let start = 0;
                for (let ix = 1; ix < buf.length; ix++ ) {
                    if (buf[ix-1] !== 0xff) { continue; }
                    const chr = buf[ix];
                    if (((chr >= 48) && (chr <= 57)) || ((chr >= 65) && (chr <= 90))) {
//                    if ((chr as String) && chr.match(/[0-9A-F]/)) {
                        if (ix >= 1) {
                            this.writeData(buf.slice(start, ix-1));
                        }
                        this.writeData(`<switch to vTerm#${chr}>\n`);
                        buf = buf.slice(ix+1);
                        ix = 0;
                        start = 0;
                    }
                }
            }
            if (buf.length > 0) {
                this.writeData(buf);
            }
        }
        catch (e) {
            reportCrash(e, false);
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

    // writePrompt will delay the actual writing of the prompt in case new things
    // are being written. This is to avoid flashing due to rapid writes and erases
    protected promptTimer: ResettableTimeout = null;
    private writePrompt() {
        if (this.promptTimer === null) {
            this.promptTimer = new ResettableTimeout(() => {
                this.didPrompt = true;
                if (this.rlIF) {
                    this.rlIF.prompt(true);
                } else {
                    this.writeAndFlush(this.prompt);
                }   
            }, 100);
        } else {
            this.promptTimer.reset();
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
            process.stdout.write(data, this.options.encoding);
            if (this.endsWithNl(data)) {
                this.writePrompt();
            } else {
                this.promptTimer.kill();
            }
        }
    }

    private readonly bytesNeeded = 4;
    private buffer = Buffer.alloc(4);
    private bytesRead = 0;
    private writeBinary(input: string | Buffer) {
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
                const decodedValue = parseEncoded(this.buffer, this.options.encoding);
                const decodedStr = padLeft(`${decodedValue}`, 12);
                const scaledValue = padLeft(`${decodedValue * this.options.scale}`, 12);
                
                process.stdout.write(`[${date.toISOString()}]  ${chars}  0x${hexvalue} - ${decodedStr} - ${scaledValue}\n`);
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
            const chr = data[data.length - 1];
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
    protected tcpCatClient: TcpConsole = null;
    protected interval: NodeJS.Timeout = null;
    protected oldData: string = '';

    constructor(protected port: number, protected nonce: string) {
        // If nonce is not given, it will never match
        this.nonce = this.nonce || Math.floor(Math.random() * 1e6).toString();
        this.tcpClient = new net.Socket();
        this.tcpClient.on('data', this.onDataCb.bind(this));
        this.tcpClient.on('close', () => {process.exit(0)});
        this.tcpClient.on('error', (e) => {
            // We should not get any errors at all
            debugger;
            const code = (e as any).code;
            console.error(`Error code = ${code}`);
            reportCrash(e, true);
            process.exit(101);
        });
        this.tcpClient.connect(this.port, '127.0.0.1', () => {
            debugger;
            process.stdout.write('Connected to VSCode.\n');
            process.stdout.uncork();
            this.tcpClient.write(this.nonce + '\n');
            this.tcpClient.uncork();
        });
        this.doWaitMsg()
    }

    protected doWaitMsg() {
        debugger;
        process.stdout.write('Waiting for VSCode session options...');
        process.stdout.uncork();
        const intervalMs = 10;
        let waitMs = 0;
        this.interval = setInterval(() => {
            // Do nothing for now
            if (!this.tcpCatClient) {
                waitMs = waitMs + intervalMs;
                if (waitMs > 1000) {
                    if (false) {
                        process.stdout.write('.');
                        process.stdout.uncork();
                    }
                    waitMs = 0;
                }
            } else if (this.interval) {
                clearInterval(this.interval);
            }
        }, intervalMs);
    }

    protected onDataCb(data: string | Buffer) {
        try {
            this._onDataCb(data.toString());
        }
        catch (e) {
            console.error(data.toString());
            reportCrash(e, true);
        }
    }
    protected _onDataCb(str: string) {
        clearInterval(this.interval);
        this.interval = null;

        let obj: any;
        try {
            str = this.oldData + str;
            if (str.endsWith('\n')) {
                obj = JSON.parse(str);
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

        if (obj.nonce === 'broadcast') {
            if (obj.data === 'exit') {
                this.closeClient();
            }
        } else {
            process.stdout.write(str);
            process.stdout.uncork();            
            if (this.nonce === obj.nonce) {
                if (obj.data === 'clear') {
                    if (this.tcpCatClient) {
                        this.tcpCatClient.clearAndPrompt();
                    }
                } else if (this.tcpCatClient) {
                    if (this.tcpCatClient.connected) {
                        // We are not expecting a new message while the gdb server is already running.
                        const msg = `Invalid message ${str} while gdb connection is still active`;
                        reportCrash(new Error(msg), true);
                    } else {
                        this.closeClient();
                    }
                } else {
                    this.options = obj;
                    this.tcpCatClient = new TcpConsole(this.options, true);
                    this.tcpCatClient.on('close', () => {
                        this.tcpCatClient = null;
                        this.doWaitMsg();
                    });
                    this.tcpCatClient.start();
                }
            } else {
                console.error(`Invalid message ${str} from VSCode. Nonce mismatch`);
            }
        }
    }

    private closeClient() {
        try {
            if (this.tcpCatClient) {
                this.tcpCatClient.end();
                this.tcpCatClient = null;
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
    const modes = Object.values(TerminalInputMode);
    const opts = new GetOpt([
        ['',    'port=ARG',     'tcpPort number with format "[host:]port'],
        ['',    'prompt=ARG',   'Optional prompt for terminal'],
        ['',    'noprompt',     'Do not display a prompt'],
        ['',    'clear',        'Clear screen/logfile on new connection'],
        ['',    'logfile=ARG',  'Log all IO to file'],
        ['',    'encoding=ARG', `Encoding for input and output. One of ${encodings.join(', ')}. For binary, ${bencodings.join(', ')}`],
        ['',    'inputmode',    `Input mode one of ${modes.join(', ')}`],
        ['',    'binary',       'Convert output to binary data with. Encoding must be signed, unsigned'],
        ['',    'scale=ARG,',   'Multiply binary data with given scale (float)'],
        ['',    'useserver=ARG','Reserved: all other options ignored. Options passed on socket'],
        ['',    'nonce=ARG',    'Reserved: a unique string id to indentify this instance'],
        ['h',   'help',         'display this help']
    ]);
    
    opts.parse(process.argv.slice(2));

    if (opts.options.useserver) {
        
        if (!opts.options.nonce/* || (opts.options.nonce.length !== 32)*/) {
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

    if (!opts.options.inputmode) {
        opts.options.inputmode = TerminalInputMode.COOKED;
    } else if (!(opts.options.inputmode in TerminalInputMode)) {
        console.error(`invalid inputmode ${opts.options.inputmode}. Must be ${modes.join(', ')}`);
        opts.showHelp();
        return;
    }

    const options: IRTTTerminalOptions = {
        port      : opts.options.port,
        prompt    : opts.options.prompt || '',
        noprompt  : !!opts.options.noprompt,
        clear     : !!opts.options.clear,
        logfile   : opts.options.logFile || '',
        inputmode : opts.options.inputmode,
        binary    : !!opts.options.binary,
        scale     : opts.options.scale || 1,
        encoding  : opts.options.encoding || (opts.options.binary ? 'unsigned' : 'utf8'),
        nonce     : 'cmd-line'
    };
    const tcpCat = new TcpConsole(options, false);
    tcpCat.start();
}

function reportCrash(e: any, hang: boolean = false) {
    console.error(e);
    if (e.stack) {
        console.error(e.stack);
    }
    if (hang) {
        console.error(`tcpCat crashed... Use Ctrl-C to exit ${e}`);
        setInterval(() => {
            console.error(`tcpCat crashed... Use Ctrl-C to exit ${e}`);
        }, 5000);
    }
}

try {
    process.on('uncaughtException', function(err) {
        reportCrash(err, true);
    });

    console.log('RTT Console: ' + process.argv.slice(2).join(' '));
    const flag = false;
    if (process.argv[2] === '??') {
        process.argv = process.argv.splice(2, 1);
        console.log('Waiting for debugger to attach...');
        const int = setInterval(() => {
             if (flag !== false) {
                 clearInterval(int);
                 main();
            }
        }, 1000);
    } else {
        main();
    }
}
catch (e) {
    reportCrash(e, true);
}

