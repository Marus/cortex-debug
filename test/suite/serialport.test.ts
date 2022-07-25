import * as assert from 'assert';
import * as vscode from 'vscode';
import { findSerialPortModule, findSerialPortModuleHelp } from '../../src/frontend/swo/sources/serial';

suite('Serial Port tests', () => {
    const extensionPath = vscode.extensions.getExtension('marus25.cortex-debug').extensionPath;
    const added = findSerialPortModule(extensionPath, module);
    // console.log(findSerialPortModuleHelp(extensionPath));
    test('Serial Port exists', async () => {
        if (!added) {
            console.log(findSerialPortModuleHelp(extensionPath));
            assert.fail('Could not find serialport module');
        }
    });
    test('Serial Port list', async () => {
        let SerialPort;
        try {
            SerialPort = module.require('serialport').SerialPort;
        }
        catch (e) {
            assert.fail(e);
        }

        try {
            const ports = await SerialPort.list();
            if (true) {
                for (const port of ports) {
                    console.log('\tFound port: ' + port.path);
                }
            }
        }
        catch (e) {
            assert.fail(e);
        }
    });
});
