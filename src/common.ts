import { Event } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { EventEmitter } from 'events';
import { TcpPortScanner } from './tcpportscanner';
import { GDBServer } from './backend/server';

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
    RAWECHO = 'rawecho'
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
    clear: boolean;   // Clear screen buffer on connect
    logfile: string;  // log IO to file
    inputmode: TerminalInputMode; // Console Only

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
