
// Author to Blame: haneefdm on github

import * as assert from 'assert';
import * as http from 'http';
import os = require('os');
import { TcpPortScanner } from '../src/tcpportscanner';

/**
 * Sorry, this is a slow test because we are testing timeouts. Hate anything time related
 * because you never know how well it works on a slow/loaded machine. And we are dealing
 * with tcp ports that can open/close randomly, so there can be false failures but hopefully
 * no false positives. If your computer is quiet enough, we should be able to get through
 * the test fine
 */
suite('TcpPortScanner Tests', () => {
    test('TcpPortScanner finder/waitfor(open/close) tests', async () => {
        let hrStart = process.hrtime();
        function timeit(reset: boolean = false) {
            const hrEnd = process.hrtime(hrStart);
            const ms = (hrEnd[1] / 1e6).toFixed(2);
            const ret = `${hrEnd[0]}s ${ms}ms`;
            if (reset) {
                hrStart = process.hrtime();
            }
            return ret;
        }
        const doLog = false;
        const args = {
            min: 51000,
            max: 52000,
            retrieve: 4,
            consecutive: false,
            doLog: doLog
        };
        let ports: number[];
        const hostNameOrIp = '0.0.0.0';
        timeit();
        await TcpPortScanner.findFreePorts(args, hostNameOrIp).then((ret) => {
            if (doLog) { console.log(`Found free ports ${ret}, ${timeit()}`); }
            ports = ret;
            assert.strictEqual(ports.length, args.retrieve, `wrong number of ports ${ports}`);
            assert.strictEqual(ports[0] >= args.min, true);
            assert.strictEqual(ports[args.retrieve - 1] <= args.max, true);
            assert.deepStrictEqual(ports, ports.sort(), `ports are not ordered? ${ports}`);
        }).catch((e) => {
            assert.fail(`TcpPortScanner.find failed, ${timeit()} ` + e);
        });

        const port = ports[1];
        timeit();
        await TcpPortScanner.waitForPortOpen(port, hostNameOrIp, false, 100, 100).then(() => {
            assert.fail(`0: Timeout expected on port ${port} ${timeit()}`);
        }, async (err) => {
            if (doLog) { console.log(`0: Timeout: Success waiting on port ${port} ${timeit()} `, err.message); }
            assert.strictEqual(err.message, 'timeout');

            // Lets create a server, but don't start listening for a while. In the meantime, we start looking for
            // ports to get open
            const server = http.createServer();
            setTimeout(() => {
                server.listen(port, (err) => {
                    if (err) {
                        assert.fail(`Could not start http server on port ${port}`);
                    } else {
                        if (doLog) { console.log(`Http server is listening on ${port}`); }
                    }
                });
            }, 200);            // Enough time to get waitForPortOpen to get started and working
            if (doLog) { console.log('Waiting for http server to start...'); }
         
            // See if the server started on the requested port. We do it two ways in (near) parallel
            // Both should succeed with the same timeout. See above when LISTEN starts
            TcpPortScanner.waitForPortOpen(port, hostNameOrIp, true, 50, 1000).then(async () => {
                if (doLog) { console.log(`1. Success server port ${port} is ready ${timeit()}`); }
            }, (err) => {
                if (doLog) { console.log(`1. Timeout: Failed waiting on port ${port} to open ${timeit()}`, err); }
                assert.fail('unexpected timeout ' + err);
            });
            await TcpPortScanner.waitForPortOpenOSUtl(port, 50, 1000, false, doLog).then(() => {
                if (doLog) { console.log(`1.1 Success server port ${port} is ready ${timeit()}`); }
            }, (err) => {
                if (doLog) { console.log(`1.1 Timeout: Failed waiting on port ${port} to open ${timeit()}`, err); }
                assert.fail('unexpected timeout ' + err);
            });

            // Lets see if consecutive ports request works while server is still running. It should
            // skip the port we are already using
            args.consecutive = true;
            timeit(true);
            await TcpPortScanner.findFreePorts(args, hostNameOrIp).then((ret) => {
                if (doLog) { console.log(`Found free consecutive ports ${ret} ${timeit()}`); }
                const newPorts = ret;
                assert.strictEqual(newPorts.length, args.retrieve, `wrong number of ports ${newPorts}`);
                assert.strictEqual(newPorts[0] >= args.min, true);
                assert.strictEqual(newPorts[args.retrieve - 1] <= args.max, true);
                assert.deepStrictEqual(newPorts, newPorts.sort(), `ports are not ordered? ${newPorts}`);
                assert.strictEqual(newPorts.find((p) => p === port), undefined, `used port ${port} found as unused`);
                for (let ix = 1; ix < args.retrieve; ix++) {
                    assert.strictEqual(newPorts[ix - 1] + 1, newPorts[ix], `ports are not consecutive ${newPorts}`);
                }
            }).catch((e) => {
                assert.fail(`TcpPortScanner.find consecutive failed ${timeit()} ` + e);
            });

            server.close();
            timeit();
            await TcpPortScanner.waitForPortClosed(port, hostNameOrIp, true, 50, 1000).then(() => {
                if (doLog) { console.log(`2. Success Server port ${port} is closed ${timeit()}`); }
            }, (err) => {
                if (doLog) { console.log(`2. Timeout: Failed waiting on port ${port} to close ${timeit()}`, err); }
                assert.strictEqual(err.message, 'timeout');
                assert.fail('Why is the server still running? ' + err);
            });
        });
    }).timeout(4000);
});
