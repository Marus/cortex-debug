import * as ChildProcess from 'child_process';
import * as os from 'os';
import * as net from 'net';
import { EventEmitter } from 'events';
import { setTimeout } from 'timers';
import { TcpPortScanner } from '../tcpportscanner';

export class GDBServer extends EventEmitter {
    private process: ChildProcess.ChildProcess;
    private outBuffer: string = '';
    private errBuffer: string = '';
    protected consoleSocket: net.Socket = null;
    private initResolve: (result: boolean) => void;
    private initReject: (error: any) => void;
    public static readonly SERVER_TIMEOUT = 10000;
    public static readonly LOCALHOST = '0.0.0.0';

    constructor(
        private cwd: string, private application: string, private args: string[],
        private initMatch: RegExp, private port: number|undefined, private consolePort: number) {
        super();
    }

    public init(): Thenable<any> {
        return new Promise((resolve, reject) => {
            if (this.application !== null) {
                this.initResolve = resolve;
                this.initReject = reject;
                this.connectToConsole().then(() => {
                    this.process = ChildProcess.spawn(this.application, this.args, { cwd: this.cwd });
                    this.process.stdout.on('data', this.onStdout.bind(this));
                    this.process.stderr.on('data', this.onStderr.bind(this));
                    this.process.on('exit', this.onExit.bind(this));
                    this.process.on('error', this.onError.bind(this));
                    
                    if (this.application.indexOf('st-util') !== -1 && os.platform() === 'win32') {
                        // For some reason we are not able to capture the st-util output on Windows
                        // For now assume that it will launch properly within 1/2 second and resolve the init
                        setTimeout(() => {
                            if (this.initResolve) {
                                this.initResolve(true);
                                this.initReject = null;
                                this.initResolve = null;
                            }
                        }, 500);
                    }
                    if (this.initMatch == null) {
                        // If there is no init match string (e.g. QEMU) assume launch in 1/2 second and resolve
                        setTimeout(() => {
                            if (this.initResolve) {
                                this.initResolve(true);
                                this.initReject = null;
                                this.initResolve = null;
                            }
                        }, 1000);
                    }
                });
            }
            else { // For servers like BMP that are always running directly on the probe
                this.connectToConsole();
                resolve(true);
            }
        });
    }

    public exit(): void {
        if (this.process) {
            console.log('GDBServer: forcing an exit')
            this.process.kill();
            this.process = null;
        }
    }

    private onExit(code, signal) {
        console.log(`GDBServer: exited ${code} ${signal}`);
        this.process = null;
        this.emit('exit', code, signal);
        this.disconnectConsole();
    }

    private onError(err) {
        if (this.initReject) {
            this.initReject(err);
            this.initReject = null;
            this.initResolve = null;
        }

        this.emit('launcherror', err);
    }

    private onStdout(data) {
        this.sendToConsole(data);        // Send it without any processing or buffering
        if (typeof data === 'string') { this.outBuffer += data; }
        else { this.outBuffer += data.toString('utf8'); }

        if (this.initResolve && this.initMatch.test(this.outBuffer)) {
            // console.log(`********* Got initmatch on stdout ${Date.now() - this.startTime}ms`);
            this.initResolve(true);
            this.initResolve = null;
            this.initReject = null;
        }

        const end = this.outBuffer.lastIndexOf('\n');
        if (end !== -1) {
            this.emit('output', this.outBuffer.substring(0, end));
            this.outBuffer = this.outBuffer.substring(end + 1);
        }
    }

    private onStderr(data) {
        this.sendToConsole(data);        // Send it without any processing or buffering
        if (typeof data === 'string') { this.errBuffer += data; }
        else { this.errBuffer += data.toString('utf8'); }

        if (this.initResolve && this.initMatch.test(this.errBuffer)) {
            // console.log(`********* Got initmatch on stderr ${Date.now() - this.startTime}ms`);
            this.initResolve(true);
            this.initResolve = null;
            this.initReject = null;
        }

        const end = this.errBuffer.lastIndexOf('\n');
        if (end !== -1) {
            this.emit('output', this.errBuffer.substring(0, end));
            this.errBuffer = this.errBuffer.substring(end + 1);
        }
    }

    protected connectToConsole(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const socket = new net.Socket();
            socket.on  ('data', (data) => {
                try {
                    this.process.stdin.write(data, 'utf8');
                }
                catch (e) {
                    console.error(`stdin write failed ${e}`);
                }
            });
            socket.once('close', () => {
                this.consoleSocket = null;
            });
            socket.on  ('error', (e) => {
                const msg = `Error: unexpected socket error ${e}. Please report this problem`;
                this.emit('output', msg + '\n');
                console.error(msg);
                resolve();
            });

            // It is possible that the server is not ready
            socket.connect(this.consolePort, '127.0.0.1', () => {
                this.consoleSocket = socket;
                resolve();
            });
        });
    }

    private sendToConsole(data: string|Buffer) {
        if (this.consoleSocket) {
            this.consoleSocket.write(data);
        } else {
            console.error('sendToConsole: console not open. How did this happen?');
        }
    }

    private disconnectConsole() {
        if (this.consoleSocket) {
            this.consoleSocket.destroy();
            this.consoleSocket = null;
        }
    }
}
