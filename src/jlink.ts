import { DebugProtocol } from 'vscode-debugprotocol';
import { GDBServerController, ConfigurationArguments, calculatePortMask, SWOConfigureEvent } from './common';
import * as os from 'os';
import { EventEmitter } from 'events';

export class JLinkServerController extends EventEmitter implements GDBServerController {
    public portsNeeded: string[] = ['gdbPort', 'swoPort', 'consolePort'];
    public name: 'J-Link';

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
    
    public launchCommands(): string[] {
        const gdbport = this.ports['gdbPort'];

        const commands = [
            `interpreter-exec console "source ${this.args.extensionPath}/support/gdbsupport.init"`,
            `target-select extended-remote localhost:${gdbport}`,
            'interpreter-exec console "monitor halt"',
            'interpreter-exec console "monitor reset"',
            'target-download',
            'interpreter-exec console "monitor reset"',
            'enable-pretty-printing'
        ];

        if (this.args.swoConfig.enabled) {
            const swocommands = this.SWOConfigurationCommands();
            commands.push(...swocommands);
        }

        return commands;
    }

    public attachCommands(): string[] {
        const gdbport = this.ports['gdbPort'];

        const commands = [
            `interpreter-exec console "source ${this.args.extensionPath}/support/gdbsupport.init"`,
            `target-select extended-remote localhost:${gdbport}`,
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
            'exec-interrupt',
            'interpreter-exec console "monitor halt"',
            'interpreter-exec console "monitor reset"',
            'exec-step-instruction'
        ];

        if (this.args.swoConfig.enabled) {
            const swocommands = this.SWOConfigurationCommands();
            commands.push(...swocommands);
        }

        return commands;
    }

    private SWOConfigurationCommands(): string[] {
        const portMask = '0x' + calculatePortMask(this.args.swoConfig.decoders).toString(16);
        const swoFrequency = this.args.swoConfig.swoFrequency | 0;
        const cpuFrequency = this.args.swoConfig.cpuFrequency | 0;
        
        const commands: string[] = [
            `monitor SWO EnableTarget ${cpuFrequency} ${swoFrequency} ${portMask} 0`,
            'DisableITMPorts 0xFFFFFFFF',
            `EnableITMPorts ${portMask}`,
            'EnableDWTSync',
            'ITMSyncEnable'
        ];

        commands.push(this.args.swoConfig.profile ? 'EnablePCSample' : 'DisablePCSample');
        
        return commands.map((c) => `interpreter-exec console "${c}"`);
    }

    public serverExecutable() {
        if (this.args.serverpath) { return this.args.serverpath; }
        else {
            return os.platform() === 'win32' ? 'JLinkGDBServerCL.exe' : 'JLinkGDBServer';
        }
    }
    
    public serverArguments(): string[] {
        const gdbport = this.ports['gdbPort'];
        const swoport = this.ports['swoPort'];
        const consoleport = this.ports['consolePort'];

        const cmdargs = [
            '-if', this.args.jlinkInterface,
            '-port', gdbport.toString(),
            '-swoport', swoport.toString(),
            '-telnetport', consoleport.toString(),
            '-device', this.args.device
        ];

        if (this.args.serialNumber) {
            cmdargs.push('-select', `usb=${this.args.serialNumber}`);
        }
        else if (this.args.ipAddress) {
            cmdargs.push('-select', `ip=${this.args.ipAddress}`);
        }

        if (this.args.rtos) {
            cmdargs.push('-rtos', this.args.rtos);
        }

        return cmdargs;
    }

    public initMatch(): RegExp {
        return /Waiting for GDB connection\.\.\./g;
    }

    public serverLaunchStarted(): void {}
    public serverLaunchCompleted(): void {
        if (this.args.swoConfig.enabled) {
            if (this.args.swoConfig.source === 'probe') {
                this.emit('event', new SWOConfigureEvent({ type: 'socket', port: this.ports['swoPort'] }));
            }
            else {
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
