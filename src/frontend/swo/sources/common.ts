import { EventEmitter } from 'events';

export interface SWORTTSource extends EventEmitter {
    connected: boolean;
    dispose();
}
