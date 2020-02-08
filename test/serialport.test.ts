import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

suite('Serial Port tests', () => {
    test('Serial Port list', async () => {
        const extensionPath = vscode.extensions.getExtension('marus25.cortex-debug').extensionPath;
        const binarypath = path.normalize(path.join(extensionPath, 'binary_modules', process.version,
            os.platform(), process.arch, 'node_modules'));

        if (!fs.existsSync(binarypath)) {
            console.error(`Error: Missing Dir '${binarypath}'`);
            console.error('Try the following commands to create the serial port module:');
            console.error(`    cd ${extensionPath}`);
            console.error(`    ./serial-port-build.sh ${process.versions['electron']} ${process.versions.node}`);
            assert.fail();
        } else {
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
        }
    });
});
