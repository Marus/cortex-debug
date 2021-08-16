import * as vscode from 'vscode';

import { SWORTTDecoder } from './common';
import { SWOConsoleDecoderConfig } from '../common';
import { Packet } from '../common';
import { IPtyTerminalOptions, PtyTerminal } from '../../pty';
import { TerminalInputMode } from '../../../common';

export class SWOConsoleProcessor implements SWORTTDecoder {
    private positionCount: number;
    private output: vscode.OutputChannel;
    private position: number = 0;
    private timeout: any = null;
    public readonly format: string = 'console';
    private port: number;
    private encoding: string;
    private showOutputTimer: any = null;
    private useTerminal = true;
    private ptyTerm: PtyTerminal = null;
    
    constructor(config: SWOConsoleDecoderConfig) {
        this.port = config.port;
        this.encoding = config.encoding || 'utf8';
        this.useTerminal = 'useTerminal' in config ? (config as any).useTerminal : true;   // TODO: Remove
        if (this.useTerminal) {
            this.createVSCodeTerminal(config);
        } else {
            this.createVSCodeChanne(config);
        }
    }

    private createName(config: SWOConsoleDecoderConfig) {
        // Try to keep it small while still having enough info
        const basic = `SWO:${config.label || ''}[port:${this.port}`;

        if (this.useTerminal) {
            return basic + '] console';
        } else {
            return basic + ', type: console]';
        }
    }

    private createVSCodeTerminal(config: SWOConsoleDecoderConfig) {
        const options: IPtyTerminalOptions = {
            name: this.createName(config),
            prompt: '',
            inputMode: TerminalInputMode.DISABLED
        };
        this.ptyTerm = PtyTerminal.findExisting(options.name);
        if (this.ptyTerm) {
            this.ptyTerm.clearTerminalBuffer();
        } else {
            this.ptyTerm = new PtyTerminal(options);
            if (config.showOnStartup) {
                this.ptyTerm.terminal.show();
            }
        }
    }

    private createVSCodeChanne(config: SWOConsoleDecoderConfig) {
        this.output = vscode.window.createOutputChannel(this.createName(config));

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

        if (this.useTerminal) {
            this.ptyTerm.write(letters);
            return;
        }

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
        if (this.output) {
            this.output.dispose();
            this.output = null;
        }
        if (this.ptyTerm) {
            this.ptyTerm.dispose();
            this.ptyTerm = null;
        }
    }
}
