import NetcatClient = require('netcat/client');
import { EventEmitter } from 'stream';
import GetOpt = require('node-getopt');

export class RTTNetCat extends EventEmitter {
    protected ncClient: NetcatClient = null;
    protected waiting: false;
    protected connected = false;

    constructor (public readonly host: string, private readonly port: number) {
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
            this.ncClient.send(data);
            this.writePrompt();
        } else {
            // Yes, we choose to lose any data that came in before the connection was ready
        }        
    }

    public start() {
        this.ncClient = new NetcatClient();

        // Wait for the connection happen. Keep trying until we get a connection
        const wiatForPort = setInterval(() => {
            this.ncClient.addr(this.host).port(this.port).connect(() => {
                clearInterval(wiatForPort);                
                this.writeAndFlush('Connected.\n')
                this.ncClient.once('close', () => {
                    this.writeAndFlush(this.unPrompt + 'Connection ended. Waiting for next connection...\n');
                    this.connected = false;
                    this.ncClient = null;
                    process.nextTick(() => {
                        this.start();
                    });
                });

                this.writePrompt();
                this.connected = true;

                // this.ncClient.on('data', ...) does not work -- it has a bug
                this.ncClient.client.on('data', (data: string) => {
                    this.writeData(data);
                });
            });
        }, 100);
    }

    readonly ESC = '\x1b';              // ASCII escape character
    readonly CSI = this.ESC + '[';      // control sequence introducer
    readonly KILLLINE = this.CSI + 'K';
    private prompt = '';
    private unPrompt = '';
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
        this.writeAndFlush(this.prompt);
    }

    private writeData(data: string) {
        process.stdout.write(this.unPrompt + data);
        this.writePrompt();        
    }
}

function main() {
    const args = process.argv.slice(2);
    const opts = new GetOpt([
        ['',    'port=ARG',     'tcpPort number with format "[host:]port'],
        ['',    'prompt=ARG',   'Optional prompt for terminal'],
        ['h',   'help',         'display this help']
    ]);
    
    opts.parse(process.argv.slice(2));
    let port = opts.options.port;
    let host = '127.0.0.1';
    if (!port || opts.options.help) {
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
        netCat.setPrompt(opts.options.prompt)
    }

    netCat.start();
}

console.log('RTT Console: ' + process.argv.slice(2).join(' '));
main();
