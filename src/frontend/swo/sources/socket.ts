import { SWORTTSource } from './common';
import { EventEmitter } from 'events';
import * as net from 'net';

export class SocketSWOSource extends EventEmitter implements SWORTTSource {
    private client: net.Socket = null;
    public connected: boolean = false;

    constructor(private SWOPort: string) {
        super();
        let port: number;
        let host = 'localhost';
        const match = this.SWOPort.match(/(.*)\:([0-9]+)/);
        if (match) {
            host = match[1] ? match[1] : host;
            port = parseInt(match[2], 10);
        } else {
            port = parseInt(SWOPort, 10);
        }
        this.client = net.createConnection({ port: port, host: host }, () => { this.connected = true; this.emit('connected'); });
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

