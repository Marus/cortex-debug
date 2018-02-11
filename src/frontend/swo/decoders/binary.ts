import * as vscode from 'vscode';
import { SWODecoder } from './common';
import { SWOBinaryDecoderConfig } from '../common';
import { decoders as DECODER_MAP } from './utils';
import { Packet } from '../common';

function parseEncoded(buffer: Buffer, encoding: string) {
    return DECODER_MAP[encoding] ? DECODER_MAP[encoding](buffer) : DECODER_MAP.unsigned(buffer);
}

export class SWOBinaryProcessor implements SWODecoder {
    private output: vscode.OutputChannel;
    public readonly format: string = 'binary';
    private port: number;
    private scale: number;
    private encoding: string;

    constructor(config: SWOBinaryDecoderConfig) {
        this.port = config.port;
        this.scale = config.scale || 1;
        this.encoding = (config.encoding || 'unsigned').replace('.', '_');

        this.output = vscode.window.createOutputChannel(`SWO: ${config.label || ''} [port: ${this.port}, encoding: ${this.encoding}]`);
    }

    public softwareEvent(packet: Packet) {
        if (packet.port !== this.port) { return; }

        const date = new Date();
        
        const hexvalue = packet.data.toString('hex');
        const decodedValue = parseEncoded(packet.data, this.encoding);
        const scaledValue = decodedValue * this.scale;
        
        this.output.appendLine(`[${date.toISOString()}]   ${hexvalue} - ${decodedValue} - ${scaledValue}`);
    }

    public hardwareEvent(event: Packet) {}
    public synchronized() {}
    public lostSynchronization() {}

    public dispose() {
        this.output.dispose();
    }
}
