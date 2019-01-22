import * as ChildProcess from 'child_process';
import * as os from 'os';
import { EventEmitter } from 'events';
import { setTimeout } from 'timers';

export class GDBServer extends EventEmitter {
    private process: any;
    private outBuffer: string = '';
    private errBuffer: string = '';
    private initResolve: (result: boolean) => void;
    private initReject: (error: any) => void;

    constructor(private application: string, private args: string[], private initMatch: RegExp) {
        super();
    }

    public init(): Thenable<any> {
        return new Promise((resolve, reject) => {
            if (this.application !== null) {
                this.initResolve = resolve;
                this.initReject = reject;

                this.process = ChildProcess.spawn(this.application, this.args, {});
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
            }
            else { // For servers like BMP that are always running directly on the probe
                resolve();
            }
        });
    }

    public exit(): void {
        if (this.process) {
            this.process.kill();
        }
    }

    private onExit(code, signal) {
        this.emit('exit', code, signal);
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
        if (typeof data === 'string') { this.outBuffer += data; }
        else { this.outBuffer += data.toString('utf8'); }

        if (this.initResolve && this.initMatch.test(this.outBuffer)) {
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
        if (typeof data === 'string') { this.errBuffer += data; }
        else { this.errBuffer += data.toString('utf8'); }

        if (this.initResolve && this.initMatch.test(this.errBuffer)) {
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
}
