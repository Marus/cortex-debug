import { DebugProtocol } from 'vscode-debugprotocol';
import { GDBServerController, ConfigurationArguments, SWOConfigureEvent, RTTConfigureEvent, calculatePortMask, createPortName, getAnyFreePortSync as getAnyFreePort, RTTConfiguration } from './common';
import * as os from 'os';
import * as tmp from 'tmp';
import * as fs from 'fs';
import { EventEmitter } from 'events';
export class OpenOCDServerController extends EventEmitter implements GDBServerController {
    // We wont need all of these ports but reserve them anyways
    public portsNeeded = ['gdbPort', 'tclPort', 'telnetPort', 'swoPort' /*, 'rttPort' */];
    public name = 'OpenOCD';
    private args: ConfigurationArguments;
    private ports: { [name: string]: number };

    // Channel numbers previously used on the localhost
    public static rttLocalPortMap: { [channel: number]: number} = {};

    constructor() {
        super();
    }

    public setPorts(ports: { [name: string]: number }): void {
        this.ports = ports;
    }

    public setArguments(args: ConfigurationArguments): void {
        this.args = args;

        // We get/reserve the ports here because it is an async. operation and it wll be done
        // way before a server has even started
        OpenOCDServerController.GetRTTPorts(args.rttConfig);
    }

    public static GetRTTPorts(cfg: RTTConfiguration) {
        if (cfg && cfg.enabled) {
            for (const dec of cfg.decoders) {
                const preferred = OpenOCDServerController.rttLocalPortMap[dec.port] || -1;
                dec.tcpPort = '';
                getAnyFreePort(preferred).then((num) => {
                    OpenOCDServerController.rttLocalPortMap[dec.port] = num;
                    dec.tcpPort = num.toString();
                }).catch(() => {
                    console.log(`Could not get free tcp port for RTT channel ${dec.port}`);
                });
            }
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

    public launchCommands(): string[] {
        const commands = [
            'interpreter-exec console "monitor reset halt"',
            'target-download',
            'interpreter-exec console "monitor reset halt"',
            'enable-pretty-printing'
        ];
        return commands;
    }

    public attachCommands(): string[] {
        const commands = [
            'interpreter-exec console "monitor halt"',
            'enable-pretty-printing'
        ];
        return commands;
    }

    public restartCommands(): string[] {
        const commands: string[] = [
            'interpreter-exec console "monitor reset halt"'
        ];
        return commands;
    }

    public rttCommands(): string[] {
        const commands = [];
        if (this.args.rttConfig.enabled) {
            const cfg = this.args.rttConfig;
            if ((this.args.request === 'launch') && cfg.clearSearch) {
                // The RTT control block may contain a valid search string from a previous run
                // and RTT ends up outputting garbage. Or, the server could read garbage and
                // misconfigure itself. Following will clear the RTT header which
                // will cause the server to wait for the server to actually be initialized
                commands.push(`interpreter-exec console "monitor mwb ${cfg.address} 0 ${cfg.searchId.length}"`);
            }
            commands.push(`interpreter-exec console "monitor rtt setup ${cfg.address} ${cfg.searchSize} ${cfg.searchId}"`);
            commands.push(`interpreter-exec console "monitor rtt start"`);

            // It is perfectly acceptable to have no decoders but just have the RTT enabled
            // They can use JLinks utilities for RTT operations
            for (const dec of this.args.rttConfig.decoders) {
                if (dec.tcpPort) {
                    commands.push(`interpreter-exec console "monitor rtt server start ${dec.tcpPort} ${dec.port}"`);
                }
            }
        }
        return commands;
    }

    public swoCommands(): string[] {
        const commands = [];
        if (this.args.swoConfig.enabled) {
            const swocommands = this.SWOConfigurationCommands();
            commands.push(...swocommands);
        }
        return commands.concat(this.rttCommands());
    }

    private SWOConfigurationCommands(): string[] {
        const portMask = '0x' + calculatePortMask(this.args.swoConfig.decoders).toString(16);
        const swoFrequency = this.args.swoConfig.swoFrequency;
        const cpuFrequency = this.args.swoConfig.cpuFrequency;

        const ratio = Math.floor(cpuFrequency / swoFrequency) - 1;
        
        const commands: string[] = [
            'EnableITMAccess',
            `BaseSWOSetup ${ratio}`,
            'SetITMId 1',
            'ITMDWTTransferEnable',
            'DisableITMPorts 0xFFFFFFFF',
            `EnableITMPorts ${portMask}`,
            'EnableDWTSync',
            'ITMSyncEnable',
            'ITMGlobalEnable'
        ];

        commands.push(this.args.swoConfig.profile ? 'EnablePCSample' : 'DisablePCSample');
        
        return commands.map((c) => `interpreter-exec console "${c}"`);
    }

    public serverExecutable(): string {
        if (this.args.serverpath) { return this.args.serverpath; }
        else {
            return os.platform() === 'win32' ? 'openocd.exe' : 'openocd';
        }
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

        this.args.configFiles.forEach((cf, idx) => {
            serverargs.push('-f', cf);
        });

        if (this.args.rtos) {
            const tmpCfgPath = tmp.tmpNameSync();
            fs.writeFileSync(tmpCfgPath, `$_TARGETNAME configure -rtos ${this.args.rtos}\n`, 'utf8');
            serverargs.push('-f', tmpCfgPath);
        }

        if (this.args.serverArgs) {
            serverargs = serverargs.concat(this.args.serverArgs);
        }

        const commands = [];

        if (this.args.swoConfig.enabled) {
            let tpiuIntExt = undefined;
            const source = this.args.swoConfig.source;
            if ((source === 'probe') || (source === 'socket') || (source === 'file')) {
                const swoPortNm = createPortName(this.args.targetProcessor, 'swoPort');
                tpiuIntExt = `internal :${this.ports[swoPortNm]}`;
            } else if (source === 'serial') {
                tpiuIntExt = 'external';
            }

            if (tpiuIntExt) {
                // tslint:disable-next-line:max-line-length
                commands.push(`tpiu config ${tpiuIntExt} uart off ${this.args.swoConfig.cpuFrequency} ${this.args.swoConfig.swoFrequency}`);
            } else {
                this.args.swoConfig.enabled = false;
            }
        }

        if (commands.length > 0) {
            serverargs.push('-c', commands.join('; '));
        }

        for (const cmd of this.args.openOCDLaunchCommands || []) {
            serverargs.push('-c', cmd);
        }

        return serverargs;
    }

    public initMatch(): RegExp {
        /*
        // Following will work with or without the -d flag to openocd or using the tcl
        // command `debug_level 3`; and we are looking specifically for gdb port(s) opening up
        // When debug is enabled, you get too many matches looking for the cpu. This message
        // has been there atleast since 2016-12-19
        */
        return /Info\s:[^\n]*Listening on port \d+ for gdb connection/i;
    }

    public serverLaunchStarted(): void {
    }

    public serverLaunchCompleted(): void {
        if (this.args.swoConfig.enabled) {
            const source = this.args.swoConfig.source;
            if ((source === 'probe') || (source === 'socket') || (source === 'file')) {
                const swoPortNm = createPortName(this.args.targetProcessor, 'swoPort');
                this.emit('event', new SWOConfigureEvent({ type: 'socket', port: this.ports[swoPortNm].toString(10) }));
            } else if (source === 'serial') {
                this.emit('event', new SWOConfigureEvent({
                    type: 'serial',
                    device: this.args.swoConfig.source,
                    baudRate: this.args.swoConfig.swoFrequency
                }));
            }
        }

        if (this.args.rttConfig.enabled) {
            for (const dec of this.args.rttConfig.decoders) {
                if (dec.type === 'console') {
                    if (dec.tcpPort) {
                        this.emit('event', new RTTConfigureEvent({
                            type: 'socket',
                            decoder: dec
                        }));
                    } else {
                        console.error(`What the hell. No tcpport for RTT`);
                    }
                }
            }
        }
    }

    public debuggerLaunchStarted(): void {}
    public debuggerLaunchCompleted(): void {}
}
