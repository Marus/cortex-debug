import { Packet } from '../common';

export interface SWODecoder {
    format: string;

    softwareEvent(buffer: Packet);
    hardwareEvent(event: Packet);
    synchronized();
    lostSynchronization();

    dispose();
}
