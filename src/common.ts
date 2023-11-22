import { Event } from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { EventEmitter } from 'events';
import { TcpPortScanner } from './tcpportscanner';
import { GDBServer } from './backend/server';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as stream from 'stream';
import * as path from 'path';
import { GDBDebugSession } from './gdb';
const readline = require('readline');

export enum ADAPTER_DEBUG_MODE {
    NONE = 'none',
    PARSED = 'parsed',
    BOTH = 'both',
    RAW = 'raw',
    VSCODE = 'vscode'
}

export enum CortexDebugKeys {
    REGISTER_DISPLAY_MODE = 'registerUseNaturalFormat',
    VARIABLE_DISPLAY_MODE = 'variableUseNaturalFormat',
    SERVER_LOG_FILE_NAME = 'dbgServerLogfile',
    DEV_DEBUG_MODE = 'showDevDebugOutput'
}

export enum NumberFormat {
    Auto = 0,
    Hexadecimal,
    Decimal,
    Binary
}

export interface NodeSetting {
    node: string;
    expanded?: boolean;
    format?: NumberFormat;
    pinned?: boolean;
}

export class GenericCustomEvent extends Event implements DebugProtocol.Event {
    constructor(suffix: string, info: any) {
        super('custom-event-' + suffix, { info: info });
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

export interface SWOConfigureBody {
    type: string;
    args: any;            // Configuration arguments
    port?: string;        // [hostname:]port
    path?: string;        // path to file, fifo, etc.
    device?: string;      // path to serial port
    baudRate?: number;
}

export class SWOConfigureEvent extends Event implements DebugProtocol.Event {
    public boxy: SWOConfigureBody;
    public bodyx: {
        type: string,
        port: string,       // [hostname:]port
        path: string        // path to serial port, fifo, etc.
    };
    public event: string;

    constructor(params: SWOConfigureBody) {
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

    // Following two used for 'Advanced' category
    tcpPorts: string[];
    ports: number[];
}

export enum TextEncoding {
    UTF8 = 'utf8',
    UTF16LE = 'utf16le',
    ASCII = 'ascii',
    UCS2 = 'ucs2'
}

export enum BinaryEncoding {
    UNSIGNED = 'unsigned',
    SIGNED = 'signed',
    Q1616 = 'Q16.16',
    FLOAT = 'float'
}

export interface CTIOpenOCDConfig {
    enabled: boolean;
    initCommands: string[];
    pauseCommands: string[];
    resumeCommands: string[];
}

export interface RTTConsoleDecoderOpts extends RTTCommonDecoderOpts {
    // Console  options
    label: string;      // label for window
    prompt: string;     // Prompt to use
    noprompt: boolean;  // disable prompt
    noclear: boolean;   // do not clear screen buffer on connect
    logfile: string;    // log IO to file
    inputmode: TerminalInputMode;
    iencoding: TextEncoding;       // Encoding used for input
    timestamp: boolean;
    // Binary only options
    scale: number;
    encoding: BinaryEncoding;
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

export enum ChainedEvents {
    POSTSTART = 'postStart', // Default - a connection was established with the gdb-server, before initialization is done
    POSTINIT = 'postInit'    // all init functionality has been done. Generally past programming and stopped at or
                             // past reset-vector but depends on customizations
}
export interface ChainedConfig {
    enabled: boolean;
    name: string;           // Debug configuration to launch (could be attach or launch)
    delayMs: number;
    waitOnEvent: ChainedEvents;
    detached: boolean;
    lifecycleManagedByParent: boolean;
    folder: string;
    overrides: {[key: string]: any};
    inherits: string[];
}

export interface ChainedConfigurations {
    enabled: boolean;
    launches: ChainedConfig[];
    waitOnEvent: ChainedEvents;
    detached: boolean;
    lifecycleManagedByParent: boolean;
    delayMs: number;
    overrides: {[key: string]: any};
    inherits: string[];
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
    rtt_start_retry: number;
    decoders: RTTCommonDecoderOpts[];
}

export interface ElfSection {
    name: string;
    address: number;            // New base address
    addressOrig: number;        // original base address in Elf file
}
export interface SymbolFile {
    file: string;
    offset?: number;
    textaddress?: number;
    sections: ElfSection[];
    sectionMap: {[name: string]: ElfSection};
}

export interface LiveWatchConfig {
    enabled: boolean;
    samplesPerSecond?: number;
}

// Helper function to create a symbolFile object properly with required elements
export function defSymbolFile(file: string): SymbolFile {
    const ret: SymbolFile = {
        file: file,
        sections: [],
        sectionMap: {}
    };
    return ret;
}

export interface ConfigurationArguments extends DebugProtocol.LaunchRequestArguments {
    name: string;
    request: string;
    toolchainPath: string;
    toolchainPrefix: string;
    executable: string;
    servertype: string;
    serverpath: string;
    gdbPath: string;
    objdumpPath: string;
    serverArgs: string[];
    serverCwd: string;
    device: string;
    loadFiles: string[];
    symbolFiles: SymbolFile[];
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
    preResetCommands: string[];
    postResetCommands: string[];
    overrideResetCommands: string[];
    postStartSessionCommands: string[];
    postRestartSessionCommands: string[];
    overrideGDBServerStartedRegex: string;
    breakAfterReset: boolean;
    svdFile: string;
    svdAddrGapThreshold: number;
    ctiOpenOCDConfig: CTIOpenOCDConfig;
    rttConfig: RTTConfiguration;
    swoConfig: SWOConfiguration;
    liveWatch: LiveWatchConfig;
    graphConfig: any[];
    /// Triple slashes will cause the line to be ignored by the options-doc.py script
    /// We don't expect the following to be in booleann form or have the value of 'none' after
    /// The config provider has done the conversion. If it exists, it means output 'something'
    showDevDebugOutput: ADAPTER_DEBUG_MODE;
    pvtShowDevDebugOutput: ADAPTER_DEBUG_MODE;
    showDevDebugTimestamps: boolean;
    cwd: string;
    extensionPath: string;
    rtos: string;
    interface: 'jtag' | 'swd' | 'cjtag';
    targetId: string | number;
    runToMain: boolean;         // Deprecated: kept here for backwards compatibility
    runToEntryPoint: string;
    registerUseNaturalFormat: boolean;
    variableUseNaturalFormat: boolean;
    chainedConfigurations: ChainedConfigurations;

    pvtRestartOrReset: boolean;
    pvtPorts: { [name: string]: number; };
    pvtParent: ConfigurationArguments;
    pvtMyConfigFromParent: ChainedConfig;     // My configuration coming from the parent
    pvtAvoidPorts: number[];
    pvtVersion: string;                       // Version from package.json
    pvtOpenOCDDebug: boolean;
    pvtDebugOptions: DebugOptions | undefined;

    numberOfProcessors: number;
    targetProcessor: number;

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
    cmsisPack: string;
    
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

export enum CTIAction {
    'init',
    'pause',
    'resume'
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
    allocateRTTPorts(): Promise<void>;
    swoAndRTTCommands(): string[];
    serverExecutable(): string;
    serverArguments(): string[];
    initMatch(): RegExp;
    serverLaunchStarted(): void;
    serverLaunchCompleted(): Promise<void> | void;
    debuggerLaunchStarted(obj?: GDBDebugSession): void;
    debuggerLaunchCompleted(): void;
    rttPoll?(): void;
    liveGdbInitCommands?(): string[];
    ctiStopResume?(action: CTIAction): void;
}

export function genDownloadCommands(config: ConfigurationArguments, preLoadCmds: string[]) {
    if (Array.isArray(config?.loadFiles)) {
        if (config.loadFiles.length === 0) {
            return [];
        } else {
            const ret = [...preLoadCmds];
            for (const f of config.loadFiles) {
                const tmp = f.replace(/\\/g, '/');
                ret.push(`file-exec-file "${tmp}"`, 'target-download');
            }
            return ret;
        }
    }
    return [...preLoadCmds, 'target-download'];
}

export class RTTServerHelper {
    // Channel numbers previously used on the localhost
    public rttLocalPortMap: {[channel: number]: string} = {};
    public allocDone = false;

    // For openocd, you cannot have have duplicate ports and neither can
    // a multiple clients connect to the same channel. Perhaps in the future
    // it wil
    public allocateRTTPorts(cfg: RTTConfiguration, startPort: number = 60000): Promise<any> {
        this.allocDone = true;
        if (!cfg || !cfg.enabled || !cfg.decoders || cfg.decoders.length === 0) {
            return Promise.resolve();
        }

        // Remember that you can have duplicate decoder ports. ie, multiple decoders looking at the same port
        // while mostly not allowed, it could be in the future. Handle it here but disallow on a case by case
        // basis depending on the gdb-server type
        const dummy = '??';
        for (const dec of cfg.decoders) {
            if (dec.ports && (dec.ports.length > 0)) {
                dec.tcpPorts = [];
                for (const p of dec.ports) {
                    this.rttLocalPortMap[p] = dummy;
                }
            } else {
                this.rttLocalPortMap[dec.port] = dummy;
            }
        }

        const count = Object.keys(this.rttLocalPortMap).length;
        const portFinderOpts = { min: startPort, max: startPort + 2000, retrieve: count, consecutive: false };
        return TcpPortScanner.findFreePorts(portFinderOpts, GDBServer.LOCALHOST).then((ports) => {
            for (const dec of cfg.decoders) {
                if (dec.ports && (dec.ports.length > 0)) {
                    dec.tcpPorts = [];
                    for (const p of dec.ports) {
                        let str = this.rttLocalPortMap[p];
                        if (str === dummy) {
                            str = ports.shift().toString();
                            this.rttLocalPortMap[p] = str;
                        }
                        dec.tcpPorts.push(str);
                    }
                } else {
                    let str = this.rttLocalPortMap[dec.port];
                    if (str === dummy) {
                        str = ports.shift().toString();
                        this.rttLocalPortMap[dec.port] = str;
                    }
                    dec.tcpPort = str;
                }
            }
        });
    }

    public emitConfigures(cfg: RTTConfiguration, obj: EventEmitter): boolean {
        let ret = false;
        if (cfg.enabled) {
            for (const dec of cfg.decoders) {
                if (dec.tcpPort || dec.tcpPorts) {
                    obj.emit('event', new RTTConfigureEvent({
                        type: 'socket',
                        decoder: dec
                    }));
                    ret = true;
                }
            }
        }
        return ret;
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
            TcpPortScanner.isPortInUseEx(preferred, GDBServer.LOCALHOST, TcpPortScanner.AvoidPorts).then((inuse) => {
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

export function parseHexOrDecInt(str: string): number {
    return str.startsWith('0x') ? parseInt(str.substring(2), 16) : parseInt(str, 10);
}

export function toStringDecHexOctBin(val: number/* should be an integer*/): string {
    if (Number.isNaN(val)) {
        return 'NaN: Not a number';
    }
    if (!Number.isSafeInteger(val)) {
        // TODO: Handle bigNum's. We eventually have to. We need to use bigint as javascript
        // looses precision beyond 53 bits
        return 'Big Num: ' + val.toString() + '\nother-radix values not yet available. Sorry';
    }

    let ret = `dec: ${val}`;
    if (val < 0) {
        val = -val;
        val = (~(val >>> 0) + 1) >>> 0;
    }
    let str = val.toString(16);
    str = '0x' + '0'.repeat(Math.max(0, 8 - str.length)) + str;
    ret += `\nhex: ${str}`;

    str = val.toString(8);
    str = '0'.repeat(Math.max(0, 12 - str.length)) + str;
    ret += `\noct: ${str}`;

    str = val.toString(2);
    str = '0'.repeat(Math.max(0, 32 - str.length)) + str;
    let tmp = '';
    while (true) {
        if (str.length <= 8) {
            tmp = str + tmp;
            break;
        }
        tmp = ' ' + str.slice(-8) + tmp;
        str = str.slice(0, -8);
    }
    ret += `\nbin: ${tmp}`;
    return ret ;
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

    constructor(protected cb: (...args) => void, protected interval: number, runNow: boolean = false, ...args) {
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

    constructor(protected cb: (...args: any) => void, protected interval: number, ...args: any[]) {
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

export class HrTimer {
    private start: bigint;
    constructor() {
        this.start = process.hrtime.bigint();
    }

    public restart(): void {
        this.start = process.hrtime.bigint();
    }

    public getStart(): bigint {
        return this.start;
    }

    public static getNow(): bigint {
        return process.hrtime.bigint();
    }

    public deltaNs(): string {
        return (process.hrtime.bigint() - this.start).toString();
    }

    public deltaUs(): string {
        return this.toStringWithRes(3);
    }

    public deltaMs(): string {
        return this.toStringWithRes(6);
    }

    public createPaddedMs(padding: number): string {
        const hrUs = this.deltaMs().padStart(padding, '0');
        // const hrUsPadded = (hrUs.length < padding) ? '0'.repeat(padding - hrUs.length) + hrUs : '' + hrUs ;
        // return hrUsPadded;
        return hrUs;
    }

    public createDateTimestamp(): string {
        const hrUs = this.createPaddedMs(6);
        const date = new Date();
        const ret = `[${date.toISOString()}, +${hrUs}ms]`;
        return ret;
    }

    private toStringWithRes(res: number) {
        const diff = process.hrtime.bigint() - this.start + BigInt((10 ** res) / 2);
        let ret = diff.toString();
        ret = ret.length <= res ? '0' : ret.substr(0, ret.length - res);
        return ret;
    }
}

// This is not very precise. It is for seeing if the string has any special characters
// where will need to put the string in quotes as a precaution. This is more a printing
// aid rather an using for an API
export function quoteShellAndCmdChars(s): string {
    const quote = /[\s\"\*\[\]!@#$%^&*\(\)\\:]/g.test(s) ? '"' : '';
    s = s.replace(/"/g, '\\"').replace(/\\/g, '\\\\');
    return quote + s.replace(/"/g, '\\"') + quote;
}

export function quoteShellCmdLine(list: string[]): string {
    return list.map((s) => quoteShellAndCmdChars(s)).join(' ');
}

export function sanitizeDevDebug(config: ConfigurationArguments | any): boolean {
    const modes = Object.values(ADAPTER_DEBUG_MODE);
    let val = config.showDevDebugOutput;
    if (typeof(val) === 'string') {
        val = val.toLowerCase().trim();
        config.showDevDebugOutput = val;
    }
    if ((val === false) || (val === 'false') || (val === '') || (val === 'none')) {
        delete config.showDevDebugOutput;
    } else if ((val === true) || (val === 'true)')) {
        config.showDevDebugOutput = ADAPTER_DEBUG_MODE.RAW;
    } else if (modes.indexOf(val) < 0) {
        config.showDevDebugOutput = ADAPTER_DEBUG_MODE.VSCODE;
        return false;       // Meaning, needed adjustment
    }
    return true;
}

//
// For callback `cb`, fatal = false when file exists but header does not match. fatal = true means
// we could not even read the file. Use `cb` to print what ever messages you want. It is optional.
//
// Returns true if the ELF header match the elf magic number, false in all other cases
//
export function validateELFHeader(exe: string, cb?: (str: string, fatal: boolean) => void): boolean {
    try {
        if (!fs.existsSync(exe)) {
            if (cb) {
                cb(`File not found "executable": "${exe}"`, true);
            }
            return false;
        }
        const buffer = Buffer.alloc(16);
        const fd = fs.openSync(exe, 'r');
        const n = fs.readSync(fd, buffer, 0, 16, 0);
        fs.closeSync(fd);
        if (n !== 16) {
            if (cb) {
                cb(`Could not read 16 bytes from "executable": "${exe}"`, true);
            }
            return false;
        }
        // First four chars are 0x7f, 'E', 'L', 'F'
        if ((buffer[0] !== 0x7f) || (buffer[1] !== 0x45) || (buffer[2] !== 0x4c) || (buffer[3] !== 0x46)) {
            if (cb) {
                cb(`Not a valid ELF file "executable": "${exe}". Many debug functions can fail or not work properly`, false);
            }
            return false;
        }
        return true;
    }
    catch (e) {
        if (cb) {
            cb(`Could not read file "executable": "${exe}" ${e ? e.toString() : ''}`, true);
        }
        return false;
    }
}

//
// You have two choices.
// 1. Get events that you subscribe to or
// 2. get immediate callback and you will not get events
//
// There are three events
//  emit('error', err)                -- only emit
//  emit('close') and cb(null)
//  emit('line', line)  or cb(line)   -- NOT both, line can be empty ''
//  emit('exit', code, signal)        -- Only emit, NA for a stream Readable
//
// Either way, you will get a promise though. On Error though no rejection is issued and instead, it will
// emit and error and resolve to false
//
// You can chose to change the callback anytime -- perhaps based on the state of your parser. The
// callback has to return true to continue reading or false to end reading
//
// On exit for program, you only get an event. No call back.
//
// Why? Stuff like objdump/nm can produce very large output and reading them into a mongo
// string is a disaster waiting to happen. It is slow and will fail at some point. On small
// output, it may be faster but not on large ones. Tried using temp files but that was also
// slow. In this mechanism we use streams and NodeJS readline to hook things up and read
// things line at a time. Most of that kind of output needs to be parsed line at a time anyways
//
// Another benefit was we can run two programs at the same time and get the output of both in
// the same time as running just one. NodeJS is amazing juggling stuff and although not-multi threaded
// it almost look like it
//
// Finally, you can also use a file or a stream to read instead of a program to run.
//
export class SpawnLineReader extends EventEmitter {
    public callback: (line: string) => boolean;
    private promise: Promise<boolean>;
    constructor() {
        super();
    }

    public startWithProgram(
        prog: string, args: readonly string[] = [],
        spawnOpts: childProcess.SpawnOptions = {}, cb: (line: string) => boolean = null): Promise<boolean> {
        if (this.promise) { throw new Error('SpawnLineReader: can\'t reuse this object'); }
        this.callback = cb;
        this.promise = new Promise<boolean>((resolve) => {
            try {
                const child = childProcess.spawn(prog, args, spawnOpts);
                child.on('error', (err) => {
                    this.emit('error', err);
                    resolve(false);
                });
                child.on('exit', (code: number, signal: string) => {
                    this.emit('exit', code, signal);
                    // read-line will resolve. Not us
                });
                this.doReadline(child.stdout, resolve);
            }
            catch (e) {
                this.emit('error', e);
            }
        });
        return this.promise;
    }

    public startWithStream(rStream: stream.Readable, cb: (line: string) => boolean = null): Promise<boolean> {
        if (this.promise) { throw new Error('SpawnLineReader: can\'t reuse this object'); }
        this.callback = cb;
        this.promise =  new Promise<boolean>((resolve) => {
            this.doReadline(rStream, resolve);
        });
        return this.promise;
    }

    public startWithFile(filename: fs.PathLike, options: string | any = null, cb: (line: string, err?: any) => boolean = null): Promise<boolean> {
        if (this.promise) { throw new Error('SpawnLineReader: can\'t reuse this object'); }
        this.callback = cb;
        this.promise = new Promise<boolean>((resolve) => {
            const readStream = fs.createReadStream(filename, options || {flags: 'r'});
            readStream.on('error', ((e) => {
                this.emit('error', e);
                resolve(false);
            }));
            readStream.on('open', (() => {
                this.doReadline(readStream, resolve);
            }));
        });
        return this.promise;
    }

    private doReadline(rStream: stream.Readable, resolve) {
        try {
            const rl = readline.createInterface({
                input: rStream,
                crlfDelay: Infinity,
                console: false
            });
            rl.on('line', (line) => {
                if (this.callback) {
                    if (!this.callback(line)) {
                        rl.close();
                    }
                } else {
                    this.emit('line', line);
                }
            });
            rl.once('close', () => {
                if (this.callback) {
                    this.callback(null);
                }
                rStream.destroy();
                this.emit('close');
                resolve(true);
            });
        }
        catch (e) {
            this.emit('error', e);
        }
    }
}

// Both arguments are expected to be full path names
export function getPathRelative(base: string, target: string) {
    if (os.platform() === 'win32') {
        base = base.replace(/\\/g, '/');
        target = target.replace(/\\/g, '/');
    }
    if (!path.isAbsolute(base) || !path.isAbsolute(target)) {
        return target;
    }
    const baseElts = base.split('/');
    const targetElts = target.split('/');
    if (!base || !target || (base.length > target.length) || (baseElts[0] !== targetElts[0])) {
        // Roots don't even match or base is larger than the target, so no point
        return target;
    }
    while (baseElts.length && targetElts.length) {
        if (baseElts[0] !== targetElts[0]) {
            break;
        }
        baseElts.shift();
        targetElts.shift();
    }
    if (baseElts.length === 0) {
        return './' + targetElts.join('/');
    }
    if (baseElts.length > 4) {
        return target;
    }
    while (baseElts.length) {
        targetElts.unshift('..');
        baseElts.shift();
    }
    const ret = targetElts.join('/');
    return ret;
}

class DebugOptions {
    public file: string = '';
    public disassembly: boolean = false;
}
