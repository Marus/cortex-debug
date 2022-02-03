import os = require('os');
import net = require('net');
import child_process = require('child_process');
import command_exists = require('command-exists');

let logEnable = false;
function ConsoleLog(...args: any) {
    if (logEnable) {
        console.log(...args);
    }
}

export class TcpPortScanner {
    //
    // Strategies: There are two ways we can check/look for open ports or get status
    //
    // 1. Client: Try to see if we can connect to that port. While this may be preferrable
    //    it is dangerous as we would be making connections to unknown servers that may be
    //    expecting a particular type of client and may not allow further connections
    //
    // 2. Server: See if we can create a server on that port. It is super fast on all platforms,
    //    but, we can only do this on a localhost. We use this method is we can quickly determine
    //    if it is a localhost. We also look for ports on its aliases because, you can
    //    run servers on some aliases
    //
    //    CAVEAT: First time you use it, you might get a dialog box warning user that a program
    //    is creating a server you will have to allow it. Firewall rules. Connection still succeeds
    //    unless there is a compony policy
    //

    public static ForceClientMethod = false;
    public static readonly DefaultHost = '0.0.0.0';

    /**
     * Checks to see if the port is in use by creating a server on that port. You should use the function
     * `isPortInUseEx()` if you want to do a more exhaustive check or a general purpose use for any host
     * 
     * @param port port to use. Must be > 0 and <= 65535
     * @param host host ip address to use. This should be an alias to a localhost. Can be null or empty string
     * in which case the Node.js default rules apply.
     */
    public static isPortInUse(port: number, host: string, seq: number = 9999): Promise<boolean> {
        ConsoleLog(`isPortInUse: testing port ${host}:${port}`);
        return new Promise((resolve, reject) => {
            const server = net.createServer((c) => {
            });
            server.once('error', (e) => {
                const code: string = (e as any).code;
                if (code && (code === 'EADDRINUSE') || (code === 'EACCES')) {
                    // console.log(`port ${host}:${port} is used`, code);
                    if (code === 'EACCES') {
                        // Technically, EACCES means permission denied, so we consider it as used
                        ConsoleLog(`isPortInUse: port ${host}:${port} returned code EACCES?, ${seq}`);
                    }
                    ConsoleLog(`isPortInUse: port ${host}:${port} is busy, ${seq}`);
                    resolve(true);				// Port in use
                } else {
                    // This should never happen so, log it always
                    ConsoleLog(`isPortInUse: port ${host}:${port} unexpected error , ${seq}`, e);
                    reject(e);					// some other failure
                }
                server.close();
            });

            server.once('close', () => {
                ConsoleLog(`isPortInUse: port ${host}:${port} is free, ${seq}`);
                resolve(false);
            });

            server.listen(port, host, () => {
                server.close();
            });
        });
    }

    /**
     * Checks to see if the port is in use by creating a server on that port if a localhost or alias
     * or try to connect to an existing server.
     * 
     * If we think it is a localhost, It tries to make sure it and its aliases are all free. For
     * instance 0.0.0.0, 127.0.0.1, ::1 are true aliases on some systems and distinct ones on others.
     * 
     * @param port port to use. Must be > 0 and <= 65535
     * @param host host ip address to use. Ignored. All loopback addresses are checked
     */
    private static SeqNumber = 0;
    public static isPortInUseEx(port: number, host: string): Promise<boolean> {
        const seq = TcpPortScanner.SeqNumber++;
        const tries = TcpPortScanner.getLocalHostAliases();
        // We could have launced all tests at once and waited on a Promise.all but that fails on Linux
        // Have seen cases where it steps on itself. In the same try, it will give an EADDRINUSE and a listen
        // will succeed. Doing one at a time avoids that but that Linux behavior is strange indeed
        return new Promise<boolean> (async (resolve) => {
            for (const host of tries) {
                try {
                    const inUse = await TcpPortScanner.isPortInUse(port, host, seq);
                    if (inUse) {
                        resolve(true);
                        return;
                    }
                }
                catch (e) {
                    resolve(true);
                    return;
                }
            }
            resolve(false);
        });
    }

    /**
     * Scan for free ports (no one listening) on the specified host.
     * Don't like the interface but trying to keep compatibility with `portastic.find()`. Unlike
     * `portastic` the default ports to retrieve is 1 and we also have the option of returning
     * consecutive ports
     * 
     * Detail: While this function is async, promises are chained to find open ports recursively
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
        host = TcpPortScanner.DefaultHost): Promise<number[]> | null {
        logEnable = logEnable || doLog;
        let freePorts = [];
        const busyPorts = [];           // Mostly for debug
        const needed = retrieve;
        return new Promise((resolve, reject) => {
            if (needed <= 0) {
                resolve(freePorts);
                return;
            }
            function next(port: number, host: string) {
                ConsoleLog(`findFreePorts: ******** Next ${port}`);
                const startTine = process.hrtime();
                TcpPortScanner.isPortInUseEx(port, host).then((inUse) => {
                    const endTime = process.hrtime(startTine);
                    if (inUse) {
                        busyPorts.push(port);
                        ConsoleLog(`Busy ports = ${busyPorts}`);
                    } else {
                        if (consecutive && (freePorts.length > 0) &&
                            (port !== (1 + freePorts[freePorts.length - 1]))) {
                            ConsoleLog('TcpPortHelper.findFreePorts: Oops, reset for consecutive ports requirement');
                            freePorts = [];
                        }
                        freePorts.push(port);
                        ConsoleLog(`Free ports = ${freePorts}`);
                    }
                    if (logEnable) {
                        const ms = (endTime[1] / 1e6).toFixed(2);
                        const t = `${endTime[0]}s ${ms}ms`;
                        ConsoleLog(`TcpPortHelper.findFreePorts Port ${host}:${port} ` +
                            (inUse ? 'busy' : 'free') + `, Found: ${freePorts.length} of ${needed} needed ${t}`);
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
     * @deprecated This a synchronous version of `findFreePorts()`. Use it instead. This function
     * maybe slightly faster but will not play nice in a truely async. system.
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
        host = TcpPortScanner.DefaultHost, cb = null): Promise<number[]> {
        let freePorts = [];
        const busyPorts = [];
        const needed = retrieve;
        let error = null;
        logEnable = logEnable || doLog;
        if (needed <= 0) {
            return new Promise((resolve) => { resolve(freePorts); });
        }
        for (let port = min; port <= max; port++) {
            if (needed <= 0) {
                return;
            }
            const startTime = process.hrtime();
            await TcpPortScanner.isPortInUseEx(port, host)
                .then((inUse) => {
                    const endTime = process.hrtime(startTime);
                    if (inUse) {
                        busyPorts.push(port);
                    } else {
                        if (consecutive && (freePorts.length > 0) &&
                            (port !== (1 + freePorts[freePorts.length - 1]))) {
                            ConsoleLog('TcpPortHelper.finnd: Oops, reset for consecutive requirement');
                            freePorts = [];
                        }
                        freePorts.push(port);
                    }
                    if (logEnable) {
                        const ms = (endTime[1] / 1e6).toFixed(2);
                        const t = `${endTime[0]}s ${ms}ms`;
                        ConsoleLog(`TcpPortHelper.find Port ${host}:${port} ` +
                            (inUse ? 'busy' : 'free') + `, Found: ${freePorts.length} of ${needed} needed ` + t);
                    }
                }, (err) => {
                    ConsoleLog('Error on check:', err.message);
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

    protected static OSNetProbeCmd = '';
    protected static OSNetProbeCmdRegexpStr = '';
    protected static getOsNetProbeCmd(): string {
        /**
         * Notes:
         * `netstat` does not exist on Linux by default. Replacement is `ss`
         * `netstat` and `ss` are faster than lsof. netstat on mac is super fast.
         * what program to use is baed of platform and availability
         */
        if (TcpPortScanner.OSNetProbeCmd === '') {
            const commandExistsSync = command_exists.sync;
            const platform = os.platform();
            const isWin = platform === 'win32';
            const isMac = platform === 'darwin';
            /**
             * for `netstat` and `ss` We are looking for things that are in the 'local address' field for
             * ports that are listening. Technically, you can have multiple matches because the local machine
             * can have multiple addresses
             */
            if (!isWin && !isMac && commandExistsSync('ss')) {
                TcpPortScanner.OSNetProbeCmd = 'ss -nlt';
                TcpPortScanner.OSNetProbeCmdRegexpStr = 'LISTEN\\s+[^\\n]*:XYZZY\\s+[^\\s]+[^\\n]*\\n';
            } else if (commandExistsSync('netstat')) {
                // On windows, if you ask for tcp it will only give you ipv4. On Mac, it gives both, so we have to
                // use the -f on Mac
                TcpPortScanner.OSNetProbeCmd = isWin ? 'netstat -nap tcp' : 'netstat -nap tcp -f inet';
                // netstat output varies wildly, so be careful
                TcpPortScanner.OSNetProbeCmdRegexpStr = '[tT][cC][pP][^\\n]*[:\\.]XYZZY\\s+[^\\s]+\\s+LISTEN[^\\n]*\\n';
            } else if (isMac && commandExistsSync('lsof')) {
                // This is the slowest of all but probably the most consistent
                TcpPortScanner.OSNetProbeCmd = 'lsof -n -iTCP:XYZZY -sTCP:LISTEN';
                TcpPortScanner.OSNetProbeCmdRegexpStr = 'IPv4[^\\n]+:XYZZY\\s[^\\n]*\\(LISTEN\\)[^\\n]*\\n';
            } else {
                TcpPortScanner.OSNetProbeCmd = '?';
            }
        }
        return TcpPortScanner.OSNetProbeCmd;
    }

    /**
     * This is the most unobtrusive way of figuring out if a port is open. It does not try
     * to create servers or clients but use system commands to figure out if a port is open
     * On Mac, the runtime is not bad 1.5 to 2X of the time take to do it the other ways.
     * On windows, surprise!, it is an order of magnititude slower.
     * 
     * But, it is also not bulletproof. depends on version of the OS and if some things do
     * not get installed by default. This is limited to looking for IPv4 addresses
     * 
     * @param port look for port to be open. don't matter what
     * @param retryTimeMs retry after that many milliseconds.
     * @param timeOutMs max timeout
     * @param fallback Fallback to using the intrusive method if proper OS command is not available
     */
    public static waitForPortOpenOSUtl(port: number, retryTimeMs = 100, timeOutMs = 5000, fallback = true, doLog = true): Promise<void> {
        const cmd = TcpPortScanner.getOsNetProbeCmd().replace('XYZZY', port.toString());
        logEnable = logEnable || doLog;
        ConsoleLog(cmd);
        if (fallback && (cmd === '?')) {
            return TcpPortScanner.waitForPortOpen(port, TcpPortScanner.DefaultHost, true, retryTimeMs, timeOutMs);
        }

        const rexStr = TcpPortScanner.OSNetProbeCmdRegexpStr.replace('XYZZY', port.toString());
        ConsoleLog(rexStr);
        const rex = new RegExp(rexStr);
        const startTimeMs = Date.now();
        let first = true;
        retryTimeMs = Math.max(retryTimeMs, 1);
        return new Promise(function tryAgain(resolve, reject) {
            if (cmd === '?') {
                return reject(new Error('failed'));
            }
            child_process.exec(cmd, (error, stdout) => {
                if (error && !cmd.startsWith('lsof')) {
                    // lsof returns an error code if nothing matches. May match later
                    return reject(error);
                } else if (rex.test(stdout)) {
                    ConsoleLog(stdout.match(rex).join('\n'));
                    return resolve();
                } else {
                    if (first) {
                        // ConsoleLog(stdout);
                        first = false;
                    }
                    const t = Date.now() - startTimeMs;
                    if (t < timeOutMs) {
                        ConsoleLog(`waitForPortOpenOSUtl: Setting timeout for ${retryTimeMs}ms, curTime = ${t}ms`);
                        setTimeout(() => {
                            tryAgain(resolve, reject);
                        }, retryTimeMs);
                    } else {
                        return reject(new Error('timeout'));
                    }
                }
            });
        });
    }

    /**
     * This is the workhorse function for all kinds of status queries on port:localhost
     * 
     * @param opts 
     */
    protected static waitForPortStatusEx(opts: PortStatusArgs): Promise<void> {
        opts.startTimeMs = Date.now();
        const functor = opts.checkLocalHostAliases ? TcpPortScanner.isPortInUseEx : TcpPortScanner.isPortInUse;
        return new Promise(function tryAgain(resolve, reject) {
            functor(opts.port, opts.host)
                .then((inUse) => {
                    // ConsoleLog(`${functor.name} returned ${inUse}`)
                    if (inUse === opts.desiredStatus) {	// status match
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
                            // ConsoleLog(`Setting timeout for ${opts.retryTimeMs}ms, curTime = ${t}ms`);
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

    /**
     * Wait for particular port status. We always do a minium of one try regardless of timeouts, so setting a timeout
     * of 0 means only one try
     * 
     * @param inUse true means wait for port to be ready to use. False means wait for port to close
     * @return a promise. On failure, the error is Error('timeout') for a true timeout or something else
     * for other failures
     */
    public static waitForPortStatus(
        port, host = TcpPortScanner.DefaultHost, inUse = true,
        checkLocalHostAliaes = true, retryTimeMs = 100, timeOutMs = 5000): Promise<void> {
        retryTimeMs = Math.max(retryTimeMs, 1);
        const opts = new PortStatusArgs(inUse, port, host, checkLocalHostAliaes, retryTimeMs, timeOutMs);
        return TcpPortScanner.waitForPortStatusEx(opts);
    }

    /**
     * Wait for port to open. We always do a minium of one try regardless of timeouts, so setting a timeout
     * of 0 means only one try
     * 
     * @return a promise. On failure, the error is Error('timeout') for a true timeout or something else
     * for other failures
     */
    public static waitForPortOpen(
        port, host = TcpPortScanner.DefaultHost, checkLocalHostAliaes = true,
        retryTimeMs = 100, timeOutMs = 5000): Promise<void> {
        retryTimeMs = Math.max(retryTimeMs, 1);
        const opts = new PortStatusArgs(true, port, host, checkLocalHostAliaes, retryTimeMs, timeOutMs);
        return TcpPortScanner.waitForPortStatusEx(opts);
    }

    /**
     * Wait for port to close. We always do a minium of one try regardless of timeouts, so setting a timeout
     * of 0 means only one try
     * 
     * @return a promise. On failure, the error is Error('timeout') for a true timeout or something else
     * for other failures
     */
    public static waitForPortClosed(
        port, host = TcpPortScanner.DefaultHost, checkLocalHostAliaes = true,
        retryTimeMs = 100, timeOutMs = 5000): Promise<void> {
        retryTimeMs = Math.max(retryTimeMs, 1);
        const opts = new PortStatusArgs(false, port, host, checkLocalHostAliaes, retryTimeMs, timeOutMs);
        return TcpPortScanner.waitForPortStatusEx(opts);
    }

    // we cache only ipv4 address and the default ipv6 address for the localhost. All ipv6 aliases
    // seem to be true aliases on all systems but ipv4 aliases may or may not be.
    private static localHostAliases: string[] = [];
    protected static getLocalHostAliases(): string[] {
        if (TcpPortScanner.localHostAliases.length === 0) {
            // On Unixes, the two are treated like true aliases but on Windows
            // you can have distint servers on all of them. So, try everything.
            TcpPortScanner.localHostAliases = ['127.0.0.1', '0.0.0.0'];
            const ifaces = os.networkInterfaces();
            Object.keys(ifaces).forEach((ifname) => {
                ifaces[ifname].forEach((iface) => {
                    // Skip external interfaces (VPN tunnels, actual IP, etc). Only want loopbacks
                    if (iface.internal && ('ipv4' === iface.family.toLowerCase())) {
                        if (TcpPortScanner.localHostAliases.indexOf(iface.address) === -1) {
                            TcpPortScanner.localHostAliases.push(iface.address);
                        }
                    }
                });
            });
            // ConsoleLog(aliases.join(','));
        }
        return TcpPortScanner.localHostAliases;
    }

   /**
    * quick/dirty way of figuring out if this is a local host. guaranteed way would have
    * been to do a dns.resolve() or dns.lookup(). server method only works for local hosts.
    * Client method works for anything but super slow on windows.
    * 
    * FIXME: should we use server-method only on windows?
    * 
    * @param host an ip-address
    */
    protected static shouldUseServerMethod(host: string): boolean {
        if (TcpPortScanner.ForceClientMethod) {
            return false;
        }
        return (!host || (host.toLowerCase() === 'localhost') ||
            (TcpPortScanner.getLocalHostAliases().indexOf(host) >= 0));
    }
}

export class PortStatusArgs {
    public startTimeMs: number = 0;
    constructor(
        public readonly desiredStatus: boolean,	// true means looking for open
        public readonly port: number,
        public readonly host: string = TcpPortScanner.DefaultHost,
        public readonly checkLocalHostAliases = true,
        public readonly retryTimeMs: number = 100,
        public readonly timeOutMs: number = 5000
    ) {
        this.retryTimeMs = Math.max(this.retryTimeMs, 1);
    }
}
