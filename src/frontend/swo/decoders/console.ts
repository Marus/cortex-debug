import * as vscode from 'vscode';

import { SWORTTDecoder } from './common';
import { parseUnsigned } from './utils';
import { SWOConsoleDecoderConfig } from '../common';
import { Packet } from '../common';

export class SWOConsoleProcessor implements SWORTTDecoder {
    private positionCount: number;
    private output: vscode.OutputChannel;
    private position: number = 0;
    private timeout: any = null;
    public readonly format: string = 'console';
    private port: number;
    private encoding: string;
    private showOutputTimer: any = null;
    
    constructor(config: SWOConsoleDecoderConfig) {
        this.port = config.port;
        this.encoding = config.encoding || 'utf8';
        this.output = vscode.window.createOutputChannel(`SWO: ${config.label || ''} [port: ${this.port}, type: console]`);

        // A work-around. A blank display will appear if the output is shown immediately 
        if (config.showOnStartup) {       
            this.showOutputTimer = setTimeout(() => {
                this.output.show(true);
                this.showOutputTimer = null;
            }, 1);
        }
    }

    public softwareEvent(packet: Packet) {
        if (packet.port !== this.port) { return; }

        const letters = packet.data.toString(this.encoding);

        for (const letter of letters) {
            if (this.timeout) { clearTimeout(this.timeout); this.timeout = null; }

            if (letter === '\n') {
                this.output.append('\n');
                this.position = 0;
                return;
            }

            if (this.position === 0) {
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
            else {
                this.timeout = setTimeout(() => {
                    this.output.append('\n');
                    this.position = 0;
                    this.timeout = null;
                }, 5000);
            }
        }
    }

    public hardwareEvent(event: Packet) {}
    public synchronized() {}
    public lostSynchronization() {}

    public dispose() {
        this.output.dispose();
    }
}
