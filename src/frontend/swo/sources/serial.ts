import { SWORTTSource } from './common';
import { EventEmitter } from 'events';
import type { SerialPort } from 'serialport';
import * as vscode from 'vscode';

export class SerialSWOSource extends EventEmitter implements SWORTTSource {
    private serialPort: SerialPort = null;
    public connected: boolean = false;

    constructor(private device: string, private baudRate: number) {
        super();

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { SerialPort } = require('serialport');
        this.serialPort = new SerialPort({ path: device, baudRate: baudRate, autoOpen: false });
        this.serialPort.on('data', (buffer) => {
            this.emit('data', buffer);
        });
        this.serialPort.on('error', (error) => {
            vscode.window.showErrorMessage(`Unable to open serial port: ${device} - ${error.toString()}`);
        });
        this.serialPort.on('open', () => {
            this.connected = true;
            this.emit('connected');
        });
        this.serialPort.open();
    }

    public dispose() {
        if (this.serialPort) {
            this.serialPort.close();
            this.emit('disconnected');
        }
    }
}
