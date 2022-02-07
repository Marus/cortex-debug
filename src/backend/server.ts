import * as ChildProcess from 'child_process';
import * as os from 'os';
import * as net from 'net';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { setTimeout } from 'timers';
import { quoteShellCmdLine } from '../common';
import { greenFormat } from '../frontend/ansi-helpers';

export let GdbPid = -1;
export function ServerConsoleLog(str: string, usePid?: number) {
    try {
        const tmpDirName = os.tmpdir();
        const date = new Date();
        if (usePid) {
            GdbPid = usePid;
        }
        str = `[${date.toISOString()}] ppid=${process.pid} pid=${GdbPid} ` + str;
        console.log(str);
        if (true) {
            if (!str.endsWith('\n')) {
                str += '\n';
            }
            fs.appendFileSync(`${tmpDirName}/cortex-debug-server-exiting.log`, str);
        }
    }
    catch (e) {
        console.log(e.toString());
    }
}
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
        return new Promise(async (resolve, reject) => {
            if (this.application !== null) {
                this.initResolve = resolve;
                this.initReject = reject;
                try {
                    await this.connectToConsole();
                }
                catch (e) {
                    ServerConsoleLog('GDBServer: Could not connect to console: ' + e);
                    reject(e);
                }
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
                    // If there is no init match string (e.g. QEMU) assume launch in 100 ms and resolve
                    setTimeout(() => {
                        if (this.initResolve) {
                            this.initResolve(true);
                            this.initReject = null;
                            this.initResolve = null;
                        }
                    }, 100);
                }
            }
            else { // For servers like BMP that are always running directly on the probe
                resolve(true);
            }
        });
    }

    public isExternal(): boolean {
        return !this.application;
    }

    public isProcessRunning(): boolean {
        return !!this.process;
    }

    private exitTimeout: NodeJS.Timeout = null;
    private killInProgress = false;
    public exit(): void {
        if (this.process && !this.killInProgress) {
            try {
                ServerConsoleLog('GDBServer: forcing an exit with kill()');
                this.killInProgress = true;
                this.process.kill();
            }
            catch (e) {
                ServerConsoleLog(`Trying to force and exit failed ${e}`);
            }
        }
    }

    private onExit(code, signal) {
        ServerConsoleLog(`GDBServer: exited ${code} ${signal}`);
        this.process = null;
        if (this.exitTimeout) {
            clearTimeout(this.exitTimeout);
            this.exitTimeout = null;
        }
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
        if (this.initResolve) {
            if (typeof data === 'string') { this.outBuffer += data; }
            else { this.outBuffer += data.toString('utf8'); }

            if (this.initResolve && this.initMatch && this.initMatch.test(this.outBuffer)) {
                // console.log(`********* Got initmatch on stdout ${Date.now() - this.startTime}ms`);
                this.initResolve(true);
                this.initResolve = null;
                this.initReject = null;
            }

            const end = this.outBuffer.lastIndexOf('\n');
            if (end !== -1) {
                // this.emit('output', this.outBuffer.substring(0, end));
                this.outBuffer = this.outBuffer.substring(end + 1);
            }
        }
    }

    private onStderr(data) {
        this.sendToConsole(data);        // Send it without any processing or buffering
        if (this.initResolve) {
            if (typeof data === 'string') { this.errBuffer += data; }
            else { this.errBuffer += data.toString('utf8'); }

            if (this.initResolve && this.initMatch && this.initMatch.test(this.errBuffer)) {
                // console.log(`********* Got initmatch on stderr ${Date.now() - this.startTime}ms`);
                this.initResolve(true);
                this.initResolve = null;
                this.initReject = null;
            }

            const end = this.errBuffer.lastIndexOf('\n');
            if (end !== -1) {
                // this.emit('output', this.errBuffer.substring(0, end));
                this.errBuffer = this.errBuffer.substring(end + 1);
            }
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
                const code: string = (e as any).code;
                if (code !== 'ECONNRESET') {
                    // Can happen if extension exited while we are still running. Rare, generally a bug in VSCode or frontend
                    const msg = `Error: unexpected socket error ${e}. Please report this problem`;
                    this.emit('output', msg + '\n');
                    console.error(msg);
                    if (!this.consoleSocket) {  // We were already connected
                        reject(e);
                    }
                } else if (this.consoleSocket) {
                    // Adapter died/crashed
                    this.consoleSocket.destroy();
                    this.consoleSocket = null;
                }
            });

            // It is possible that the server is not ready
            socket.connect(this.consolePort, '127.0.0.1', () => {
                socket.write(greenFormat(quoteShellCmdLine([this.application, ...this.args]) + '\n'));
                this.consoleSocket = socket;
                resolve();
            });
        });
    }

    private sendToConsole(data: string|Buffer) {
        if (this.consoleSocket) {
            this.consoleSocket.write(data);
        } else {
            // This can happen if the socket is already closed (extension quit while in a debug session)
            console.error('sendToConsole: console not open. How did this happen?');
        }
    }

    private disconnectConsole() {
        try {
            if (this.consoleSocket) {
                this.consoleSocket.destroy();
                this.consoleSocket = null;
            }
        }
        catch (e) {}
    }
}
