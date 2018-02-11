import { EventEmitter } from 'events';

export interface SWOSource extends EventEmitter {
    connected: boolean;
    dispose();
}
