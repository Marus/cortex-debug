var WebSocket = require('ws');
import { SWOGraphProcessor } from './decoders/graph';
import { WebsocketMessage, GraphConfiguration } from './common';
import { SWOAdvancedProcessor } from './decoders/advanced';

export class SWOSocketServer {
	processors: (SWOGraphProcessor|SWOAdvancedProcessor)[];
	socket: any;
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

	message(client, message) {
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
	}

	dispose() {
		this.socket.close();
	}
}