// Author to Blame: haneefdm on github

import * as tcpPortUsed from 'tcp-port-used';
import os = require('os');
import net = require('net');

export module TcpPortHelper {
	//
	// There are two ways we can look for open ports or get status
	// 1. Client: Try to see if we can connect to that port. This is the preferred method
	//    because you probe for remote host probes as well but on Windows each probe on an free
	//    port takes 1 second even on localhost
	// 2. Server: See if we can create a server on that port. It is super fast on all platforms,
	//    but, we can only do this on a localhost. We use this method is we can quickly determine
	//    if it is a localhost. We also look for ports on its aliases because, you can
	//    run servers on some aliases
	//

	function isPortInUse(port: number, host: string): Promise<boolean> {
		return new Promise((resolve, _reject) => {
			const server = net.createServer((c) => {
			});
			server.once('error', (e) => {
				const code: string = (e as any).code;
				if (code === 'EADDRINUSE') {
					// console.log(`port ${host}:${port} is used`, code);
					resolve(true);					// Port in use
				} else {
					// This should never happen so, log it always
					console.log(`port ${host}:${port} is unexpected error `, code);
					resolve(false);					// some other failure
				}
				server.close();
			});

			server.listen(port, host, () => {
				// Port not in use
				// console.log(`port ${host}:${port} is in free`);
				resolve(false);
				server.close();
			});
		});
	}

	export async function isPortInUseEx(port, host): Promise<boolean> {
		if (isLocalHost(host)) {
			let inUse = false;
			const tries = getLocalHostAliases();
			for (let ix = 0; ix < tries.length; ix++) {
				// We don't use Promise.all because since we are trying to create a bunch of
				// servers on the same machine, they could interfere with each other if you
				// do it asynchronously. It adds very little runtime (fractions of ms).
				// There is also a slight benefit that we can bail early if a port is in use
				await isPortInUse(port, tries[ix]).then((v) => { inUse = v; });
				if (inUse) { break; }
			}
			return new Promise((resolve, reject) => {
				resolve(inUse);
			});
		} else {
			// This function is too slow on windows when checking on an open port.
			return tcpPortUsed.check(port, host);
		}
	}
	/**
	 * Scan for free ports (no one listening) on the specified host.
	 * Don't like the interface but trying to keep compatibility with portastic.find(). But unlike,
	 * it the default ports to retrieve is 1 and we also have the option of returning consecutive ports
	 * 
	 * FIXME: Function is mostly synchronous. If we make it async. though, we may queue up thousands
	 * of promises where maybe just we are looking for a small number of open ports in very large port range
	 * 
	 * @param0 
	 * @param host Use any string that is a valid host name or ip address
	 * @deprecated param cb This callback is called if non-null and the required ports are found and it will return a null promise
	 * @return a Promise with an array of ports or null when cb is used
	 */
	export async function find({ min, max, retrieve = 1, consecutive = false, doLog = false }:
		{
			min: number;			// Starting port number
			max: number;			// Ending port number (inclusive)
			retrieve?: number;		// Number of ports needed
			consecutive?: boolean;
			doLog?: boolean;
		}, host = '0.0.0.0', cb = null): Promise<number[]> | null {
		let freePorts = [];
		const busyPorts = [];
		const needed = retrieve;
		let found = 0;
		let error = null;
		for (let port = min; port <= max; port++) {
			let startTine = process.hrtime();
			await isPortInUseEx(port, host)
				.then((inUse) => {
					const endTime = process.hrtime(startTine);
					if (inUse) {
						busyPorts.push(port);
					} else {
						if (consecutive && (freePorts.length > 0) &&
							(port !== (1 + freePorts[freePorts.length - 1]))) {
							if (doLog) {
								console.log(`TcpPortHelper.finnd: Oops, reset for consecutive requirement`);
							}
							freePorts = [];
							found = 0;
						}
						freePorts.push(port);
						found++;
					}
					if (doLog) {
						const ms = (endTime[1] / 1e6).toFixed(2);
						const t = `${endTime[0]}s ${ms}ms`;
						console.log(`TcpPortHelper.find Port ${host}:${port} ` +
							(inUse ? 'busy' : 'free') + `, Found: ${found} of ${needed} needed ` + t);
					}
				}, (err) => {
					if (doLog) {
						console.error('Error on check:', err.message);
					}
					error = err;
				});
			if (error || (found === needed)) {
				break;
			}
		}
		if (!cb) {
			return new Promise((resolve, reject) => {
				if (!error && (found === needed)) {
					resolve(freePorts);
				} else {
					reject(error ? error : `Only found ${found} of ${needed} ports`);
				}
			});
		} else {
			if (!error && (found === needed)) {
				cb(freePorts);
			}
			return null;
		}
	}

	export class portStatusArgs {
		public startTimeMs: number = 0;
		constructor(
			public readonly status: boolean,	// true means looking for open
			public readonly port: number,
			public readonly host: string = '0.0.0.0',
			public readonly checkLocalHostAliases = true,
			public readonly retryTimeMs: number = 100,
			public readonly timeOutMs: number = 5000
		) {
			this.retryTimeMs = Math.max(this.retryTimeMs, 1);
		}
	}

	function waitForPortStatusEx(opts: portStatusArgs): Promise<void> {
		opts.startTimeMs = Date.now();
		const func = opts.checkLocalHostAliases ? isPortInUseEx : isPortInUse;
		return new Promise(function tryAgain(resolve, reject) {
			func(opts.port, opts.host)
				.then((inUse) => {
					//console.log(`${func.name} returned ${inUse}`)
					if (inUse === opts.status) {	// status match
						return resolve();
					} else {
						throw 'tryagain';
					}
				}).catch((e) => {
					if (e !== 'tryagain') {
						return reject(e);
					} else {
						const t = Date.now() - opts.startTimeMs;
						if (t < opts.timeOutMs) {
							//console.log(`Setting timeout for ${opts.retryTimeMs}ms, curTime = ${t}ms`);
							setTimeout(() => {
								tryAgain(resolve, reject);
							}, opts.retryTimeMs);
						} else {
							return reject(new Error('timeout'));
						}
					}
				});
		});
	}

	export function waitForPortStatus(port, host = '0.0.0.0', inUse = true,
		checkLocalHostAliaes = true, retryTimeMs = 100, timeOutMs = 5000): Promise<void> {
		retryTimeMs = Math.max(retryTimeMs, 1);
		if (!isLocalHost(host)) {
			return tcpPortUsed.waitForStatus(port, host, inUse, retryTimeMs, timeOutMs);
		} else {
			const opts = new portStatusArgs(inUse, port, host, checkLocalHostAliaes, retryTimeMs, timeOutMs);
			return waitForPortStatusEx(opts);
		}
	}

	/**
	 * Wait for port to open. We always do a minium of one try regardless of timeouts, so setting a timeout
	 * of 0 means only one try is made
	 * @param port Wait until a port opens
	 * @param host 
	 * @param retryTimeMs 
	 * @param timeOutMs 
	 */
	export function waitForPortOpen(port, host = '0.0.0.0', checkLocalHostAliaes = true,
		retryTimeMs = 100, timeOutMs = 5000): Promise<void> {
		retryTimeMs = Math.max(retryTimeMs, 1);
		if (!isLocalHost(host)) {
			return tcpPortUsed.waitUntilUsedOnHost(port, host, retryTimeMs, timeOutMs);
		} else {
			const opts = new portStatusArgs(true, port, host, checkLocalHostAliaes, retryTimeMs, timeOutMs);
			return waitForPortStatusEx(opts);
		}
	}

	export function waitForPortClosed(port, host = '0.0.0.0', checkLocalHostAliaes = true,
		retryTimeMs = 100, timeOutMs = 5000): Promise<void> {
		retryTimeMs = Math.max(retryTimeMs, 1);
		if (!isLocalHost(host)) {
			return tcpPortUsed.waitUntilFreeOnHost(port, host, retryTimeMs, timeOutMs);
		} else {
			const opts = new portStatusArgs(false, port, host, checkLocalHostAliaes, retryTimeMs, timeOutMs);
			return waitForPortStatusEx(opts);
		}
	}

	let aliases = [];
	function getLocalHostAliases(): string[] {
		if (aliases.length === 0) {
			// On Unixes, the first two are treated like true aliases but on Windows
			// you have distint servers on all of them. So, try everything.
			aliases = ['0.0.0.0', '127.0.0.1', '::1', ''];
			let ifaces = os.networkInterfaces();
			Object.keys(ifaces).forEach(function (ifname) {
				ifaces[ifname].forEach(function (iface) {
					if ('ipv4' === iface.family.toLowerCase()) {
						if (aliases.indexOf(iface.address) === -1) {
							aliases.push(iface.address);
						}
					}
				});
			});
			// console.log(aliases.join(','));
		}
		return aliases;
	}

	// quick way of figuring out. quaranteed way would have been to do a dns.resolve()
	function isLocalHost(host: string): boolean {
		return !host || (host === '') || (host === 'localhost') || (getLocalHostAliases().indexOf(host) >= 0);
	}
}
