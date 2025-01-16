import * as vscode from 'vscode';
import * as fs from 'fs';
import { SWORTTDecoder } from './common';
import { decoders as DECODER_MAP } from './utils';
import { EventEmitter } from 'events';
import { SWOGraphDecoderConfig, GrapherDataMessage } from '../common';
import { Packet } from '../common';

function parseEncoded(buffer: Buffer, encoding: string) {
    return DECODER_MAP[encoding] ? DECODER_MAP[encoding](buffer) : DECODER_MAP.unsigned(buffer);
}

export class SWORTTGraphProcessor extends EventEmitter implements SWORTTDecoder {
    public readonly format: string = 'graph';
    private port: number;
    private scale: number;
    private encoding: string;
    private graphId: string;
    private logFd: number = -1;
    private logfile: string;

    constructor(config: SWOGraphDecoderConfig) {
        super();
        // core.socketServer.registerProcessor(this);
        this.port = config.port;
        this.encoding = config.encoding || 'unsigned';
        this.scale = config.scale || 1;
        this.graphId = config.graphId;
        if (config.logfile) {
            this.logfile = config.logfile;
            try {
                this.logFd = fs.openSync(config.logfile, 'w');
            } catch (e) {
                const msg = `Could not open file ${config.logfile} for writing. ${e.toString()}`;
                vscode.window.showErrorMessage(msg);
            }
        }
    }

    public softwareEvent(packet: Packet) {
        if (packet.port !== this.port) { return; }

        const raw = packet.data.toString('hex');
        const decodedValue = parseEncoded(packet.data, this.encoding);
        const scaledValue = decodedValue * this.scale;

        const message: GrapherDataMessage = { type: 'data', data: scaledValue, id: this.graphId };
        this.emit('message', message);

        if (this.logFd >= 0) {
            try {
                fs.writeSync(this.logFd, packet.data);
            } catch (e) {
                const msg = `Could not write to file ${this.logfile} for writing. ${e.toString()}`;
                vscode.window.showErrorMessage(msg);
                try {
                    fs.closeSync(this.logFd);
                } catch {
                }
                this.logFd = -1;
            }
        }
    }

    public hardwareEvent(event: Packet) {}
    public synchronized() {}
    public lostSynchronization() {}
    public dispose() { this.close(); }

    public close() {
        if (this.logFd >= 0) {
            fs.closeSync(this.logFd);
            this.logFd = -1;
        }
    }
}
