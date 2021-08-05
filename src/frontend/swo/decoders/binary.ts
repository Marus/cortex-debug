import * as vscode from 'vscode';
import { SWORTTDecoder } from './common';
import { SWOBinaryDecoderConfig } from '../common';
import { decoders as DECODER_MAP } from './utils';
import { Packet } from '../common';
import { IPtyTerminalOptions, PtyTerminal } from '../../pty';
import { TerminalInputMode } from '../../../common';

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
    }

    private createVSCodeTerminal(config: SWOBinaryDecoderConfig) {
        const options : IPtyTerminalOptions = {
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

        const str = `[${date.toISOString()}]   ${hexvalue} - ${decodedValue} - ${scaledValue}`;
        if (this.useTerminal) {
            this.ptyTerm.write(str + '\n');
        } else {
            this.output.appendLine(str);
        }
    }

    public hardwareEvent(event: Packet) {}
    public synchronized() {}
    public lostSynchronization() {}

    public dispose() {
        if (this.output) {
            this.output.dispose();
        }
    }
}
