import { EventEmitter } from 'stream';
import GetOpt = require('node-getopt');
import * as net from 'net';
import * as fs from 'fs';

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
        public clearOnConnect?: boolean) {
        super();
        process.stdin.on('data', (data) => {
            this.sendData(data);
        });
        process.stdin.on('end', () => {
            process.exit(0);
        });

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

function main() {
    const args = process.argv.slice(2);
    const encodings: string[] = ["ascii", "utf8", "ucs2", "utf16le"];
    const opts = new GetOpt([
        ['',    'port=ARG',     'tcpPort number with format "[host:]port'],
        ['',    'prompt=ARG',   'Optional prompt for terminal'],
        ['',    'noprompt',     'Do not display a prompt'],
        ['',    'clear',        'Clear screen on new connection'],
        ['',    'logfile=ARG',  'Log all IO to file'],
        ['',    'encoding=ARG', `Encoding for input and output. One of ${encodings.join(", ")}`],
        ['',    'raw',          'Input will not be buffered, raw mode'],
        ['',    'rawecho',      'Input will not be buffered, raw mode. Will echo chars and carriage returns'],
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
    if (enc && (encodings.findIndex((str) => (str === enc)) < 0)) {
        console.error(`Unknown encoding ${enc}`);
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

    const tcpCat = new TcpCat(host, parseInt(port));
    if (opts.options.prompt) {
        tcpCat.setPrompt(opts.options.prompt);
    } else if (opts.options.noprompt) {
        tcpCat.setPrompt('');
    }

    if (opts.options.clear) {
        tcpCat.clearOnConnect = true;
    }

    if (opts.options.logfile) {
        tcpCat.logFile = opts.options.logfile;
    }

    if (enc) {
        tcpCat.encoding = enc;
        process.stdin.setEncoding(enc);
        process.stdout.setEncoding(enc);
    }

    if (process.stdin.isTTY && (opts.options.raw || opts.options.rawecho)) {
        if (opts.options.rawecho) {
            tcpCat.echoChars = true;
        }
        process.stdin.setRawMode(true);
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
