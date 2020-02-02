import { DebugProtocol } from 'vscode-debugprotocol';
import { GDBServerController, ConfigurationArguments, calculatePortMask, SWOConfigureEvent } from './common';
import * as os from 'os';
import { EventEmitter } from 'events';

const commandExistsSync = require('command-exists').sync;
const EXECUTABLE_NAMES = ['JLinkGDBServerCLExe', 'JLinkGDBServerCL', 'JLinkGDBServer'];

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
    
    public initCommands(): string[] {
        const gdbport = this.ports['gdbPort'];

        return [
            `target-select extended-remote localhost:${gdbport}`
        ];
    }

    public launchCommands(): string[] {
        const commands = [
            'interpreter-exec console "monitor halt"',
            'interpreter-exec console "monitor reset"',
            'target-download',
            'interpreter-exec console "monitor reset"',
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
            'interpreter-exec console "monitor halt"',
            'interpreter-exec console "monitor reset"'
        ];
        return commands;
    }

    public swoCommands(): string[] {
        const commands = [];
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
            if (os.platform() === 'win32') {
                return 'JLinkGDBServerCL.exe';
            }
            else {
                for (const name in EXECUTABLE_NAMES) {
                    if (commandExistsSync(name)) { return name; }
                }
                return 'JLinkGDBServer';
            }
        }
    }
    
    public serverArguments(): string[] {
        const gdbport = this.ports['gdbPort'];
        const swoport = this.ports['swoPort'];
        const consoleport = this.ports['consolePort'];

        let cmdargs = [
            '-if', this.args.interface,
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

        if (this.args.jlinkscript) {
            cmdargs.push('-jlinkscriptfile', this.args.jlinkscript);
        }

        if (this.args.serverArgs) {
            cmdargs = cmdargs.concat(this.args.serverArgs);
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
