// Author to Blame: haneefdm on github

import * as assert from 'assert';
import * as http from 'http';
import { TcpPortScanner } from '../../src/tcpportscanner';

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
        function timeIt(reset: boolean = false): string {
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
        timeIt();
        await TcpPortScanner.findFreePorts(args, hostNameOrIp).then((ret) => {
            if (doLog) { console.log('Found free ports', ret, timeIt()); }
            ports = ret;
            assert.strictEqual(ports.length, args.retrieve, `wrong number of ports ${ports.join(',')}`);
            assert.strictEqual(ports[0] >= args.min, true);
            assert.strictEqual(ports[args.retrieve - 1] <= args.max, true);
            assert.deepStrictEqual(ports, ports.sort(), `ports are not ordered? ${ports.join(',')}`);
        }).catch((e) => {
            assert.fail(`TcpPortScanner.find failed, ${timeIt()} ` + e);
        });

        const port = ports[1];
        timeIt();
        await TcpPortScanner.waitForPortOpen(port, hostNameOrIp, false, 100, 100).then(() => {
            assert.fail(`0: Timeout expected on port ${port} ${timeIt()}`);
        }, async (err) => {
            if (doLog) { console.log(`0: Timeout: Success waiting on port ${port} ${timeIt()} `, err.message); }
            assert.strictEqual(err.message, 'timeout');

            // Lets create a server, but don't start listening for a while. In the meantime, we start looking for
            // ports to get open
            const server = http.createServer();
            server.on('error', (err: any) => {
                assert.fail(`Could not start http server on port ${port}`);
            });
            setTimeout(() => {
                server.listen(port, () => {
                    if (doLog) { console.log(`Http server is listening on ${port}`); }
                });
            }, 200);            // Enough time to get waitForPortOpen to get started and working
            if (doLog) { console.log('Waiting for http server to start...'); }

            // See if the server started on the requested port. We do it two ways in (near) parallel
            // Both should succeed with the same timeout. See above when LISTEN starts
            TcpPortScanner.waitForPortOpen(port, hostNameOrIp, true, 50, 1000).then(() => {
                if (doLog) { console.log(`1. Success server port ${port} is ready ${timeIt()}`); }
            }, (err) => {
                if (doLog) { console.log(`1. Timeout: Failed waiting on port ${port} to open ${timeIt()}`, err); }
                assert.fail('unexpected timeout ' + err);
            });
            await TcpPortScanner.waitForPortOpenOSUtl(port, 50, 1000, false, doLog).then(() => {
                if (doLog) { console.log(`1.1 Success server port ${port} is ready ${timeIt()}`); }
            }, (err) => {
                if (doLog) { console.log(`1.1 Timeout: Failed waiting on port ${port} to open ${timeIt()}`, err); }
                assert.fail('unexpected timeout ' + err);
            });

            // Lets see if consecutive ports request works while server is still running. It should
            // skip the port we are already using
            args.consecutive = true;
            timeIt(true);
            await TcpPortScanner.findFreePorts(args, hostNameOrIp).then((ret) => {
                if (doLog) { console.log('Found free consecutive ports', ret, timeIt()); }
                const newPorts = ret;
                assert.strictEqual(newPorts.length, args.retrieve, `wrong number of ports ${newPorts.join(',')}`);
                assert.strictEqual(newPorts[0] >= args.min, true);
                assert.strictEqual(newPorts[args.retrieve - 1] <= args.max, true);
                assert.deepStrictEqual(newPorts, newPorts.sort(), `ports are not ordered? ${newPorts.join(',')}`);
                assert.strictEqual(newPorts.find((p) => p === port), undefined, `used port ${port} found as unused`);
                for (let ix = 1; ix < args.retrieve; ix++) {
                    assert.strictEqual(newPorts[ix - 1] + 1, newPorts[ix], `ports are not consecutive ${newPorts.join(',')}`);
                }
            }).catch((e) => {
                assert.fail(`TcpPortScanner.find consecutive failed ${timeIt()} ` + e);
            });

            server.close();
            timeIt();
            await TcpPortScanner.waitForPortClosed(port, hostNameOrIp, true, 50, 1000).then(() => {
                if (doLog) { console.log(`2. Success Server port ${port} is closed ${timeIt()}`); }
            }, (err) => {
                if (doLog) { console.log(`2. Timeout: Failed waiting on port ${port} to close ${timeIt()}`, err); }
                assert.strictEqual(err.message, 'timeout');
                assert.fail('Why is the server still running? ' + err);
            });
        });
    }).timeout(4000);
});
