import { DebugProtocol } from '@vscode/debugprotocol';
import { EventEmitter } from 'events';
import { calculatePortMask, createPortName, genDownloadCommands } from './common';
import { GDBServerController } from './gdb.interfaces';
import { SWOConfigureEvent } from '@common/events';
import { ConfigurationArguments } from '@common/types';

export class PyOCDServerController extends EventEmitter implements GDBServerController {
    public readonly name: string = 'PyOCD';
    public readonly portsNeeded: string[] = ['gdbPort', 'consolePort', 'swoPort'];

    private args: ConfigurationArguments;
    private ports: { [name: string]: number };

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
            `target-select extended-remote localhost:${gdbport}`,
            // Following needed for SWO and accessing some peripherals.
            // Generally not a good thing to do
            'interpreter-exec console "set mem inaccessible-by-default off"'
        ];
    }

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
            'interpreter-exec console "monitor reset"'
        ];
        return commands;
    }

    public swoAndRTTCommands(): string[] {
        const commands = [];
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
        const exeName = 'pyocd';
        const ret = this.args.serverpath ? this.args.serverpath : exeName;
        return ret;
    }
    public allocateRTTPorts(): Promise<void> {
        return Promise.resolve();
    }
    public serverArguments(): string[] {
        const gdbport = this.ports['gdbPort'];
        const telnetport = this.ports['consolePort'];

        let serverargs = [
            'gdbserver',
            '--port', gdbport.toString(),
            '--telnet-port', telnetport.toString()
        ];

        if (this.args.boardId) {
            serverargs.push('--board');
            serverargs.push(this.args.boardId);
        }

        if (this.args.targetId) {
            serverargs.push('--target');
            serverargs.push(this.args.targetId.toString());
        }

        if (this.args.cmsisPack) {
            serverargs.push('--pack');
            serverargs.push(this.args.cmsisPack.toString());
        }

        if (this.args.swoConfig.enabled) {
            const source = this.args.swoConfig.source;
            if ((source === 'probe') || (source === 'socket') || (source === 'file')) {
                const swoPort = this.ports[createPortName(this.args.targetProcessor, 'swoPort')];
                const cpuF = this.args.swoConfig.cpuFrequency;
                const swoF = this.args.swoConfig.swoFrequency || '1';
                const args = [
                    '-O', 'enable_swv=1',
                    '-O', 'swv_raw_enable=true',
                    '-O', `swv_raw_port=${swoPort}`,
                    '-O', `swv_system_clock=${cpuF}`,
                    '-O', `swv_clock=${swoF}`];
                serverargs.push(...args);
            }
        }

        if (this.args.serverArgs) {
            serverargs = serverargs.concat(this.args.serverArgs);
        }
        return serverargs;
    }

    public initMatch(): RegExp {
        return /GDB server started (at|on) port/;
    }

    public serverLaunchStarted(): void {}
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
                    device: this.args.swoConfig.source,
                    baudRate: this.args.swoConfig.swoFrequency
                }));
            }
        }
    }
    
    public debuggerLaunchStarted(): void {}
    public debuggerLaunchCompleted(): void {}
}
