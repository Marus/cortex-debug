import * as vscode from 'vscode';

import { RTTConsoleProcessor } from './decoders/console';
import { RTTDecoder } from './decoders/common';
import { RTTDecoderConfig, RTTConsoleDecoderConfig } from './common';
import { SocketRTTSource } from './sources/socket';
import { SymbolInformation } from '../../symbols';

interface ConfigurationArguments {
    executable: string;
    rttConfig: {
        enabled: boolean,
        host: string,
        decoders: RTTDecoderConfig[]
    };
}

export class RTTCore {
    private processors: RTTDecoder[] = [];
    private functionSymbols: SymbolInformation[];

    constructor(args: ConfigurationArguments, extensionPath: string) {
        vscode.debug.activeDebugSession.customRequest('load-function-symbols').then((result) => {
            this.functionSymbols = result.functionSymbols;
        }, (error) => {
            this.functionSymbols = [];
        });

        args.rttConfig.decoders.forEach((conf) => {
            switch (conf.type) {
                case 'console':
                    const decoderConfig = conf as RTTConsoleDecoderConfig;
                    this.processors.push(
                        new RTTConsoleProcessor(
                            new SocketRTTSource(args.rttConfig.host, decoderConfig.channel),
                            decoderConfig
                        )
                    );
                    break;

                default:
                    console.log('Unknown RTT decoder: ', conf.type);
                    break;
            }
        });
    }

    public debugSessionTerminated() {

    }

    public debugStopped() {

    }

    public debugContinued() {

    }

    public dispose() {
        this.processors.forEach((p) => p.dispose());
        this.processors = null;
    }

    public getFunctionAtAddress(address: number): SymbolInformation {
        const matches = this.functionSymbols.filter((s) => s.address <= address && (s.address + s.length) > address);
        if (!matches || matches.length === 0) { return undefined; }

        return matches[0];
    }
}
