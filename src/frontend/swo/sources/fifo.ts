import * as fs from 'fs';
import { EventEmitter } from 'events';
import { SWOSource } from './common';

export class FifoSWOSource extends EventEmitter implements SWOSource  {
    private stream: fs.ReadStream;
    public connected: boolean = false;

    constructor(private SWOPath: string) {
        super();
        this.stream = fs.createReadStream(this.SWOPath, { highWaterMark: 128, encoding: null, autoClose: false });
        this.stream.on('data', (buffer) => { this.emit('data', buffer); });
        this.stream.on('close', (buffer) => { this.emit('disconnected'); });
        this.connected = true;
    }

    public dispose() {
        this.stream.close();
    }
}
