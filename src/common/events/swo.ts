import { Event } from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';

export interface SWOConfigureBody {
    type: string;
    args: any;            // Configuration arguments
    port?: string;        // [hostname:]port
    path?: string;        // path to file, fifo, etc.
    device?: string;      // path to serial port
    baudRate?: number;
}

export class SWOConfigureEvent extends Event implements DebugProtocol.Event {
    public boxy: SWOConfigureBody;
    public bodyx: {
        type: string,
        port: string,       // [hostname:]port
        path: string        // path to serial port, fifo, etc.
    };
    public event: string;

    constructor(params: SWOConfigureBody) {
        const body = params;
        super('swo-configure', body);
    }
}
