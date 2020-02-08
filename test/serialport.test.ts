import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

suite('Serial Port tests', () => {
    test('Serial Port list', async () => {
        const extensionPath = vscode.extensions.getExtension('marus25.cortex-debug').extensionPath;
        const binarypath = path.normalize(path.join(extensionPath, 'binary_modules', process.version, os.platform(), process.arch, 'node_modules'));

        if (module.paths.indexOf(binarypath) === -1) {
            module.paths.splice(0, 0, binarypath);
        }

        let SerialPort;
        try {
            SerialPort = module.require('serialport');
        }
        catch (e) {
            assert.fail(e);
        }

        await SerialPort.list().then((ports) => {
            for (const port of ports) {
                console.log(port);
            }
        });
    });
});
