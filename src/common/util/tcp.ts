import { TcpPortScanner } from '@common/util/tcpportscanner';

export const ANY_HOST = '0.0.0.0';

export function getAnyFreePort(preferred: number): Promise<number> {
    return new Promise(async (resolve, reject) => {
        function findFreePorts() {
            const portFinderOpts = { min: 60000, max: 62000, retrieve: 1, consecutive: false };
            TcpPortScanner.findFreePorts(portFinderOpts, ANY_HOST).then((ports) => {
                resolve(ports[0]);
            }).catch((e) => {
                reject(e);
            });
        }
        
        if (preferred > 0) {
            TcpPortScanner.isPortInUseEx(preferred, ANY_HOST, TcpPortScanner.AvoidPorts).then((inuse) => {
                if (!inuse) {
                    TcpPortScanner.EmitAllocated([preferred]);
                    resolve(preferred);
                } else {
                    findFreePorts();
                }
            });
        } else {
            findFreePorts();
        }
    });
}

export function parseHostPort(hostPort: string) {
    let port: number;
    let host = '127.0.0.1';
    const match = hostPort.match(/(.*)\:([0-9]+)/);
    if (match) {
        host = match[1] ? match[1] : host;
        port = parseInt(match[2], 10);
    } else {
        if (hostPort.startsWith(':')) {
            hostPort = hostPort.slice(1);
        }
        port = parseInt(hostPort, 10);
    }
    return { port: port, host: host };
}
