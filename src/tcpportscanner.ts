// Author to Blame: haneefdm on github

import * as tcpPortUsed from 'tcp-port-used';
import os = require('os');
import net = require('net');

export class TcpPortScanner {
    //
    // There are two ways we can check/look for open ports or get status
    // 1. Client: Try to see if we can connect to that port. This is the preferred method
    //    because you probe for remote host probes as well but on Windows each probe on an free
    //    port takes 1 second even on localhost
    // 2. Server: See if we can create a server on that port. It is super fast on all platforms,
    //    but, we can only do this on a localhost. We use this method is we can quickly determine
    //    if it is a localhost. We also look for ports on its aliases because, you can
    //    run servers on some aliases
    //

    public static isPortInUse(port: number, host: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
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
                    reject(e);					// some other failure
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

    public static isPortInUseEx(port: number, host: string): Promise<boolean> {
        if (TcpPortScanner.isLocalHost(host)) {
            const tries = TcpPortScanner.getLocalHostAliases();
            let ix = 0;
            // We don't use Promise.all because since we are trying to create a bunch of
            // servers on the same machine/port, they could interfere with each other if you
            // do it asynchronously. It adds very little runtime (fractions of ms).
            // There is also a slight benefit that we can bail early if a port is in use
            return new Promise((resolve, reject) => {
                function next(port: number, host: string) {
                    TcpPortScanner.isPortInUse(port, host).then((inUse) => {
                        if (inUse) {
                            resolve(inUse);
                        } else if (++ix === tries.length) {
                            resolve(false);
                        } else {
                            next(port, tries[ix]);
                        }
                    }).catch((err) => {
                        reject(err);
                    });
                }
                next(port, tries[ix]);
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
     * While this function is async, promises are chained to find open ports, but recursively
     * 
     * @param0 
     * @param host Use any string that is a valid host name or ip address
     * @return a Promise with an array of ports or null when cb is used
     */
    public static findFreePorts(
        { min, max, retrieve = 1, consecutive = false, doLog = false }:
            {
                min: number;			// Starting port number
                max: number;			// Ending port number (inclusive)
                retrieve?: number;		// Number of ports needed
                consecutive?: boolean;
                doLog?: boolean;
            },
        host = '0.0.0.0'): Promise<number[]> | null {
        let freePorts = [];
        const busyPorts = [];
        const needed = retrieve;
        const func = TcpPortScanner.isLocalHost(host) ? TcpPortScanner.isPortInUseEx : tcpPortUsed.tcpPortUsed;
        return new Promise((resolve, reject) => {
            if (needed <= 0) {
                resolve(freePorts);
                return;
            }
            function next(port: number, host: string) {
                const startTine = process.hrtime();
                func(port, host).then((inUse) => {
                    const endTime = process.hrtime(startTine);
                    if (inUse) {
                        busyPorts.push(port);
                    } else {
                        if (consecutive && (freePorts.length > 0) &&
                            (port !== (1 + freePorts[freePorts.length - 1]))) {
                            if (doLog) {
                                console.log('TcpPortHelper.finnd: Oops, reset for consecutive requirement');
                            }
                            freePorts = [];
                        }
                        freePorts.push(port);
                    }
                    if (doLog) {
                        const ms = (endTime[1] / 1e6).toFixed(2);
                        const t = `${endTime[0]}s ${ms}ms`;
                        console.log(`TcpPortHelper.find Port ${host}:${port} ` +
                            (inUse ? 'busy' : 'free') + `, Found: ${freePorts.length} of ${needed} needed ` + t);
                    }
                    if (freePorts.length === needed) {
                        resolve(freePorts);
                    } else if (port < max) {
                        next(port + 1, host);
                    } else {
                        reject(new Error(`Only found ${freePorts.length} of ${needed} ports`));
                    }
                }).catch((err) => {
                    reject(err);
                });
            }
            next(min, host);		// Start the hunt
        });
    }

    /**
     * @deprecated This a synchronous version findFreePorts(). Use it instead
     */
    public static async findFreePortsSync(
        { min, max, retrieve = 1, consecutive = false, doLog = false }:
            {
                min: number;			// Starting port number
                max: number;			// Ending port number (inclusive)
                retrieve?: number;		// Number of ports needed
                consecutive?: boolean;
                doLog?: boolean;
            },
        host = '0.0.0.0', cb = null): Promise<number[]> {
        let freePorts = [];
        const busyPorts = [];
        const needed = retrieve;
        let error = null;
        if (needed <= 0) {
            return new Promise((resolve) => { resolve(freePorts); });
        }
        const func = TcpPortScanner.isLocalHost(host) ? TcpPortScanner.isPortInUseEx : tcpPortUsed.tcpPortUsed;
        for (let port = min; port <= max; port++) {
            if (needed <= 0) {
                return;
            }
            const startTime = process.hrtime();
            await func(port, host)
                .then((inUse) => {
                    const endTime = process.hrtime(startTime);
                    if (inUse) {
                        busyPorts.push(port);
                    } else {
                        if (consecutive && (freePorts.length > 0) &&
                            (port !== (1 + freePorts[freePorts.length - 1]))) {
                            if (doLog) {
                                console.log('TcpPortHelper.finnd: Oops, reset for consecutive requirement');
                            }
                            freePorts = [];
                        }
                        freePorts.push(port);
                    }
                    if (doLog) {
                        const ms = (endTime[1] / 1e6).toFixed(2);
                        const t = `${endTime[0]}s ${ms}ms`;
                        console.log(`TcpPortHelper.find Port ${host}:${port} ` +
                            (inUse ? 'busy' : 'free') + `, Found: ${freePorts.length} of ${needed} needed ` + t);
                    }
                }, (err) => {
                    if (doLog) {
                        console.error('Error on check:', err.message);
                    }
                    error = err;
                });
            if (error || (freePorts.length === needed)) {
                break;
            }
        }
        if (!cb) {
            return new Promise((resolve, reject) => {
                if (!error && (freePorts.length === needed)) {
                    resolve(freePorts);
                } else {
                    reject(error ? error : `Only found ${freePorts.length} of ${needed} ports`);
                }
            });
        } else {
            if (!error && (freePorts.length === needed)) {
                cb(freePorts);
            }
            return null;
        }
    }

    protected static waitForPortStatusEx(opts: PortStatusArgs): Promise<void> {
        opts.startTimeMs = Date.now();
        const func = opts.checkLocalHostAliases ? TcpPortScanner.isPortInUseEx : TcpPortScanner.isPortInUse;
        return new Promise(function tryAgain(resolve, reject) {
            func(opts.port, opts.host)
                .then((inUse) => {
                    // console.log(`${func.name} returned ${inUse}`)
                    if (inUse === opts.status) {	// status match
                        return resolve();
                    } else {
                        throw new Error('tryagain');
                    }
                }).catch((e) => {
                    if (e.message !== 'tryagain') {
                        return reject(e);
                    } else {
                        const t = Date.now() - opts.startTimeMs;
                        if (t < opts.timeOutMs) {
                            // console.log(`Setting timeout for ${opts.retryTimeMs}ms, curTime = ${t}ms`);
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

    public static waitForPortStatus(
        port, host = '0.0.0.0', inUse = true,
        checkLocalHostAliaes = true, retryTimeMs = 100, timeOutMs = 5000): Promise<void> {
        retryTimeMs = Math.max(retryTimeMs, 1);
        if (!TcpPortScanner.isLocalHost(host)) {
            return tcpPortUsed.waitForStatus(port, host, inUse, retryTimeMs, timeOutMs);
        } else {
            const opts = new PortStatusArgs(inUse, port, host, checkLocalHostAliaes, retryTimeMs, timeOutMs);
            return TcpPortScanner.waitForPortStatusEx(opts);
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
    public static waitForPortOpen(
        port, host = '0.0.0.0', checkLocalHostAliaes = true,
        retryTimeMs = 100, timeOutMs = 5000): Promise<void> {
        retryTimeMs = Math.max(retryTimeMs, 1);
        if (!TcpPortScanner.isLocalHost(host)) {
            return tcpPortUsed.waitUntilUsedOnHost(port, host, retryTimeMs, timeOutMs);
        } else {
            const opts = new PortStatusArgs(true, port, host, checkLocalHostAliaes, retryTimeMs, timeOutMs);
            return TcpPortScanner.waitForPortStatusEx(opts);
        }
    }

    public static waitForPortClosed(
        port, host = '0.0.0.0', checkLocalHostAliaes = true,
        retryTimeMs = 100, timeOutMs = 5000): Promise<void> {
        retryTimeMs = Math.max(retryTimeMs, 1);
        if (!TcpPortScanner.isLocalHost(host)) {
            return tcpPortUsed.waitUntilFreeOnHost(port, host, retryTimeMs, timeOutMs);
        } else {
            const opts = new PortStatusArgs(false, port, host, checkLocalHostAliaes, retryTimeMs, timeOutMs);
            return TcpPortScanner.waitForPortStatusEx(opts);
        }
    }

    protected static aliases: string[] = [];
    protected static getLocalHostAliases(): string[] {
        if (TcpPortScanner.aliases.length === 0) {
            // On Unixes, the first two are treated like true aliases but on Windows
            // you have distint servers on all of them. So, try everything.
            TcpPortScanner.aliases = ['0.0.0.0', '127.0.0.1', '::1', ''];
            const ifaces = os.networkInterfaces();
            Object.keys(ifaces).forEach((ifname) => {
                ifaces[ifname].forEach((iface) => {
                    if ('ipv4' === iface.family.toLowerCase()) {
                        if (TcpPortScanner.aliases.indexOf(iface.address) === -1) {
                            TcpPortScanner.aliases.push(iface.address);
                        }
                    }
                });
            });
            // console.log(aliases.join(','));
        }
        return TcpPortScanner.aliases;
    }

    // quick way of figuring out. quaranteed way would have been to do a dns.resolve()
    protected static isLocalHost(host: string): boolean {
        return !host || (host === '') || (host === 'localhost') || (TcpPortScanner.getLocalHostAliases().indexOf(host) >= 0);
    }
}

export class PortStatusArgs {
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
