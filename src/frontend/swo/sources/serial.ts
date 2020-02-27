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

        /* While this is a bit ugly - it works around WebPack's mangling of the require statements. eval('require.main') gets us 
            the main module in a non-mangled form (instead of the current module - but that is not important for our purposes here)
            and allows us to modify the paths and load in the serial port from there. We have to wrap it in an eval statement to avoid
            webpack mangling */
        // tslint:disable-next-line: no-eval
        const mainModule = eval('require.main');

        const binarypath = path.normalize(path.join(extensionPath, 'binary_modules', process.version, os.platform(), process.arch, 'node_modules'));

        if (mainModule.paths.indexOf(binarypath) === -1) {
            mainModule.paths.splice(0, 0, binarypath);
        }

        let SerialPort;
        try {
            SerialPort = mainModule.require('serialport');
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
