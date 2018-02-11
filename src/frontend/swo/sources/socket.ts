import { SWOSource } from './common';
import { EventEmitter } from 'events';
import * as net from 'net';

export class SocketSWOSource extends EventEmitter implements SWOSource {
    private client: net.Socket = null;
    public connected: boolean = false;

    constructor(private SWOPort: number) {
        super();
        this.client = net.createConnection({ port: this.SWOPort, host: 'localhost' }, () => { this.connected = true; this.emit('connected'); });
        this.client.on('data', (buffer) => { this.emit('data', buffer); });
        this.client.on('end', () => { this.emit('disconnected'); });
    }

    public dispose() {
        this.client.destroy();
    }
}
