import { DebugProtocol } from '@vscode/debugprotocol';
import {
    GDBServerController, ConfigurationArguments, SWOConfigureEvent,
    calculatePortMask, createPortName, RTTServerHelper, genDownloadCommands
} from './common';
import * as os from 'os';
import * as tmp from 'tmp';
import * as fs from 'fs';
import { EventEmitter } from 'events';
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
    // OpenOCD provides a hack to synchronze gdb and itself by issuing 'monitor gdb_sync' followed
    // by a 'stepi' which doesn't really do a stepi but can emulate a break due to a step that
    // gdb expects
    public launchCommands(): string[] {
        const commands = [
            ...genDownloadCommands(this.args, ['interpreter-exec console "monitor reset halt"']),
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
        if (this.args.rttConfig.enabled && !this.args.pvtRestartOrReset) {
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

        if (!this.args.pvtRestartOrReset) {
            const portMask = '0x' + calculatePortMask(this.args.swoConfig.decoders).toString(16);
            const swoFrequency = this.args.swoConfig.swoFrequency;
            const cpuFrequency = this.args.swoConfig.cpuFrequency;
            const source = this.args.swoConfig.source;
            const swoOutput = (source === 'serial') ? 'external' : ':' +
                this.ports[createPortName(this.args.targetProcessor, 'swoPort')];
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

    public debuggerLaunchStarted(): void {}
    public debuggerLaunchCompleted(): void {
        this.rttHelper.emitConfigures(this.args.rttConfig, this);
    }
}
