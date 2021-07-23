import * as vscode from 'vscode';
import { SWORTTDecoder } from './common';
import { SWOBinaryDecoderConfig } from '../common';
import { decoders as DECODER_MAP } from './utils';
import { Packet } from '../common';

function parseEncoded(buffer: Buffer, encoding: string) {
    return DECODER_MAP[encoding] ? DECODER_MAP[encoding](buffer) : DECODER_MAP.unsigned(buffer);
}

export class SWOBinaryProcessor implements SWORTTDecoder {
    private output: vscode.OutputChannel;
    public readonly format: string = 'binary';
    private port: number;
    private scale: number;
    private encoding: string;

    constructor(config: SWOBinaryDecoderConfig, prefix: string = 'SWO') {
        this.port = config.port;
        this.scale = config.scale || 1;
        this.encoding = (config.encoding || 'unsigned').replace('.', '_');

        const source = (prefix !== 'SWO') ? 'channel' : 'port';
        const chName = `${prefix}: ${config.label || ''} [${source}: ${this.port}, encoding: ${this.encoding}]`;
        this.output = vscode.window.createOutputChannel(chName);
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
