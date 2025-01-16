import * as assert from 'assert';

suite('Serial Port tests', () => {
    test('Serial Port list', async () => {
        let SerialPort;
        try {
            SerialPort = module.require('serialport').SerialPort;
        } catch (e) {
            assert.fail(e);
        }

        try {
            const ports = await SerialPort.list();
            for (const port of ports) {
                console.log('\tFound port: ' + port.path);
            }
        } catch (e) {
            assert.fail(e);
        }
    });
});
