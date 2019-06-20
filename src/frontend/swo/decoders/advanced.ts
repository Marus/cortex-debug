import * as vscode from 'vscode';
import { SWODecoder } from './common';
import { SWOAdvancedDecoderConfig, AdvancedDecoder, GrapherDataMessage } from '../common';
import { EventEmitter } from 'events';
import { Packet } from '../common';

export class SWOAdvancedProcessor extends EventEmitter implements SWODecoder {
    private output: vscode.OutputChannel;
    public readonly format: string = 'advanced';
    private ports: number[];
    private decoder: AdvancedDecoder;
    
    constructor(config: SWOAdvancedDecoderConfig) {
        super();
        this.ports = [];

        const decoderPath = config.decoder;
        const resolved = require.resolve(decoderPath);
        if (require.cache[resolved]) { delete require.cache[resolved]; } // Force reload

        const decoderModule = require(decoderPath);

        if (decoderModule && decoderModule.default) {
            const decoderClass = decoderModule.default;

            try {
                this.decoder = new decoderClass();
                this.decoder.init(config, this.displayOutput.bind(this), this.graphData.bind(this));
            }
            catch (e) {
                throw new Error(`Error instantiating decoder class: ${e.toString()}`);
            }

            this.ports = config.ports;
            this.output = vscode.window.createOutputChannel(`SWO: ${this.decoder.outputLabel() || ''} [type: ${this.decoder.typeName()}]`);
        }
        else {
            throw new Error(`Unable to load decoder class from: ${config.decoder}`);
        }
    }

    public softwareEvent(packet: Packet) {
        if (this.ports.indexOf(packet.port) !== -1) {
            this.decoder.softwareEvent(packet.port, packet.data);
        }
    }

    public hardwareEvent(event: Packet) {}

    public synchronized() {
        this.decoder.synchronized();
    }

    public lostSynchronization() {
        this.decoder.lostSynchronization();
    }

    public displayOutput(output: string, timestamp: boolean = true) {
        this.output.append(output);
    }

    public graphData(data: number, id: string) {
        const message: GrapherDataMessage = { type: 'data', data: data, id: id };
        this.emit('data', message);
    }

    public dispose() {
        this.output.dispose();
    }
}
