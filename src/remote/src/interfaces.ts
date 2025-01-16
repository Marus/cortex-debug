import { InterfaceIpsSet } from './tcpportscanner';

export enum RpcFuncNames {
    hello = 'hello',
    findFreePorts = 'findFreePorts',
    startGdbServer = 'startGdbServer',
    endGdbServer = 'endGdbServer',
    stdin = 'stdin',
    stdout = 'stdout',
    stderr = 'stderr'
}

export enum RpcEeventNames {
    stdout = 'stdout',
    stderr = 'stderr',
    serverExited = 'serverExited'
}

export interface helloReturn {
    port: number;
    host: string;
    addrs: InterfaceIpsSet;
    platform: NodeJS.Platform;
    release: string;
    version: string;
    hostname: string;
    mySessionId: string;
    mySettings: {[key: string]: any};
}

export interface findFreePortsArgs {
    bindToAll: boolean;
    min: number;
    max: number;
    retrieve?: number;      // default = 1
    consecutive?: boolean;  // default = false
    doLog?: boolean;        // default = false
}

export interface startGdbServerArgs {
    application: string;
    args: string[];
    cwd?: string | null | undefined;
}

export interface stdinArgs {
    data: Buffer;
    encoding: 'utf8' | 'ascii';
}

export interface eventArgs {
    type: RpcEeventNames;
    data: Buffer | number;      // Always 'utf8'. number is exit-code if any
}
