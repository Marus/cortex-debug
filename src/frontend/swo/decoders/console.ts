import * as vscode from 'vscode';
import * as fs from 'fs';

import { SWORTTDecoder } from './common';
import { SWOConsoleDecoderConfig } from '../common';
import { Packet } from '../common';
import { IPtyTerminalOptions, PtyTerminal } from '../../pty';
import { HrTimer, TerminalInputMode, TextEncoding } from '../../../common';

export class SWOConsoleProcessor implements SWORTTDecoder {
    private positionCount: number;
    private output: vscode.OutputChannel;
    private position: number = 0;
    private timeout: any = null;
    public readonly format: string = 'console';
    private port: number;
    private encoding: TextEncoding;
    private showOutputTimer: NodeJS.Timeout = null;
    private useTerminal = true;
    private ptyTerm: PtyTerminal = null;
    private timestamp: boolean = false;
    private hrTimer: HrTimer = new HrTimer();
    private logFd: number = -1;
    private logfile: string;

    constructor(config: SWOConsoleDecoderConfig) {
        this.port = config.port;
        this.encoding = config.encoding || TextEncoding.UTF8;
        this.timestamp = !!config.timestamp;
        this.useTerminal = 'useTerminal' in config ? (config as any).useTerminal : true;   // TODO: Remove
        if (this.useTerminal) {
            this.createVSCodeTerminal(config);
        } else {
            this.createVSCodeChanne(config);
        }
        if (config.logfile) {
            this.logfile = config.logfile;
            try {
                this.logFd = fs.openSync(config.logfile, 'w');
            }
            catch (e) {
                const msg = `Could not open file ${config.logfile} for writing. ${e.toString()}`;
                vscode.window.showErrorMessage(msg);
            }
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
            this.ptyTerm.on('close', () => {
                this.ptyTerm = null;
            });
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

    private pushOutput(str: string) {
        if (str) {
            if (this.useTerminal) {
                if (this.ptyTerm) {
                    this.ptyTerm.write(str);
                }
            } else {
                this.output.append(str);
            }
        }
    }

    private createDateHeaderUs(): string {
        if (this.timestamp) {
            return this.hrTimer.createDateTimestamp() + ' ';
        } else {
            return '';
        }
    }

    private logFileWrite(text: string) {
        if ( (this.logFd < 0) || (text === '') ) {
            return;
        }
        try {
            fs.writeSync(this.logFd, text);
        }
        catch (e) {
            const msg = `Could not write to file ${this.logfile}. ${e.toString()}`;
            vscode.window.showErrorMessage(msg);
            try { fs.closeSync(this.logFd); } catch {}
            this.logFd = -1;
        }
    }

    public softwareEvent(packet: Packet) {
        if (packet.port !== this.port) { return; }
        let text = '';
        const letters = packet.data.toString(this.encoding);
        for (const letter of letters) {
            if (this.timeout) { clearTimeout(this.timeout); this.timeout = null; }

            if (letter === '\n') {
                text += '\n';
                this.pushOutput('\n');
                this.position = 0;
                continue;
            }

            if (this.position === 0) {
                const timestampHeader = this.createDateHeaderUs();
                text += timestampHeader;
                this.pushOutput(timestampHeader);
            }

            text += letter;
            this.pushOutput(letter);
            this.position += 1;

            if (this.timestamp && (this.position > 0)) {
                if (this.timeout) {
                    clearTimeout(this.timeout);
                }
                this.timeout = setTimeout(() => {
                    text += '\n';
                    this.pushOutput('\n');
                    this.position = 0;
                    this.timeout = null;
                }, 5000);
            }
        }
        this.logFileWrite(text);
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
        this.close();
    }

    public close() {
        if (this.logFd >= 0) {
            fs.closeSync(this.logFd);
            this.logFd = -1;
        }
    }
}
