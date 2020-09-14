import * as vscode from 'vscode';

import { RTTConsoleProcessor } from './decoders/console';
import { RTTDecoder } from './decoders/common';
import { RTTDecoderConfig, RTTConsoleDecoderConfig } from './common';
import { SocketRTTSource } from './sources/socket';

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

    constructor(args: ConfigurationArguments, extensionPath: string) {
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
}
