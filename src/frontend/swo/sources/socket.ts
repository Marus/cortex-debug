import { SWORTTSource } from './common';
import { EventEmitter } from 'events';
import * as net from 'net';
import { parseHostPort } from '../common';

export class SocketSWOSource extends EventEmitter implements SWORTTSource {
    private client: net.Socket = null;
    public connected: boolean = false;

    constructor(private SWOPort: string) {
        super();
        const obj = parseHostPort(SWOPort);
        this.client = net.createConnection(obj, () => { this.connected = true; this.emit('connected'); });
        this.client.on('data', (buffer) => { this.emit('data', buffer); });
        this.client.on('end', () => { this.emit('disconnected'); });
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

