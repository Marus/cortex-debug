
// Author to Blame: haneefdm on github

import * as assert from 'assert';
import * as http from  'http';		  
import {TcpPortHelper} from '../src/tcpporthelper';

/**
 * Sorry, this is a slow test because we are testing timeouts. Hate anything time related
 * because you never know how well it works on a slow/loaded machine. And we are dealing
 * with tcp ports that can open/close randomly, so there can be false failures but hopefully
 * no false positives. If your computer is quiet enough, we should be able to get through
 * the test fine
 */
suite("TcpPortHelper Tests", () => {
	test("TcpPortHelper finder/monitor/open/close tests", async () => {
		const doLog = false;
		const args = {
			min: 51000,
			max: 52000,
			retrieve: 4,
			consecutive: false,
			doLog: doLog
		};
		let ports: number[];
		const hostNameOrIp = 'localhost';
		await TcpPortHelper.find(args, hostNameOrIp).then((ret) => {
			if (doLog) { console.log(`Found free ports ${ret}`);}
			ports = ret;
			assert.strictEqual(ports.length, args.retrieve, `wrong number of ports ${ports}`);
			assert.strictEqual(ports[0] >= args.min, true);
			assert.strictEqual(ports[args.retrieve-1] <= args.max, true);
			assert.deepStrictEqual(ports, ports.sort(), `ports are not ordered? ${ports}`);
		}).catch((e) => {
			assert.fail('TcpPortHelper.find failed ' + e);
		});

		const port = ports[1];
		await TcpPortHelper.monitorPortOpen(port,hostNameOrIp,100,400).then(() => {
			assert.fail(`0: Timeout expected on port ${port}`);
		}, async (err) => {
			if (doLog) { console.log(`0: Timeout: Success waiting on port ${port} `, err.message);}
			assert.strictEqual(err.message, 'timeout');

			// Lets create a server, but don't start listening for a while. This could have been
			// simpler just using 'net' module
			const server = http.createServer();
			setTimeout(() => {
				server.listen(port, (err) => {
					if (err) {
						assert.fail(`Could not start http server on port ${port}`);
					}
				});
				if (doLog) { console.log(`Http server is listening on ${port}`); }
			}, 200);
			if (doLog) { console.log('Waiting for http server to start...'); }

			// See if the server started on the requested port
			await TcpPortHelper.monitorPortOpen(port,hostNameOrIp,100,5000).then(() => {
				if (doLog) { console.log(`1. Success server port ${port} is ready`); }
			}, (err) => {
				if (doLog) { console.log(`1. Timeout: Failed waiting on port ${port} to open `, err); }
				assert.fail('unexpected timeout ' + err);
			});

			// Lets see if consecutive ports request works while server is still running. It should
			// skip the port we are already using
			args.consecutive = true;
			await TcpPortHelper.find(args, hostNameOrIp).then((ret) => {
				if (doLog) { console.log(`Found free consecutive ports ${ret}`);}
				let newPorts = ret;
				assert.strictEqual(newPorts.length, args.retrieve, `wrong number of ports ${newPorts}`);
				assert.strictEqual(newPorts[0] >= args.min, true);
				assert.strictEqual(newPorts[args.retrieve-1] <= args.max, true);
				assert.deepStrictEqual(newPorts, newPorts.sort(), `ports are not ordered? ${newPorts}`);
				assert.strictEqual(newPorts.find((p) => {return p === port;}), undefined, `used port ${port} found as unused`);
				for (let ix = 1; ix < args.retrieve; ix++) {
					assert.strictEqual(newPorts[ix-1]+1, newPorts[ix], `ports are not consecutive ${newPorts}`);
				}
			}).catch((e) => {
				assert.fail('TcpPortHelper.find consecutive failed ' + e);
			});

			// Close the server and try again. Not sure it closes instantly. It should since it should have
			// no one connected?!?
			server.close();
			await TcpPortHelper.monitorPortClosed(port,hostNameOrIp,50,200).then(() => {
				if (doLog) { console.log(`2. Success Server port ${port} is closed`); }
			}, (err) => {
				if (doLog) { console.log(`2. Timeout: Failed waiting on port ${port} to close`, err); }
				assert.strictEqual(err.message, 'timeout');
				assert.fail('Why is the server still running? ' + err);
			});
		});
	}).timeout(5000);	// Maximum timeout for this test
});

