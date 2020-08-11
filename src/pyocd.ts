import { DebugProtocol } from 'vscode-debugprotocol';
import { ConfigurationArguments, GDBServerController, SWOConfigureEvent, calculatePortMask, createPortName } from './common';
import * as os from 'os';
import { EventEmitter } from 'events';

export class PyOCDServerController extends EventEmitter implements GDBServerController {
    public readonly name: string = 'PyOCD';
    public readonly portsNeeded: string[] = ['gdbPort', 'consolePort'];

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
            `target-select extended-remote localhost:${gdbport}`
        ];
    }

    public launchCommands(): string[] {
        const commands = [
            'interpreter-exec console "monitor halt"',
        ];

        if (this.args.targetDownload) {
            commands.push(
                'target-download',
                'interpreter-exec console "monitor reset"');
        }

        commands.push('enable-pretty-printing');
        return commands;
    }

    public attachCommands(): string[] {
        const gdbport = this.ports['gdbPort'];

        const commands = [
            'interpreter-exec console "monitor halt"',
            'enable-pretty-printing'
        ];
        return commands;
    }

    public restartCommands(): string[] {
        const commands: string[] = [
            'interpreter-exec console "monitor reset"'
        ];
        return commands;
    }

    public swoCommands(): string[] {
        const commands = [];
        if (this.args.swoConfig.enabled && this.args.swoConfig.source !== 'probe') {
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
        return this.args.serverpath ? this.args.serverpath : 'pyocd-gdbserver';
    }

    public serverArguments(): string[] {
        const gdbport = this.ports['gdbPort'];
        const telnetport = this.ports['consolePort'];

        let serverargs = [
            '--persist',        // Not sure we need this anymore
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
        if (this.args.swoConfig.enabled && this.args.swoConfig.source !== 'probe') {
            this.emit('event', new SWOConfigureEvent({
                type: 'serial',
                device: this.args.swoConfig.source,
                baudRate: this.args.swoConfig.swoFrequency
            }));
        }
    }
    
    public debuggerLaunchStarted(): void {}
    public debuggerLaunchCompleted(): void {}
}
