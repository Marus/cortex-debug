import { SWORTTSource } from './common';
import { EventEmitter } from 'events';
import * as net from 'net';
import { parseHostPort } from '../../../common';
import * as vscode from 'vscode';

const TimerInterval = 250;
export class SocketSWOSource extends EventEmitter implements SWORTTSource {
    protected client: net.Socket = null;
    public connected: boolean = false;
    public connError: any = null;
    private timer: NodeJS.Timeout;
    public nTries = 1;

    constructor(public tcpPort: string) {
        super();
    }

    // Default wait time is about 5 minutes
    public start(maxTries = (1000 * 60 * 5) / TimerInterval): Promise<void> {
        const obj = parseHostPort(this.tcpPort);
        return new Promise((resolve, reject) => {
            this.timer = setInterval(() => {
                this.client = net.createConnection(obj, () => {
                    clearInterval(this.timer);
                    this.timer = undefined;
                    this.connected = true;
                    this.emit('connected');
                    console.log(`Connected SWO/RTT port ${this.tcpPort}, nTries = ${this.nTries}\n`);
                    resolve();
                });
                this.client.on('data', (buffer) => {
                    this.emit('data', buffer);
                });
                this.client.on('end', () => {
                    this.emit('disconnected');
                    this.dispose();
                });
                this.client.on('error', (e) => {
                    const code: string = (e as any).code;
                    if ((code === 'ECONNRESET') && this.connected) {
                        // Server closed the connection. Done with this session. Should we emit('disconnected')?
                        if (!this.connected) {  // This should never be true
                            this.connError = e;
                            reject(e);
                        }
                        this.dispose();
                    } else if (code === 'ECONNREFUSED') {
                        // We expect 'ECONNREFUSED' if the server has not yet started.
                        if (this.nTries > maxTries) {
                            (e as any).message = `Error: Failed to connect to port ${this.tcpPort} ${code}`;
                            console.log(`Failed ECONNREFUSED SWO/RTT port ${this.tcpPort}, nTries = ${this.nTries}`);
                            this.connError = e;
                            this.emit('error', e);
                            reject(e);
                            this.dispose();
                        } else {
                            if ((this.nTries % 10) === 0) {
                                console.log(`Trying SWO/RTT port ${this.tcpPort}, nTries = ${this.nTries}`);
                            }
                            this.nTries++;
                            this.disposeClient();
                        }
                    } else {
                        (e as any).message = `Error: Ignored unknown error on port ${this.tcpPort} ${code}`;
                        this.emit('error', e);
                        if (!this.connected) {
                            this.connError = e;
                            reject(e);
                        }
                        this.dispose();
                    }
                });
            }, TimerInterval);
        });
    }

    private disposeClient() {
        try {
            if (this.client) {
                this.client.destroy();
            }
        }
        finally {
            this.client = null;
            this.connected = false;
        }
    }

    public dispose() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        this.disposeClient();
    }
}

export class SocketRTTSource extends SocketSWOSource {
    constructor(tcpPort: string, public readonly channel: number) {
        super(tcpPort);
    }
    
    public write(data) {
        try {
            this.client.write(data);
        }
        catch (e) {
            throw e;
        }
    }
}
