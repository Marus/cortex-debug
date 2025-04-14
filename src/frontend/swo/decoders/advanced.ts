import * as vscode from 'vscode';
import { SWORTTDecoder } from './common';
import { SWOAdvancedDecoderConfig, AdvancedDecoder, GrapherDataMessage } from '../common';
import { EventEmitter } from 'events';
import { Packet } from '../common';
import { CortexDebugChannel } from '../../../dbgmsgs';
import { HrTimer } from '../../../common';

declare function __webpack_require__();
declare const __non_webpack_require__: NodeRequire;
const dynamicRequire = typeof __webpack_require__ === 'function' ? __non_webpack_require__ : require;

export class SWORTTAdvancedProcessor extends EventEmitter implements SWORTTDecoder {
    private output: vscode.OutputChannel;
    public readonly format: string = 'advanced';
    private ports: number[];
    private decoder: AdvancedDecoder;
    private timer = new HrTimer();

    constructor(config: SWOAdvancedDecoderConfig) {
        super();
        this.ports = [];

        const decoderPath = config.decoder;
        const resolved = dynamicRequire.resolve(decoderPath);
        if (dynamicRequire.cache[resolved]) { delete dynamicRequire.cache[resolved]; } // Force reload

        const decoderModule = dynamicRequire(decoderPath);

        if (decoderModule && decoderModule.default) {
            const decoderClass = decoderModule.default;
            this.ports = config.ports;

            try {
                this.decoder = new decoderClass();
            } catch (e) {
                throw new Error(`Error instantiating decoder class: ${e.toString()}`);
            }
            try {
                this.decoder.init(config, this.displayOutput.bind(this), this.graphData.bind(this));
                this.output = vscode.window.createOutputChannel(`SWO/RTT: ${this.decoder.outputLabel() || ''} [type: ${this.decoder.typeName()}]`);
            } catch (e) {
                throw new Error(`Error initializing decoder class. Potential issues with outputLabel(), typeName() or init(): ${e.toString()}`);
            }
        } else {
            throw new Error(`Unable to load decoder class from: ${config.decoder}`);
        }
    }

    public softwareEvent(packet: Packet) {
        if (this.ports.indexOf(packet.port) !== -1) {
            if (this.decoder) {
                try {
                    this.decoder.softwareEvent(packet.port, packet.data);
                } catch (e) {
                    CortexDebugChannel.debugMessage('Error: in softwareEvent() for decoder ' + e.toString());
                }
            }
        }
    }

    public hardwareEvent(event: Packet) {}

    public synchronized() {
        try {
            this.decoder?.synchronized();
        } catch (e) {
            CortexDebugChannel.debugMessage('Error: in synchronized() for decoder ' + e.toString());
        }
    }

    public lostSynchronization() {
        try {
            this.decoder?.lostSynchronization();
        } catch (e) {
            CortexDebugChannel.debugMessage('Error: in lostSynchronization() for decoder ' + e.toString());
        }
    }

    public displayOutput(output: string, timestamp: boolean = false) {
        if (this.output) {
            if (timestamp) {
                output = this.timer.createDateTimestamp() + ' ' + output;
            }
            this.output.append(output);
        } else {
            CortexDebugChannel.debugMessage(`Error: displayOutput(${output}) called before decoder was fully initialized`);
        }
    }

    public graphData(data: number, id: string) {
        const message: GrapherDataMessage = { type: 'data', data: data, id: id };
        this.emit('message', message);
    }

    public dispose() {
        try {
            this.output.dispose();
        } finally {
            this.output = undefined;
            this.close();
        }
    }

    public close() {
        if (this.decoder?.dispose) {
            try {
                this.decoder.dispose();
            } catch (e) {
                CortexDebugChannel.debugMessage('Error: in dispose() for decoder ' + e.toString());
            }
            this.decoder = undefined;
        }
    }
}
