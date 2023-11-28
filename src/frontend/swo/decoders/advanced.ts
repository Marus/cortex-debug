import * as vscode from 'vscode';
import { SWORTTDecoder } from './common';
import { SWOAdvancedDecoderConfig, AdvancedDecoder, GrapherDataMessage } from '../common';
import { EventEmitter } from 'events';
import { Packet } from '../common';

declare function __webpack_require__();
declare const __non_webpack_require__: NodeRequire;
const dynamicRequire = typeof __webpack_require__ === 'function' ? __non_webpack_require__ : require;

export class SWORTTAdvancedProcessor extends EventEmitter implements SWORTTDecoder {
    private output: vscode.OutputChannel;
    public readonly format: string = 'advanced';
    private ports: number[];
    private decoder: AdvancedDecoder;
    
    constructor(config: SWOAdvancedDecoderConfig) {
        super();
        this.ports = [];

        const decoderPath = config.decoder;
        const resolved = dynamicRequire.resolve(decoderPath);
        if (dynamicRequire.cache[resolved]) { delete dynamicRequire.cache[resolved]; } // Force reload

        const decoderModule = dynamicRequire(decoderPath);

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
        this.emit('message', message);
    }

    public dispose() {
        this.output.dispose();
        this.close();
    }

    public close() {
    }
}
