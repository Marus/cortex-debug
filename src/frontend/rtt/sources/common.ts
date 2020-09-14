import { EventEmitter } from 'events';

export interface RTTSource extends EventEmitter {
    connected: boolean;
    dispose();
}
