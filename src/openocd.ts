import { DebugProtocol } from '@vscode/debugprotocol';
import {
    GDBServerController, ConfigurationArguments, SWOConfigureEvent,
    calculatePortMask, createPortName, RTTServerHelper, genDownloadCommands, CTIAction
} from './common';
import * as os from 'os';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { EventEmitter } from 'events';
import { MI2 } from './backend/mi2/mi2';
import { GDBDebugSession } from './gdb';

function getLogPath() {
    try {
        const tmpDirName = os.tmpdir();
        const fsPath = path.join(tmpDirName, 'cortex-debug-openocd.log');
        return fsPath;
    }
    catch {
        return '';
    }
}

let firstLog = true;
let doLog = false;
const logFsPath = getLogPath();

function OpenOCDLog(str: string) {
    if (!str || !doLog) { return; }
    try {
        const date = new Date();
        str = `[${date.toISOString()}] ` + str;
        console.log(str);
        if (logFsPath) {
            if (!str.endsWith('\n')) {
                str += '\n';
            }
            if (firstLog) {
                fs.writeFileSync(logFsPath, str);
                firstLog = false;
            } else {
                fs.appendFileSync(logFsPath, str);
            }
        }
    }
    catch (e) {
        console.log(e ? e.toString() : 'unknown exception?');
    }
}

export class OpenOCDServerController extends EventEmitter implements GDBServerController {
    // We wont need all of these ports but reserve them anyways
    public portsNeeded = ['gdbPort', 'tclPort', 'telnetPort', 'swoPort'];
    public name = 'OpenOCD';
    private args: ConfigurationArguments;
    private ports: { [name: string]: number };
    private rttHelper: RTTServerHelper = new RTTServerHelper();

    constructor() {
        super();
    }

    public setPorts(ports: { [name: string]: number }): void {
        this.ports = ports;
    }

    public setArguments(args: ConfigurationArguments): void {
        this.args = args;
        if (args.pvtOpenOCDDebug) {
            doLog = true;
        }
    }

    public customRequest(command: string, response: DebugProtocol.Response, args: any): boolean {
        return false;
    }

    public initCommands(): string[] {
        const gdbport = this.ports[createPortName(this.args.targetProcessor)];

        return [
            `target-select extended-remote localhost:${gdbport}`
        ];
    }

    public liveGdbInitCommands(): string[] {
        return this.initCommands();
    }

    // ST/OpenOCD HACK: There are two problems.
    // ST with their release on Dec 31 2021, released their FW/SW where it no longer works
    // when any configuring is done after reset. It is more than likely something that
    // was done with OpenOCD. As such, SWO config. fails. Basically, you cannot write to
    // memory/registers before at least a fake stepi is done.
    //
    // OpenOCD itself has issues that it does not report a proper stack until you do a fake
    // step. So, in some cases, your PC an the stack don't match resulting in wrong source
    // being shown.
    //
    // OpenOCD provides a hack to synchronize gdb and itself by issuing 'monitor gdb_sync' followed
    // by a 'stepi' which doesn't really do a stepi but can emulate a break due to a step that
    // gdb expects
    public launchCommands(): string[] {
        const commands = [
            ...genDownloadCommands(this.args, ['interpreter-exec console "monitor reset halt"']),
            'interpreter-exec console "monitor reset halt"'
        ];
        return commands;
    }

    public attachCommands(): string[] {
        const commands = [
            'interpreter-exec console "monitor halt"'
        ];
        return commands;
    }

    public resetCommands(): string[] {
        const commands: string[] = [
            'interpreter-exec console "monitor reset halt"'
        ];

        if (!this.args.runToEntryPoint && this.args.breakAfterReset) {
            // The following will force an sync between gdb and openocd. Maybe we should do this for launch as well
            commands.push(
                // ST/OpenOCD HACK: See HACK NOTES above
                'interpreter-exec console "monitor gdb_sync"',
                'interpreter-exec console "stepi"'
            );
        }
        return commands;
    }

    public rttCommands(): string[] {
        const commands = [];
        if (this.args.rttConfig.enabled && !this.args.pvtIsReset) {
            const cfg = this.args.rttConfig;
            if ((this.args.request === 'launch') && cfg.clearSearch) {
                // The RTT control block may contain a valid search string from a previous run
                // and RTT ends up outputting garbage. Or, the server could read garbage and
                // misconfigure itself. Following will clear the RTT header which
                // will cause the server to wait for the server to actually be initialized
                commands.push(`interpreter-exec console "monitor mwb ${cfg.address} 0 ${cfg.searchId.length}"`);
            }
            commands.push(`interpreter-exec console "monitor rtt setup ${cfg.address} ${cfg.searchSize} {${cfg.searchId}}"`);
            if (cfg.polling_interval > 0) {
                commands.push(`interpreter-exec console "monitor rtt polling_interval ${cfg.polling_interval}"`);
            }

            // tslint:disable-next-line: forin
            for (const channel in this.rttHelper.rttLocalPortMap) {
                const tcpPort = this.rttHelper.rttLocalPortMap[channel];
                commands.push(`interpreter-exec console "monitor rtt server start ${tcpPort} ${channel}"`);
            }

            // We are starting way too early before the FW has a chance to initialize itself
            // but there is no other handshake mechanism
            commands.push('interpreter-exec console "monitor rtt start"');
            if (this.args.rttConfig.rtt_start_retry === undefined) {
                this.args.rttConfig.rtt_start_retry = 1000;
            }
        }
        return commands;
    }

    public swoAndRTTCommands(): string[] {
        const commands = [];
        if (this.args.swoConfig.enabled) {
            const swocommands = this.SWOConfigurationCommands();
            commands.push(...swocommands);
        }
        return commands.concat(this.rttCommands());
    }

    private SWOConfigurationCommands(): string[] {
        const commands: string[] = [];

        if (!this.args.pvtIsReset) {
            const portMask = '0x' + calculatePortMask(this.args.swoConfig.decoders).toString(16);
            const swoFrequency = this.args.swoConfig.swoFrequency;
            const cpuFrequency = this.args.swoConfig.cpuFrequency;
            const source = this.args.swoConfig.source;
            const swoOutput = (source === 'serial')
                ? 'external'
                : ':' + this.ports[createPortName(this.args.targetProcessor, 'swoPort')];
            commands.push(
                `monitor CDSWOConfigure ${cpuFrequency} ${swoFrequency} ${swoOutput}`,
                `set $cpuFreq = ${cpuFrequency}`,
                `set $swoFreq = ${swoFrequency}`,
                `set $swoPortMask = ${portMask}`
            );
        }

        commands.push(
            // ST/OpenOCD HACK: See HACK NOTES above.
            'monitor gdb_sync', 'stepi',
            'SWO_Init'
        );
        // commands.push(this.args.swoConfig.profile ? 'EnablePCSample' : 'DisablePCSample');
        
        return commands.map((c) => `interpreter-exec console "${c}"`);
    }

    public serverExecutable(): string {
        if (this.args.serverpath) { return this.args.serverpath; }
        else {
            return os.platform() === 'win32' ? 'openocd.exe' : 'openocd';
        }
    }

    public allocateRTTPorts(): Promise<void> {
        return this.rttHelper.allocateRTTPorts(this.args.rttConfig);
    }

    public serverArguments(): string[] {
        let serverargs = [];

        // Regardless of the target processor, we will only supply the processor '0's port#
        // OpenOcd will increment and assign the right port-numer to the right processor
        serverargs.push('-c', `gdb_port ${this.ports['gdbPort']}`);
        serverargs.push('-c', `tcl_port ${this.ports['tclPort']}`);
        serverargs.push('-c', `telnet_port ${this.ports['telnetPort']}`);

        this.args.searchDir.forEach((cs, idx) => {
            serverargs.push('-s', cs);
        });

        if (this.args.searchDir.length === 0) {
            serverargs.push('-s', this.args.cwd);
        }

        for (const cmd of this.args.openOCDPreConfigLaunchCommands || []) {
            serverargs.push('-c', cmd);
        }

        serverargs.push('-f', `${this.args.extensionPath}/support/openocd-helpers.tcl`);
        this.args.configFiles.forEach((cf, idx) => {
            serverargs.push('-f', cf);
        });

        if (this.args.rtos) {
            serverargs.push('-c', `CDRTOSConfigure ${this.args.rtos}`);
        }

        if (this.args.serverArgs) {
            serverargs = serverargs.concat(this.args.serverArgs);
        }

        const commands = [];

        if (this.args.swoConfig.enabled) {
            if (!(['probe', 'socket', 'file', 'serial'].find((s) => s === this.args.swoConfig.source))) {
                this.args.swoConfig.enabled = false;
            }
        }

        if (commands.length > 0) {
            serverargs.push('-c', commands.join('; '));
        }

        for (const cmd of this.args.openOCDLaunchCommands || []) {
            serverargs.push('-c', cmd);
        }

        if (this.args.liveWatch?.enabled) {
            serverargs.push('-c', 'CDLiveWatchSetup');
        }

        OpenOCDLog('Launching: ' + serverargs.join(' '));
        return serverargs;
    }

    public initMatch(): RegExp {
        return /Info\s:[^\n]*Listening on port \d+ for gdb connection/i;
    }

    public serverLaunchStarted(): void {
    }

    public serverLaunchCompleted(): void {
        if (this.args.swoConfig.enabled) {
            const source = this.args.swoConfig.source;
            if ((source === 'probe') || (source === 'socket') || (source === 'file')) {
                const swoPortNm = createPortName(this.args.targetProcessor, 'swoPort');
                this.emit('event', new SWOConfigureEvent({
                    type: 'socket',
                    args: this.args,
                    port: this.ports[swoPortNm].toString(10)
                }));
            } else if (source === 'serial') {
                this.emit('event', new SWOConfigureEvent({
                    type: 'serial',
                    args: this.args,
                    device: this.args.swoConfig.swoPath,
                    baudRate: this.args.swoConfig.swoFrequency
                }));
            }
        }
    }

    private session: GDBDebugSession;
    private MI2Leftover: string = '';
    private rttStarted = false;
    private rttAutoStartDetected = false;
    private rttPollTimer: NodeJS.Timeout;
    public debuggerLaunchStarted(obj: GDBDebugSession): void {
        this.session = obj;
    }

    public debuggerLaunchCompleted(): void {
        const hasRtt = this.rttHelper.emitConfigures(this.args.rttConfig, this);
        if (this.args.ctiOpenOCDConfig?.enabled) {
            this.ctiStopResume(CTIAction.init);
        }
        if (hasRtt) {
            this.startRttMonitor();
        }
    }

    // This should not be called until the server is ready and accepting connections. Proper time to call is to have
    // established an RTT TCP port already
    private readonly rttSearchStr = 'Control block found at';
    public rttPoll(): void {
        OpenOCDLog('RTT Poll requested');
        if (!this.rttStarted && (this.tclSocket === undefined) && (this.args.rttConfig.rtt_start_retry > 0) && !this.rttAutoStartDetected) {
            OpenOCDLog(`RTT Poll starting. Searching for string '${this.rttSearchStr}' in output`);
            this.rttPollStart();
        } else {
            OpenOCDLog('RTT Poll not needed');
        }
    }

    private startRttMonitor() {
        this.session.miDebugger.on('msg', (type, msg) => {
            if (this.rttStarted) { return; }
            msg = this.MI2Leftover + msg;
            const lines = msg.split(/[\r]\n/);
            if (!msg.endsWith('\n')) {
                this.MI2Leftover = lines.pop();
            } else {
                this.MI2Leftover = '';
            }
            for (const line of lines) {
                OpenOCDLog('OpenOCD Output: ' + line);
                if (line.includes(this.rttSearchStr)) {
                    OpenOCDLog('RTT control block found. Done');
                    this.rttStarted = true;
                    if (this.rttPollTimer) {
                        clearTimeout(this.rttPollTimer);
                        this.rttPollTimer = undefined;
                    }
                    break;
                } else if (/rtt:.*will retry/.test(line)) {
                    OpenOCDLog('This version of OpenOCD already know how to poll. Done');
                    this.rttAutoStartDetected = true;
                }
            }
        });

        this.session.miDebugger.on('stopped', async (info: any, reason: string) => {
            if (reason === 'entry') { return; } // Should not happen
            if (!this.rttStarted && this.tclSocket && !this.rttAutoStartDetected) {
                OpenOCDLog('Debugger paused: sending command "rtt start"');
                const result = await this.tclCommand('rtt start');
            }
        });
    }

    private tclSocket: net.Socket = undefined;      // If null, it was opened once but then later closed due to error or the other end closed it
    private tclSocketBuf = '';
    private readonly tclDelimit = String.fromCharCode(0x1a);
    private dbgPollCounter = 0;
    private rttPollStart() {
        this.rttPollTimer = setInterval(async () => {
            if ((this.session.miDebugger.status === 'running') && !this.rttAutoStartDetected) {
                try {
                    this.dbgPollCounter++;
                    OpenOCDLog('Sending command "rtt start"');
                    const result = await this.tclCommand('capture "rtt start"');
                    OpenOCDLog(`${this.dbgPollCounter}-OpenOCD TCL output: '${result}'`);
                }
                catch (e) {
                    OpenOCDLog(`OpenOCD TCL error: ${e}`);
                }
            }
        }, this.args.rttConfig.rtt_start_retry);
    }

    private tclCommandQueue: TclCommandQueue[] = [];
    private tclCommandId: number = 1;
    private tclCommand(cmd: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            this.tclStartSocket().then(() => {
                if (!cmd) {
                    resolve('');
                    return;
                }
                const newCmd: TclCommandQueue = {
                    cmd: cmd,
                    id: this.tclCommandId++,
                    resolve: resolve,
                    reject: reject
                };
                if (this.args.showDevDebugOutput) {
                    this.session.handleMsg('log', `openocd <- ${newCmd.id}-${cmd}\n`);
                }
                this.tclCommandQueue.push(newCmd);
                this.tclSendData(cmd);
            }, (e) => {
                reject(e);
                return null;
            });
        });
    }

    public tclStartSocket(): Promise<void> {
        if (this.tclSocket) {
            return Promise.resolve();
        }
        return new Promise<void>(async (resolve, reject) => {
            if (this.tclSocket === undefined) {
                const tclPortName = createPortName(0, 'tclPort');
                const tclPortNum = this.ports[tclPortName];
                const obj = {
                    host: '127.0.0.1',
                    port: tclPortNum
                };
                this.tclSocket = net.createConnection(obj, () => {
                    resolve();
                });
                this.tclSocket.on('data', this.tclRecvTclData.bind(this));
                this.tclSocket.on('end', () => {
                    this.tclSocket = null;
                });
                this.tclSocket.on('close', () => {
                    this.tclSocket = null;
                });
                this.tclSocket.on('error', (e) => {
                    if (this.tclSocket) {
                        this.tclSocket = null;
                        reject(e);
                    }
                });
            } else {
                reject(new Error('OpenOCD tcl socket already closed'));
            }
        });
    }

    private tclRecvTclData(buffer: Buffer) {
        const str = this.tclSocketBuf + buffer.toString('utf8');
        const packets = str.split(this.tclDelimit);
        if (!str.endsWith(this.tclDelimit)) {
            this.tclSocketBuf = packets.pop();
        } else {
            packets.pop();      // Remove trailing empty string
            this.tclSocketBuf = '';
        }
        if ((this.tclCommandQueue.length > 0) && (packets.length > 0)) {
            const next = this.tclCommandQueue.shift();
            next.result = packets.shift();
            if (this.args.showDevDebugOutput) {
                this.session.handleMsg('log', `openocd -> ${next.id}-'${next.result}'\n`);
            }
            next.resolve(next.result);
        }
        while (packets.length > 0) {
            const p = packets.shift().trim();
            if (this.args.showDevDebugOutput) {
                this.session.handleMsg('log', `openocd -> '${p}'\n`);
            }
        }
    }

    private tclSendData(data: string) {
        if (data) {
            this.tclSocket.write(data + this.tclDelimit, 'utf8');
        }
    }

    public ctiStopResume?(action: CTIAction): void {
        let commands = [];
        if (action === CTIAction.init) {
            this.tclCommand('tcl_notifications on');
            commands = this.args.ctiOpenOCDConfig?.enabled ? this.args.ctiOpenOCDConfig?.initCommands : [];
        } else if (action === CTIAction.pause) {
            commands = this.args.ctiOpenOCDConfig?.pauseCommands;
        } else {
            commands = this.args.ctiOpenOCDConfig?.resumeCommands;
        }
        for (const p of commands || []) {
            this.tclCommand(p);
        }
    }
}

interface TclCommandQueue {
    cmd: string;
    id: number;
    resolve: any;
    reject: any;
    result?: string;
    error?: any;
}
