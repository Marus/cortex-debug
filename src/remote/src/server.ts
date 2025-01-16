import * as net from 'net';
import * as os from 'os';
import * as vscode from 'vscode';
import * as rpc from 'vscode-jsonrpc/node';
import { TcpPortScanner, InterfaceIpsSet } from './tcpportscanner';
import * as Interfaces from './interfaces';

export class Server {
    public readonly ipAddr: string = '';
    public readonly allIps: InterfaceIpsSet;
    public port: number = -1;
    private server: net.Server | undefined;
    private useHost = '0.0.0.0';    // Maybe we should actual host-ip instead of opening it up

    constructor(public context: vscode.ExtensionContext) {
        this.allIps = TcpPortScanner.getExternalIPv4Addresses();
        this.ipAddr = this.allIps.defaultIp || '127.0.0.1';
    }

    public startServer(): Promise<number> {
        return new Promise<number>(async (resolve, reject) => {
            try {
                const start = 43473 + Math.floor(Math.random() * 10);
                const args = { min: start, max: start + 1000 };
                const ports = await TcpPortScanner.findFreePorts(args);
                if (!ports || ports.length < 1) {
                    throw new Error('Internal error: zero ports returned!?');
                }
                this.port = ports[0];
                this.server = new net.Server(this.newConnection.bind(this));
                this.server.on(('error'), (e) => {
                    // if (e.code === 'EADDRINUSE'), we have a bug or in findFreePorts or someone stole it
                    reject(e);
                });
                this.server.on('listening', () => {
                    resolve(this.port);
                });
                this.server.on('close', () => {
                    this.server?.listen(this.port, this.useHost);
                });
                this.server.listen(this.port, this.useHost);
            } catch (e: any) {
                reject(e);
            }
        });
    }

    public hello(sessionId: string): Interfaces.helloReturn {
        const config = vscode.workspace.getConfiguration('cortex-debug');
        const settings: { [key: string]: any } = {};
        for (const [key, value] of Object.entries(config)) {
            if ((typeof value !== 'function') && (value !== null) && (value !== undefined)) {
                settings[key] = value;
            }
        }
        const ret: Interfaces.helloReturn = {
            port: this.port,
            host: this.ipAddr,
            addrs: this.allIps,
            platform: os.platform(),
            release: os.release(),
            version: os.version(),
            hostname: os.hostname(),
            mySessionId: vscode.env.sessionId,
            mySettings: settings
        };
        return ret;
    }

    private newConnection(socket: net.Socket) {
        const client = new Client(socket, this);
    }
}

class Client {
    private connection: rpc.MessageConnection;

    constructor(protected socket: net.Socket, protected server: Server) {
        socket.setKeepAlive(true);
        this.connection = rpc.createMessageConnection(
            new rpc.StreamMessageReader(this.socket, 'utf-8'),
            new rpc.StreamMessageWriter(this.socket, 'utf-8')
        );

        let notification = new rpc.NotificationType<Interfaces.eventArgs>('event');
        this.connection.onNotification(notification, (param: Interfaces.eventArgs) => {
            console.log(param);
        });

        this.connection.onRequest(
            new rpc.RequestType1<string, Interfaces.helloReturn, void>(Interfaces.RpcFuncNames.hello),
            this.hello.bind(this));
        this.connection.onRequest(
            new rpc.RequestType2<string, Interfaces.findFreePortsArgs, number[], void>(Interfaces.RpcFuncNames.findFreePorts),
            this.findFreePorts.bind(this));
        this.connection.onRequest(
            new rpc.RequestType2<string, Interfaces.startGdbServerArgs, boolean, void>(Interfaces.RpcFuncNames.startGdbServer),
            this.startGdbServer.bind(this));
        this.connection.onRequest(
            new rpc.RequestType1<string, boolean, void>(Interfaces.RpcFuncNames.endGdbServer),
            this.endGdbServer.bind(this));
        this.connection.onRequest(
            new rpc.RequestType2<string, string, boolean, void>(Interfaces.RpcFuncNames.stdin),
            this.stdin.bind(this));

        this.connection.listen();
        const arg: Interfaces.eventArgs = {
            type: Interfaces.RpcEeventNames.stdout,
            data: Buffer.from('Message from server')
        };
        this.connection.sendNotification(notification, arg);
    }

    public hello(sessionId: string): Interfaces.helloReturn {
        return this.server.hello(sessionId);
    }

    private async findFreePorts(sessionId: string, args: Interfaces.findFreePortsArgs): Promise<number[]> {
        if (sessionId !== vscode.env.sessionId) {
            return [];
        }
        const ports = await TcpPortScanner.findFreePorts(args);
        return ports || [];
    }

    private startGdbServer(sessionId: string, args: Interfaces.startGdbServerArgs): boolean {
        return false;
    }

    private endGdbServer(sessionId: string): boolean {
        return false;
    }

    private stdin(sessionId: string, data: string): boolean {
        return false;
    }
}
