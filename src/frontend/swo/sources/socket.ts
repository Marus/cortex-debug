import { SWORTTSource } from './common';
import { EventEmitter } from 'events';
import * as net from 'net';
import { parseHostPort } from '../../../common';

export class SocketSWOSource extends EventEmitter implements SWORTTSource {
    protected client: net.Socket = null;
    public connected: boolean = false;
    public connError: any = null;

    constructor(public tcpPort: string) {
        super();
    }

    public start(): Promise<void> {
        return new Promise((resolve, reject) => {
            const obj = parseHostPort(this.tcpPort);
            this.client = net.createConnection(obj, () => {
                this.connected = true;
                this.emit('connected');
                resolve();
            });
            this.client.on('data', (buffer) => { this.emit('data', buffer); });
            this.client.on('end', () => { this.emit('disconnected'); });
            this.client.on('error', (e) => {
                const code: string = (e as any).code;
                if ((code === 'ECONNRESET') && this.connected) {
                    // Server closed the connection. Done with this session. Should we emit('disconnected')?
                    this.connected = false;
                    this.client = null;
                } else if (code === 'ECONNREFUSED') {
                    // We expect 'ECONNREFUSED' if the server has not yet started.
                    (e as any).message = `Error: Failed to connect to port ${this.tcpPort} ` + e.toString() || code;
                    this.emit('error', `Error: Failed to connect to port ${this.tcpPort} ${e}`)
                    this.connected = false;
                    this.client = null;
                    this.connError = e;
                    reject(e);
                } else {
                    (e as any).message = `Error: Ignored unknown error on port ${this.tcpPort} ` + e.toString() || code;
                    this.emit('error', e);
                }
            });
        });
    }

    public dispose() {
        try {
            if (this.client) {
                this.client.destroy();
            }
        }
        finally {
            this.client = null;
        }
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

