import { Event } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { EventEmitter } from 'events';
import { TcpPortScanner } from './tcpportscanner';
import { GDBServer } from './backend/server';
import { time } from 'console';

export enum NumberFormat {
    Auto = 0,
    Hexidecimal,
    Decimal,
    Binary
}

export interface NodeSetting {
    node: string;
    expanded?: boolean;
    format?: NumberFormat;
    pinned?: boolean;
}

export class AdapterOutputEvent extends Event implements DebugProtocol.Event {
    public body: {
        type: string,
        content: string
    };
    public event: string;

    constructor(content: string, type: string) {
        super('adapter-output', { content: content, type: type });
    }
}

export class StoppedEvent extends Event implements DebugProtocol.Event {
    public readonly body: {
        reason: string;
        description?: string;
        threadId?: number;
        text?: string;
        allThreadsStopped?: boolean;
    };

    constructor(reason: string, threadId: number, allThreadsStopped: boolean) {
        super('stopped', {
            reason: reason,
            threadId: threadId,
            allThreadsStopped: allThreadsStopped
        });
    }
}

export class SWOConfigureEvent extends Event implements DebugProtocol.Event {
    public body: {
        type: string,
        port: string,       // [hostname:]port
        path: string        // path to serial port, fifo, etc.
    };
    public event: string;

    constructor(params: any) {
        const body = params;
        super('swo-configure', body);
    }
}

export enum TerminalInputMode {
    COOKED = 'cooked',
    RAW = 'raw',
    RAWECHO = 'rawecho',
    DISABLED = 'disabled'
}
export interface RTTCommonDecoderOpts {
    type: string;     // 'console', 'graph', ...
    tcpPort: string;  // [hostname:]port
    port: number;     // RTT Channel number

    // Following two used for 'Advanced' catefory
    tcpPorts: string[];
    ports: number[];
}

export interface RTTConsoleDecoderOpts extends RTTCommonDecoderOpts {
    // Console  options
    encoding: string; // 'utf8', 'ascii', etc.
    label: string;    // label for window
    prompt: string;   // Prompt to use
    noprompt: boolean;// disable prompt
    noclear: boolean; // do not vlear screen buffer on connect
    logfile: string;  // log IO to file
    inputmode: TerminalInputMode;
    // Binary only options
    scale: number;
}

export class RTTConfigureEvent extends Event implements DebugProtocol.Event {
    public body: {
        type: string,   // Currently, only 'socket' is supported
        decoder: RTTCommonDecoderOpts;
    };
    public event: string;

    constructor(params: any) {
        const body = params;
        super('rtt-configure', body);
    }
}

export class TelemetryEvent extends Event implements DebugProtocol.Event {
    public body: {
        category: string,
        action: string,
        label: string,
        parameters: { [key: string]: string }
    };
    public event: string;

    constructor(category: string, action: string, label: string, parameters: { [key: string]: string } = {}) {
        const body = { category: category, action: action, label: label, parameters: parameters };
        super('record-event', body);
    }
}

export interface SWOConfiguration {
    enabled: boolean;
    cpuFrequency: number;
    swoFrequency: number;
    decoders: any[];
    profile: boolean;
    source: string;
    swoPort: string;
    swoPath: string;
}

export interface RTTConfiguration {
    enabled: boolean;
    address: string;
    searchSize: number;
    searchId: string;
    clearSearch: boolean;
    polling_interval: number;
    decoders: RTTCommonDecoderOpts[];
    allowSharedTcp: boolean;
}

export interface ConfigurationArguments extends DebugProtocol.LaunchRequestArguments {
    request: string,
    toolchainPath: string;
    toolchainPrefix: string;
    executable: string;
    servertype: string;
    serverpath: string;
    gdbPath: string;
    serverArgs: string[];
    device: string;
    debuggerArgs: string[];
    preLaunchCommands: string[];
    postLaunchCommands: string[];
    overrideLaunchCommands: string[];
    preAttachCommands: string[];
    postAttachCommands: string[];
    overrideAttachCommands: string[];
    preRestartCommands: string[];
    postRestartCommands: string[];
    overrideRestartCommands: string[];
    postStartSessionCommands: string[];
    postRestartSessionCommands: string[];
    overrideGDBServerStartedRegex: string;
    svdFile: string;
    rttConfig: RTTConfiguration;
    swoConfig: SWOConfiguration;
    graphConfig: any[];
    showDevDebugOutput: boolean;
    showDevDebugTimestamps: boolean;
    cwd: string;
    extensionPath: string;
    rtos: string;
    interface: string;
    targetId: string | number;
    cmsisPack: string;
    runToMain: boolean;         // Deprecated: kept here for backwards compatibility
    runToEntryPoint: string;
    flattenAnonymous: boolean;
    registerUseNaturalFormat: boolean;

    numberOfProcessors: number;
    targetProcessor: number;

    // C++ specific
    demangle: boolean;

    // J-Link Specific
    ipAddress: string;
    serialNumber: string;
    jlinkscript: string;
    
    // OpenOCD Specific
    configFiles: string[];
    searchDir: string[];
    openOCDLaunchCommands: string[];
    openOCDPreConfigLaunchCommands: string[];

    // PyOCD Specific
    boardId: string;
    
    // StUtil Specific
    v1: boolean;

    // ST-LINK GDB server specific
    stm32cubeprogrammer: string;

    // BMP Specific
    BMPGDBSerialPort: string;
    powerOverBMP: string;

    // QEMU Specific
    cpu: string;
    machine: string;

    // External 
    gdbTarget: string;
}

export interface DisassemblyInstruction {
    address: string;
    functionName: string;
    offset: number;
    instruction: string;
    opcodes: string;
}

export interface GDBServerController extends EventEmitter {
    portsNeeded: string[];
    name: string;

    setPorts(ports: { [name: string]: number }): void;
    setArguments(args: ConfigurationArguments): void;

    customRequest(command: string, response: DebugProtocol.Response, args: any): boolean;
    initCommands(): string[];
    launchCommands(): string[];
    attachCommands(): string[];
    restartCommands(): string[];
    swoAndRTTCommands(): string[];
    serverExecutable(): string;
    serverArguments(): string[];
    initMatch(): RegExp;
    serverLaunchStarted(): void;
    serverLaunchCompleted(): void;
    debuggerLaunchStarted(): void;
    debuggerLaunchCompleted(): void;
}

export class RTTServerHelper {
    public rttPreferredPorts:  { [channel: number]: string} = {};
    // Channel numbers previously used on the localhost
    public rttLocalPortMap: { [channel: number]: string} = {};

    // For openocd, you cannot have have duplicate ports and neither can
    // a multple clients connect to the same channel. Perhaps in the future
    // it wil
    public rttPortsPending: number = 0;
    public allocateRTTPorts(cfg: RTTConfiguration) {
        this.rttPortsPending = 0;
        if (cfg && cfg.enabled) {
            for (const dec of cfg.decoders) {
                if (dec.ports && (dec.ports.length > 0)) {
                    this.rttPortsPending = this.rttPortsPending + dec.ports.length;
                    for (const p of dec.ports) {
                        this.allocateOnePort(p).then((ret) => {
                            this.rttPortsPending = this.rttPortsPending - 1;
                        });
                    }
                } else {
                    this.rttPortsPending = this.rttPortsPending + 1;
                    this.allocateOnePort(dec.port).then((ret) => {
                        this.rttPortsPending = this.rttPortsPending - 1;
                        dec.tcpPort = ret;
                    });
                }
            }
        }
    }

    public allocateOnePort(channel: number): Promise<string> {
        return new Promise((resolve) => {
            if (this.rttLocalPortMap[channel]) {
                resolve(this.rttLocalPortMap[channel]);
            } else {
                const preferred = this.rttPreferredPorts[channel] ? parseInt(this.rttPreferredPorts[channel]) : -1;
                getAnyFreePort(preferred).then((num) => {
                    let ret = this.rttLocalPortMap[channel];
                    if (!ret) {     // If we already had a port assigned to this channel, must reuse it
                        ret = num.toString();
                        this.rttLocalPortMap[channel] = ret;
                    }
                    resolve(ret);
                }).catch(() => {
                    console.error(`Could not get free tcp port for RTT channel ${channel}`);
                    resolve('');
                });
            }
        });
    }

    public setPreferredPorts(map: { [channel: number]: string} ) {
        if (map) {
            this.rttPreferredPorts = map;
        }
    }

    public emitConfigures(cfg: RTTConfiguration, obj: EventEmitter) {
        if (cfg.enabled) {
            for (const dec of cfg.decoders) {
                if (dec.tcpPort || dec.tcpPorts) {
                    obj.emit('event', new RTTConfigureEvent({
                        type: 'socket',
                        decoder: dec
                    }));
                }
            }
        }        
    }
}

export function calculatePortMask(decoders: any[]) {
    if (!decoders) { return 0; }

    let mask: number = 0;
    decoders.forEach((d) => {
        if (d.type === 'advanced') {
            for (const port of d.ports) {
                mask = (mask | (1 << port)) >>> 0;
            }
        }
        else {
            mask = (mask | (1 << d.port)) >>> 0;
        }
    });
    return mask;
}

export function createPortName(procNum: number, prefix: string = 'gdbPort'): string {
    return prefix + ((procNum === 0) ? '' : procNum.toString());
}

export function getAnyFreePort(preferred: number): Promise<number> {
    return new Promise(async (resolve, reject) => {
        function findFreePorts() {
            const portFinderOpts = { min: 60000, max: 62000, retrieve: 1, consecutive: false };
            TcpPortScanner.findFreePorts(portFinderOpts, GDBServer.LOCALHOST).then((ports) => {
                resolve(ports[0]);
            }).catch((e) => {
                reject(e);
            });        
        }
        
        if (preferred > 0) {
            TcpPortScanner.isPortInUseEx(preferred, GDBServer.LOCALHOST).then((inuse) => {
                if (!inuse) {
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

export function parseHexOrDecInt(str: string): number {
    return str.startsWith('0x') ? parseInt(str.substring(2), 16) : parseInt(str, 10);
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

export function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
export class ResettableInterval {
    protected intervalId: NodeJS.Timeout;
    protected args: any[];

    constructor(protected cb: (...args) => void, protected interval:number, runNow: boolean = false, ...args) {
        this.args = args;
        if (runNow) {
            this.cb(...this.args);
        }
        this.intervalId = setInterval(this.cb, this.interval, ...this.args);
    }

    public kill() {
        if (this.isRunning()) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    public reset(interval?: number) {
        this.kill();
        if (interval !== undefined) { this.interval = interval; }
        this.intervalId = setInterval(this.cb, this.interval, ...this.args);
    }

    public isRunning() {
        return this.intervalId != null;
    }
}

export class ResettableTimeout {
    protected timeoutId: NodeJS.Timeout = null;
    protected args: any[];

    constructor(protected cb: (...args: any) => void, protected interval:number, ...args: any[]) {
        this.args = args;
        this.timeoutId = setTimeout((...args) => {
            this.timeoutId = null;
            this.cb(...this.args);
        } , this.interval, ...this.args);
    }

    public kill() {
        if (this.isRunning()) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
    }

    public reset(interval?: number) {
        this.kill();
        if (interval !== undefined) { this.interval = interval; }
        this.timeoutId = setTimeout(this.cb, this.interval, ...this.args);
    }

    public isRunning() {
        return this.timeoutId !== null;
    }
}
