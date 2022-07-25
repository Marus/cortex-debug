import { SWORTTSource } from './common';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import * as path from 'path';

export function findSerialPortModuleHelp(extensionPath: string) {
    return 'Node/npm module "serialport" not found. You can install this in one of two ways\n' +
        '1. Install "Serial Monitor" VSCode extension. https://marketplace.visualstudio.com/items?itemName=ms-vscode.vscode-serial-monitor\n' +
        '2. or, you can compile the serialport module locally on your computer. Follow these instructions on a shell prompt\n' +
        `    cd ${extensionPath}/binary_modules\n` +
        `    bash ./build.sh ${process.versions['electron']}\n` +
        'If you chose to compile locally, make sure NodeJS is installed on your system. Visit https://nodejs.org/en/download/';
}

export function findSerialPortModule(extensionPath: string, useModule) {
    const paths = [];
    const p = path.normalize(path.join(extensionPath, 'binary_modules', 'electron-' + process.versions['electron'], 'node_modules'));
    if (fs.existsSync(p) && fs.existsSync(path.join(p, 'serialport'))) {
        paths.push(p);
    } else {
        const serMonitorExt = 'ms-vscode.vscode-serial-monitor';
        const serialMonitor: vscode.Extension<any> = vscode.extensions.getExtension(serMonitorExt);
        if (serialMonitor) {
            paths.push(path.join(serialMonitor.extensionPath, 'dist', 'node_modules'));
            paths.push(path.join(serialMonitor.extensionPath, 'node_modules'));
        }
    }

    let added = false;
    for (const p of paths) {
        if (fs.existsSync(path.join(p, 'serialport'))) {
            if (useModule.paths.indexOf(p) === -1) {
                console.log(`Adding ${p} to module search path`);
                useModule.paths.push(p);
            }
            added = true;
        }
    }
    return added;
}

declare function __webpack_require__(name: string): any;
declare function __non_webpack_require__(name: string): any;

export class SerialSWOSource extends EventEmitter implements SWORTTSource {
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
        const added = findSerialPortModule(extensionPath, mainModule);
        if (!added) {
            vscode.window.showErrorMessage(findSerialPortModuleHelp(extensionPath));
            return;
        }

        let SerialPort;
        try {
            SerialPort = mainModule.require('serialport').SerialPort;
            if (!SerialPort) {
                vscode.window.showErrorMessage(findSerialPortModuleHelp(extensionPath));
                return;
            }
        }
        catch (e) {
            vscode.window.showErrorMessage(findSerialPortModuleHelp(extensionPath));
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
