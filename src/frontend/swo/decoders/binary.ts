import * as vscode from 'vscode';
import * as fs from 'fs';
import { SWORTTDecoder } from './common';
import { SWOBinaryDecoderConfig } from '../common';
import { decoders as DECODER_MAP } from './utils';
import { Packet } from '../common';
import { IPtyTerminalOptions, PtyTerminal } from '../../pty';
import { HrTimer, TerminalInputMode } from '../../../common';

function parseEncoded(buffer: Buffer, encoding: string) {
    return DECODER_MAP[encoding] ? DECODER_MAP[encoding](buffer) : DECODER_MAP.unsigned(buffer);
}

export class SWOBinaryProcessor implements SWORTTDecoder {
    private output: vscode.OutputChannel;
    public readonly format: string = 'binary';
    private port: number;
    private scale: number;
    private encoding: string;
    private useTerminal = true;
    private ptyTerm: PtyTerminal = null;
    private hrTimer: HrTimer = new HrTimer();
    private logFd: number = -1;
    private logfile: string;

    constructor(config: SWOBinaryDecoderConfig) {
        this.port = config.port;
        this.scale = config.scale || 1;
        this.encoding = (config.encoding || 'unsigned').replace('.', '_');
        this.useTerminal = 'useTerminal' in config ? (config as any).useTerminal : true;   // TODO: Remove

        if (this.useTerminal) {
            this.createVSCodeTerminal(config);
        } else {
            this.createVSCodeChannel(config);
        }
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

    private createVSCodeTerminal(config: SWOBinaryDecoderConfig) {
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
            this.ptyTerm.terminal.show();
        }
    }

    private createVSCodeChannel(config: SWOBinaryDecoderConfig) {
        const chName = this.createName(config);
        this.output = vscode.window.createOutputChannel(chName);
    }

    private createName(config: SWOBinaryDecoderConfig) {
        return `SWO:${config.label || ''}[port:${this.port}, enc:${this.encoding}]`;
    }

    public softwareEvent(packet: Packet) {
        if (packet.port !== this.port) { return; }

        const date = new Date();

        const hexvalue = packet.data.toString('hex');
        const decodedValue = parseEncoded(packet.data, this.encoding);
        const scaledValue = decodedValue * this.scale;
        const timestamp = this.hrTimer.createDateTimestamp();

        const str = `${timestamp} ${hexvalue} - ${decodedValue} - ${scaledValue}`;
        if (this.useTerminal) {
            this.ptyTerm.write(str + '\n');
        } else {
            this.output.appendLine(str);
        }

        if (this.logFd >= 0) {
            try {
                fs.writeSync(this.logFd, packet.data);
            } catch (e) {
                const msg = `Could not write to file ${this.logfile} for writing. ${e.toString()}`;
                vscode.window.showErrorMessage(msg);
                try {
                    fs.closeSync(this.logFd);
                } catch (closeErr) {
                    console.error('decoder.logCloseError', closeErr);
                }
                this.logFd = -1;
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
        this.close();
    }

    public close() {
        if (this.logFd >= 0) {
            fs.closeSync(this.logFd);
            this.logFd = -1;
        }
    }
}
