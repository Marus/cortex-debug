import { Packet } from '../common';

export interface SWORTTDecoder {
    format: string;

    softwareEvent(buffer: Packet): void;
    hardwareEvent(event: Packet): void;
    synchronized(): void;
    lostSynchronization(): void;
    close(): void;

    dispose(): void;
}
