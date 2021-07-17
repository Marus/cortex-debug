import NetcatClient = require('netcat/client');
import { EventEmitter } from 'stream';
import GetOpt = require('node-getopt');
import * as fs from 'fs';

export class RTTNetCat extends EventEmitter {
    protected ncClient: NetcatClient = null;
    protected waiting: false;
    protected connected = false;
    public logFile: string = '';
    private logFd: number = -1;
    private firstConnect = true;
    private done = false;

    constructor (
        public readonly host: string,
        private readonly port: number,
        public clearOnConnect?: boolean) {
        super();
        process.stdin.on('data', (data) => {
            this.sendData(data);
        });
        process.stdin.on('end', () => {
            this.done = true;
            process.exit(0);
        });

        this.setPrompt(`${this.host}:${this.port}> `);
    }

    private sendData(data: string) {
        if (this.connected) {
            this.ncClient.send(data);
            this.writePrompt();
            this.logData(data);
        } else {
            // Yes, we choose to lose any data that came in before the connection was ready
        }        
    }

    public start() {
        this.writeAndFlush(`Waiting for connection on port ${this.host}:${this.port}...`);
        this.ncClient = new NetcatClient();

        // Wait for the connection happen. Keep trying until we get a connection
        const wiatForPort = setInterval(() => {
            this.ncClient.addr(this.host).port(this.port).connect(() => {
                clearInterval(wiatForPort);                
                this.writeAndFlush('Connected.\n')
                this.ncClient.once('close', () => {
                    this.onCloseCb();
                });

                this.clearAndPrompt();
                this.openLogFile();
                this.connected = true;
                this.firstConnect = false;

                // this.ncClient.on('data', ...) does not work -- it has a bug
                this.ncClient.client.on('data', (data) => {
                    try {
                        this.writeData(data);
                        this.logData(data);
                    }
                    catch (e) {
                        console.error(e);
                    }
                });
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
    }
    
    private clearAndPrompt() {
        if (this.clearOnConnect) {
            process.stdout.write(this.CSI + '3J');
        }
        this.writePrompt();
    }

    private onCloseCb() {
        this.writeAndFlush('\nConnection ended. ');
        if (this.logFd >= 0) {
            try {
                fs.closeSync(this.logFd);
            }
            finally {
                this.logFd = -1;
            }
        }

        this.connected = false;
        this.ncClient = null;
        if (!this.done) {
            process.nextTick(() => {
                this.start();
            });
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

        process.stdout.write(data);

        const type = typeof data;
        if (false) {
            // We are sometimes getting a string and others a Uint8Array
            console.error(Object.prototype.toString.call(data));
            console.error(type);
        }

        // Unnessarily complicated to figure out input ends with a newline
        let endsWithNl = false;
        if (type === 'string') {
            endsWithNl = (data as string).endsWith('\n');
        } else {
            const ary = (data as unknown as Uint8Array);
            endsWithNl = ary[data.length-1] === 10;
        }

        // If we have a partial line or even a prompt from the server end,
        // do not print a prompt
        if (endsWithNl) {
            this.writePrompt();
        } else {
            process.stdout.uncork();
        }
    }
}

function main() {
    const args = process.argv.slice(2);
    const opts = new GetOpt([
        ['',    'port=ARG',     'tcpPort number with format "[host:]port'],
        ['',    'prompt=ARG',   'Optional prompt for terminal'],
        ['',    'noprompt',     'Do not display a prompt'],
        ['',    'clear',        'Clear screen on new connection'],
        ['',    'logfile=ARG',  'Log all IO to file'],
        ['h',   'help',         'display this help']
    ]);
    
    opts.parse(process.argv.slice(2));
    let port = opts.options.port;
    let host = '127.0.0.1';
    if (!port || opts.options.help || (opts.options.prompt && opts.options.noprompt)) {
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

    const netCat = new RTTNetCat(host, parseInt(port));
    if (opts.options.prompt) {
        netCat.setPrompt(opts.options.prompt);
    } else if (opts.options.noprompt) {
        netCat.setPrompt('');
    }

    if (opts.options.clear) {
        netCat.clearOnConnect = true;
    }

    if (opts.options.logfile) {
        netCat.logFile = opts.options.logfile;
    }

    netCat.start();
}

try {
    console.log('RTT Console: ' + process.argv.slice(2).join(' '));
    main();
}
catch (e) {
    console.error(e);
}
