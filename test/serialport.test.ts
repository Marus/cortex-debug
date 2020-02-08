import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

suite('Serial Port tests', () => {
    const extensionPath = vscode.extensions.getExtension('marus25.cortex-debug').extensionPath;
    const binaryPath = path.normalize(path.join(extensionPath, 'binary_modules', process.version,
        os.platform(), process.arch, 'node_modules'));
    test('Serial Port exists', async () => {
        if (!fs.existsSync(binaryPath)) {
            console.error(`Error: Missing dir. '${binaryPath}'`);
            console.log('Try the following commands to create the serial port module:');
            console.log(`    cd ${extensionPath}`);
            console.log(`    ./serial-port-build.sh ${process.versions['electron']} ${process.versions.node}`);
            assert.fail(`Missing dir ${binaryPath}`);
        }
    });
    test('Serial Port list', async () => {
        if (module.paths.indexOf(binaryPath) === -1) {
            module.paths.splice(0, 0, binaryPath);
        }
        let SerialPort;
        try {
            SerialPort = module.require('serialport');
        }
        catch (e) {
            assert.fail(e);
        }

        await SerialPort.list().then((ports) => {
            // We should disable next block when things are working fine across all platforms
            if (true) {
                for (const port of ports) {
                    console.log('\tFound port: ' + port.path);
                }
            }
        });
    });
});
