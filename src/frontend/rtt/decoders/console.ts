import * as vscode from 'vscode';

import { RTTDecoder } from './common';
import { RTTConsoleDecoderConfig } from '../common';
import { RTTSource } from '../sources/common';

export class RTTConsoleProcessor implements RTTDecoder {
    private output: vscode.OutputChannel;
    private position: number = 0;
    public readonly format: string = 'console';
    private encoding: string;

    constructor(private source: RTTSource, private config: RTTConsoleDecoderConfig) {
        this.encoding = config.encoding || 'utf8';

        this.source.on('data', this.data.bind(this));
        if (this.source.connected) {
            this.createOutputChannel();
        } else {
            this.source.on('connected', this.createOutputChannel.bind(this));
        }
    }

    private createOutputChannel() {
        this.output = vscode.window.createOutputChannel(`RTT: ${this.config.label || ''} [channel: ${this.config.channel}, type: console]`);
        if (this.config.showOnStartup) {
            this.output.show(true);
        }
    }

    public data(packet: Buffer) {
        const letters = packet.toString(this.encoding);

        for (const letter of letters) {
            if (letter === '\n') {
                this.output.append('\n');
                this.position = 0;
                continue;
            }

            if (this.position === 0 && this.config.timestamp) {
                const date = new Date();
                const header = `[${date.toISOString()}]   `;
                this.output.append(header);
            }

            this.output.append(letter);
            this.position += 1;

            if (this.position >= 80) {
                this.output.append('\n');
                this.position = 0;
            }
        }
    }

    public dispose() {
        this.source.dispose();
        this.output.dispose();
    }
}
