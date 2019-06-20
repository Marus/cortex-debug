import * as vscode from 'vscode';
import { SWODecoder } from './common';
import { decoders as DECODER_MAP } from './utils';
import { EventEmitter } from 'events';
import { SWOGraphDecoderConfig, GrapherDataMessage } from '../common';
import { Packet } from '../common';

function parseEncoded(buffer: Buffer, encoding: string) {
    return DECODER_MAP[encoding] ? DECODER_MAP[encoding](buffer) : DECODER_MAP.unsigned(buffer);
}

export class SWOGraphProcessor extends EventEmitter implements SWODecoder {
    public readonly format: string = 'graph';
    private port: number;
    private scale: number;
    private encoding: string;
    private graphId: string;

    constructor(config: SWOGraphDecoderConfig) {
        super();
        // core.socketServer.registerProcessor(this);
        this.port = config.port;
        this.encoding = config.encoding || 'unsigned';
        this.scale = config.scale || 1;
        this.graphId = config.graphId;
    }

    public softwareEvent(packet: Packet) {
        if (packet.port !== this.port) { return; }

        const raw = packet.data.toString('hex');
        const decodedValue = parseEncoded(packet.data, this.encoding);
        const scaledValue = decodedValue * this.scale;

        const message: GrapherDataMessage = { type: 'data', data: scaledValue, id: this.graphId };
        this.emit('message', message);
    }

    public hardwareEvent(event: Packet) {}
    public synchronized() {}
    public lostSynchronization() {}
    public dispose() {}
}
