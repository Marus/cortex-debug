import { Event } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { EventEmitter } from 'events';

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

export class SWOConfigureEvent extends Event implements DebugProtocol.Event {
    public body: {
        type: string,
        port: number,
        path: string
    };
    public event: string;

    constructor(params: any) {
        const body = params;
        super('swo-configure', body);
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
}

export interface ConfigurationArguments extends DebugProtocol.LaunchRequestArguments {
    toolchainPath: string;
    executable: string;
    servertype: string;
    serverpath: string;
    device: string;
    debuggerArgs: string[];
    postLaunchCommands: string[];
    svdFile: string;
    swoConfig: SWOConfiguration;
    graphConfig: any[];
    showDevDebugOutput: boolean;
    cwd: string;
    extensionPath: string;

    // J-Link Specific
    ipAddress: string;
    serialNumber: string;
    jlinkInterface: string;

    // OpenOCD Specific
    configFiles: string[];

    // PyOCD Specific
    boardId: string;
    targetId: string;

    // StUtil Specific
    v1: boolean;

    // BMP Specific
    BMPGDBSerialPort: string;
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
    launchCommands(): string[];
    attachCommands(): string[];
    restartCommands(): string[];
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
