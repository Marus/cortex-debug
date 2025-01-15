import { RTTDecoderOpts } from '@common/types';
import { Event } from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';

export class RTTConfigureEvent extends Event implements DebugProtocol.Event {
    public body: {
        type: string,   // Currently, only 'socket' is supported
        decoder: RTTDecoderOpts;
    };
    public event: string;

    constructor(params: any) {
        const body = params;
        super('rtt-configure', body);
    }
}
