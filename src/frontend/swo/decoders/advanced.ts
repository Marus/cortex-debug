import * as vscode from 'vscode';
import { SWODecoder } from './common';
import { SWOAdvancedDecoderConfig, WebsocketDataMessage, AdvancedDecoder } from '../common';
import { decoders as DECODER_MAP } from './utils';
import { EventEmitter } from 'events';
import { decoders } from './utils';
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
        const decoderModule = require(decoderPath);

        if (decoderModule && decoderModule.default) {
            const decoderClass = decoderModule.default;

            try {
                this.decoder = new decoderClass(config.config, decoders, this.displayOutput.bind(this), this.graphData.bind(this));
            }
            catch (e) {
                vscode.window.showErrorMessage(`Error instantiating decoder class: ${e.toString()}`);
                return;
            }

            this.ports = config.ports;
            this.output = vscode.window.createOutputChannel(`SWO: ${this.decoder.outputLabel() || ''} [type: ${this.decoder.name}]`);
        }
        else {
            vscode.window.showErrorMessage(`Unable to load decoder class from: ${config.decoder}`);
        }
        
    }

    public softwareEvent(packet: Packet) {
        // this.decoder.softwareEvent(buffer);
    }

    public hardwareEvent(event: Packet) {}
    public synchronized() {}
    public lostSynchronization() {}

    public displayOutput(output: string) {
        this.output.append(output);
    }

    public graphData(data: number, id: string) {
        const message: WebsocketDataMessage = { type: 'data', timestamp: new Date().getTime(), data: data, id: id };
        this.emit('data', message);
    }

    public dispose() {
        this.output.dispose();
    }
}
