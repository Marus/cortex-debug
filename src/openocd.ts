import { DebugProtocol } from 'vscode-debugprotocol';
import { GDBServerController, ConfigurationArguments, SWOConfigureEvent, calculatePortMask } from './common';
import * as os from 'os';
import * as tmp from 'tmp';
import * as fs from 'fs';
import * as ChildProcess from 'child_process';
import { EventEmitter } from 'events';

export class OpenOCDServerController extends EventEmitter implements GDBServerController {
    public portsNeeded = ['gdbPort'];
    public name = 'OpenOCD';
    private swoPath: string;
    private args: ConfigurationArguments;
    private ports: { [name: string]: number };

    constructor() {
        super();
        this.swoPath = tmp.tmpNameSync();
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
        const gdbport = this.ports['gdbPort'];

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

        if (this.args.swoConfig.enabled) {
            const swocommands = this.SWOConfigurationCommands();
            commands.push(...swocommands);
        }

        return commands;
    }

    public attachCommands(): string[] {
        const commands = [
            'interpreter-exec console "monitor halt"',
            'enable-pretty-printing'
        ];

        if (this.args.swoConfig.enabled) {
            const swocommands = this.SWOConfigurationCommands();
            commands.push(...swocommands);
        }

        return commands;
    }

    public restartCommands(): string[] {
        const commands: string[] = [
            'interpreter-exec console "monitor reset halt"'
        ];

        if (this.args.swoConfig.enabled) {
            const swocommands = this.SWOConfigurationCommands();
            commands.push(...swocommands);
        }

        return commands;
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
        const gdbport = this.ports['gdbPort'];

        const serverargs = [];

        this.args.searchDir.forEach((cs, idx) => {
            serverargs.push('-s', cs);
        });

        if (this.args.searchDir.length === 0) {
            serverargs.push('-s', this.args.cwd);
        }

        this.args.configFiles.forEach((cf, idx) => {
            serverargs.push('-f', cf);
        });

        if (this.args.rtos) {
            const tmpCfgPath = tmp.tmpNameSync();
            fs.writeFileSync(tmpCfgPath, `$_TARGETNAME configure -rtos ${this.args.rtos}\n`, 'utf8');
            serverargs.push('-f', tmpCfgPath);
        }

        const commands = [`gdb_port ${gdbport}`];

        if (this.args.swoConfig.enabled) {
            if (os.platform() == 'win32') {
                this.swoPath = this.swoPath.replace(/\\/g, '/');
            }
            // tslint:disable-next-line:max-line-length
            commands.push(`tpiu config internal ${this.swoPath} uart off ${this.args.swoConfig.cpuFrequency} ${this.args.swoConfig.swoFrequency}`);
        }

        serverargs.push('-c', commands.join('; '));

        return serverargs;
    }

    public initMatch(): RegExp {
        return /Info\s:\s([^\n\.]*)\.cpu([^\n]*)/i;
    }

    public serverLaunchStarted(): void {
        if (this.args.swoConfig.enabled && this.args.swoConfig.source === 'probe' && os.platform() !== 'win32') {
            const mkfifoReturn = ChildProcess.spawnSync('mkfifo', [this.swoPath]);
            this.emit('event', new SWOConfigureEvent({ type: 'fifo', path: this.swoPath }));
        }
    }

    public serverLaunchCompleted(): void {
        if (this.args.swoConfig.enabled) {
            if (this.args.swoConfig.source === 'probe' && os.platform() === 'win32') {
                this.emit('event', new SWOConfigureEvent({ type: 'file', path: this.swoPath }));
            }
            else if (this.args.swoConfig.source !== 'probe') {
                this.emit('event', new SWOConfigureEvent({
                    type: 'serial',
                    device: this.args.swoConfig.source,
                    baudRate: this.args.swoConfig.swoFrequency
                }));
            }
        }
    }

    public debuggerLaunchStarted(): void {}
    public debuggerLaunchCompleted(): void {}
}
