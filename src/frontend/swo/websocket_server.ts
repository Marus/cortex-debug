var WebSocket = require('ws');
import { SWOGraphProcessor } from './decoders/graph';
import { WebsocketMessage, GraphConfiguration } from './common';
import { SWOAdvancedProcessor } from './decoders/advanced';
var RingBuffer = require('ringbufferjs');

export class SWOSocketServer {
	processors: (SWOGraphProcessor|SWOAdvancedProcessor)[];
	socket: any;
	messageBuffer = new RingBuffer(250000);
	currentStatus: string = 'stopped';

	constructor(serverPort: number, public graphs: GraphConfiguration[]) {
		this.processors = [];
		this.socket = new WebSocket.Server({ port: serverPort });
		this.socket.on('connection', this.connected.bind(this));
	}

	connected(client) {
		client.on('message', (message) => this.message(client, message));
		client.send(JSON.stringify({ type: 'configure', 'graphs': this.graphs, 'status': this.currentStatus }));
	}

	private chunk(array, size) {
		var results = [];
		while (array.length) {
			results.push(array.splice(0, size));
		}
		return results;
	}

	message(client, message) {
		let msg = JSON.parse(message);
		if (msg.history) {
			let hm = this.messageBuffer.peekN(this.messageBuffer.size());
			let chunks = this.chunk(hm, 500);
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

	registerProcessor(processor: SWOGraphProcessor | SWOAdvancedProcessor) {
		processor.on('message', this.broadcastMessage.bind(this));
		this.processors.push(processor);
	}

	broadcastMessage(message: WebsocketMessage) {
		let encoded = JSON.stringify(message);
		this.socket.clients.forEach(client => {
			if(client.readyState == WebSocket.OPEN) {
				client.send(encoded);
			}
		});
		this.messageBuffer.enq(message);
	}

	dispose() {
		this.socket.close();
	}
}