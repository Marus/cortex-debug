const WebSocket = require('ws');
import { SWOGraphProcessor } from './decoders/graph';
import { WebsocketMessage, GraphConfiguration } from './common';
import { SWOAdvancedProcessor } from './decoders/advanced';
const RingBuffer = require('ringbufferjs');

export class SWOSocketServer {
    private processors: Array<SWOGraphProcessor|SWOAdvancedProcessor>;
    private socket: any;
    private messageBuffer = new RingBuffer(250000);
    public currentStatus: string = 'stopped';

    constructor(serverPort: number, public graphs: GraphConfiguration[]) {
        this.processors = [];
        this.socket = new WebSocket.Server({ port: serverPort });
        this.socket.on('connection', this.connected.bind(this));
    }

    private connected(client) {
        client.on('message', (message) => this.message(client, message));
        client.send(JSON.stringify({ type: 'configure', graphs: this.graphs, status: this.currentStatus }));
    }

    private chunk(array, size) {
        const results = [];
        while (array.length) {
            results.push(array.splice(0, size));
        }
        return results;
    }

    private message(client, message) {
        const msg = JSON.parse(message);
        if (msg.history) {
            const hm = this.messageBuffer.peekN(this.messageBuffer.size());
            const chunks = this.chunk(hm, 500);
            chunks.forEach((chunk, idx) => {
                setTimeout(() => {
                    client.send(JSON.stringify({
                        type: 'history',
                        messages: chunk
                    }));
                }, idx * 5);
            });
        }
    }

    public registerProcessor(processor: SWOGraphProcessor | SWOAdvancedProcessor) {
        processor.on('message', this.broadcastMessage.bind(this));
        this.processors.push(processor);
    }

    public broadcastMessage(message: WebsocketMessage) {
        const encoded = JSON.stringify(message);
        this.socket.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(encoded);
            }
        });
        this.messageBuffer.enq(message);
    }

    public dispose() {
        this.socket.close();
    }
}
