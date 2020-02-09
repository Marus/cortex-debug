import { SWOSource } from './common';
import { EventEmitter } from 'events';
import * as net from 'net';
import * as os from 'os';
import * as vscode from 'vscode';
import * as path from 'path';

declare function __webpack_require__(name: string): any;
declare function __non_webpack_require__(name: string): any;

export class SerialSWOSource extends EventEmitter implements SWOSource {
    private serialPort: any = null;
    public connected: boolean = false;

    constructor(private device: string, private baudRate: number, extensionPath: string) {
        super();

        const binarypath = path.normalize(path.join(extensionPath, 'binary_modules', process.version, os.platform(), process.arch, 'node_modules'));

        if (module.paths.indexOf(binarypath) === -1) {
            module.paths.splice(0, 0, binarypath);
        }

        let SerialPort;
        try {
            const requireFunc = typeof __webpack_require__ === 'function' ? __non_webpack_require__ : require;
            SerialPort = requireFunc('serialport');
        }
        catch (e) {
            // tslint:disable-next-line:max-line-length
            vscode.window.showErrorMessage('Unable to load Serial Port Module. A recent Visual Studio Code update has likely broken compatibility with the serial module. Please visit https://github.com/Marus/cortex-debug for more information.');
            return;
        }

        this.serialPort = new SerialPort(device, { baudRate: baudRate, autoOpen: false });
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
