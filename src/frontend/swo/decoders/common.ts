import { Packet } from '@common/types';

export interface SWORTTDecoder {
    format: string;

    softwareEvent(buffer: Packet);
    hardwareEvent(event: Packet);
    synchronized();
    lostSynchronization();
    close();

    dispose();
}
