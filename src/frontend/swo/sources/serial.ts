import { SWOSource } from './common';
import { EventEmitter } from 'events';
import * as net from 'net';
import * as os from 'os';
import * as vscode from 'vscode';

export class SocketSWOSource extends EventEmitter implements SWOSource {
	serialPort: any = null;
	connected: boolean = false;

	constructor(private device: string, private baudRate: number, extensionPath: string) {
		super();

		let modpath = `${extensionPath}/binary_modules/${process.version}/${os.platform()}/${os.arch()}/serialport`;
		let SerialPort;

		try {
			SerialPort = require(modpath);
		}
		catch (e) {
			if (os.platform() === 'win32') {
				vscode.window.showErrorMessage('Serial Port SWO Data Source is not available on Windows');
			}
			else {
				vscode.window.showErrorMessage('Unable to load Serial Port Module. Please check for extension updates.');
			}
			return;
		}

		this.serialPort = new SerialPort(device, { baudRate: baudRate, autoOpen: false });

		this.serialPort.open().then((result) => {
			this.connected = true;
			this.emit('connected');
			this.serialPort.on('data', (buffer) => { this.emit('data', buffer); });
		}, (error) => {
			vscode.window.showErrorMessage(`Unable to open serial port: ${device} - ${error.toString()}`);
		});
	}

	dispose() {
		if (this.serialPort) {
			this.serialPort.close();
			this.emit('disconnected');
		}
	}
}