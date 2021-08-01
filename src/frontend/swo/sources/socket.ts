import { SWORTTSource } from './common';
import { EventEmitter } from 'events';
import * as net from 'net';
import { parseHostPort } from '../../../common';
import { getVSCodeDownloadUrl } from 'vscode-test/out/util';

export class SocketSWOSource extends EventEmitter implements SWORTTSource {
    private client: net.Socket = null;
    public connected: boolean = false;

    constructor(private SWOPort: string) {
        super();
    }

    public start(): Promise<void> {
        return new Promise((resolve, reject) => {
            const obj = parseHostPort(this.SWOPort);
            this.client = net.createConnection(obj, () => {
                this.connected = true;
                this.emit('connected');
                resolve();
            });
            this.client.on('data', (buffer) => { this.emit('data', buffer); });
            this.client.on('end', () => { this.emit('disconnected'); });
            this.client.on('error', (e) => { reject(e); });
        });
    }

    public dispose() {
        this.client.destroy();
    }
}

export class SocketRTTSource extends SocketSWOSource {
    constructor(SWOPort: string, public readonly channel: number) {
        super(SWOPort);
    }
}

