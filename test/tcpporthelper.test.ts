
// Author to Blame: haneefdm on github

import * as assert from 'assert';
import * as http from 'http';
import { TcpPortHelper } from '../src/tcpporthelper';
import { platform } from 'os';

/**
 * Sorry, this is a slow test because we are testing timeouts. Hate anything time related
 * because you never know how well it works on a slow/loaded machine. And we are dealing
 * with tcp ports that can open/close randomly, so there can be false failures but hopefully
 * no false positives. If your computer is quiet enough, we should be able to get through
 * the test fine
 */
suite("TcpPortHelper Tests", () => {
	test("TcpPortHelper finder/monitor(open/close) tests", async () => {
		let hrStart = process.hrtime();
		function timeit() {
			const hrEnd = process.hrtime(hrStart);
			const ms = (hrEnd[1] / 1e6).toFixed(2);
			const ret = `${hrEnd[0]}s ${ms}ms`;
			hrStart = process.hrtime();
			return ret;
		}
		const doLog = true;
		const args = {
			min: 51000,
			max: 52000,
			retrieve: 4,
			consecutive: false,
			doLog: doLog
		};
		let ports: number[];
		const hostNameOrIp = '127.0.0.1';
		timeit();
		await TcpPortHelper.find(args, hostNameOrIp).then((ret) => {
			if (doLog) { console.log(`Found free ports ${ret}, ${timeit()}`); }
			ports = ret;
			assert.strictEqual(ports.length, args.retrieve, `wrong number of ports ${ports}`);
			assert.strictEqual(ports[0] >= args.min, true);
			assert.strictEqual(ports[args.retrieve - 1] <= args.max, true);
			assert.deepStrictEqual(ports, ports.sort(), `ports are not ordered? ${ports}`);
		}).catch((e) => {
			assert.fail(`TcpPortHelper.find failed, ${timeit()} ` + e);
		});

		const port = ports[1];
		timeit();
		await TcpPortHelper.monitorPortOpen(port, hostNameOrIp, 100, 400).then(() => {
			assert.fail(`0: Timeout expected on port ${port} ${timeit()}`);
		}, async (err) => {
			if (doLog) { console.log(`0: Timeout: Success waiting on port ${port} ${timeit()} `, err.message); }
			assert.strictEqual(err.message, 'timeout');

			// Lets create a server, but don't start listening for a while. This could have been
			// simpler just using 'net' module
			const server = http.createServer();
			setTimeout(() => {
				server.listen(port, (err) => {
					if (err) {
						assert.fail(`Could not start http server on port ${port} ${timeit()}`);
					}
				});
				if (doLog) { console.log(`Http server is listening on ${port} ${timeit()}`); }
			}, 200);
			if (doLog) { console.log(`Waiting for http server to start... ${timeit()}`); }

			// See if the server started on the requested port
			timeit();
			await TcpPortHelper.monitorPortOpen(port, hostNameOrIp, 100, 5000).then(() => {
				if (doLog) { console.log(`1. Success server port ${port} is ready ${timeit()}`); }
			}, (err) => {
				if (doLog) { console.log(`1. Timeout: Failed waiting on port ${port} to open ${timeit()}`, err); }
				assert.fail('unexpected timeout ' + err);
			});

			// Lets see if consecutive ports request works while server is still running. It should
			// skip the port we are already using
			args.consecutive = true;
			timeit();
			await TcpPortHelper.find(args, hostNameOrIp).then((ret) => {
				if (doLog) { console.log(`Found free consecutive ports ${ret} ${timeit()}`); }
				let newPorts = ret;
				assert.strictEqual(newPorts.length, args.retrieve, `wrong number of ports ${newPorts}`);
				assert.strictEqual(newPorts[0] >= args.min, true);
				assert.strictEqual(newPorts[args.retrieve - 1] <= args.max, true);
				assert.deepStrictEqual(newPorts, newPorts.sort(), `ports are not ordered? ${newPorts}`);
				assert.strictEqual(newPorts.find((p) => { return p === port; }), undefined, `used port ${port} found as unused`);
				for (let ix = 1; ix < args.retrieve; ix++) {
					assert.strictEqual(newPorts[ix - 1] + 1, newPorts[ix], `ports are not consecutive ${newPorts}`);
				}
			}).catch((e) => {
				assert.fail(`TcpPortHelper.find consecutive failed ${timeit()} ` + e);
			});

			// Close the server and try again. Not sure it closes instantly. It should since it should have
			// no one connected?!?
			server.close();
			timeit();
			await TcpPortHelper.monitorPortClosed(port, hostNameOrIp, 50, 3000).then(() => {
				if (doLog) { console.log(`2. Success Server port ${port} is closed ${timeit()}`); }
			}, (err) => {
				if (doLog) { console.log(`2. Timeout: Failed waiting on port ${port} to close ${timeit()}`, err); }
				assert.strictEqual(err.message, 'timeout');
				assert.fail('Why is the server still running? ' + err);
			});
		});
		// Maximum timeout for this test. Mac/Linux finish in under a second
		// Windows takes 10-13 seconds, PC specs got nothing to do with it
	}).timeout(platform() == 'win32' ? 20000 : 4000);
});

