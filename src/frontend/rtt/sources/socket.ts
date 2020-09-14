import { RTTSource } from './common';
import { EventEmitter } from 'events';
import * as net from 'net';

export class SocketRTTSource extends EventEmitter implements RTTSource {
    private client: net.Socket = null;
    public connected: boolean = false;

    constructor(private RTTHost: string, private RTTChannel: number) {
        super();
        this.client = net.createConnection({ port: 19021, host: this.RTTHost }, () => {
            this.client.write(`$$SEGGER_TELNET_ConfigStr=RTTCh;${this.RTTChannel};$$`);
            this.connected = true;
            this.emit('connected');
        });
        this.client.on('data', (buffer) => { this.emit('data', buffer); });
        this.client.on('end', () => { this.emit('disconnected'); });
    }

    public dispose() {
        this.client.destroy();
    }
}
