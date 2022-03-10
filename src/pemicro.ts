import { DebugProtocol } from '@vscode/debugprotocol';
import { GDBServerController, ConfigurationArguments, createPortName, SWOConfigureEvent, genDownloadCommands } from './common';
import * as os from 'os';
import { EventEmitter } from 'events';

const commandExistsSync = require('command-exists').sync;

export class PEServerController extends EventEmitter implements GDBServerController {
    public portsNeeded: string[] = ['gdbPort', 'swoPort', 'consolePort'];
    public name: 'PE';

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
            ...genDownloadCommands(this.args, ['interpreter-exec console "monitor _reset"']),
            'interpreter-exec console "monitor _reset"',
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
            'interpreter-exec console "monitor _reset"'
        ];

        return commands;
    }

    public swoAndRTTCommands(): string[] {
        return [];
    }

    public serverExecutable() {
        
        console.log('Getting Exec');
        if (this.args.serverpath) { return this.args.serverpath; }
        else {
            if (os.platform() === 'win32') {
                return 'pegdbserver_console.exe';
            }
            else {
                return 'pegdbserver_console';
            }
        }
    }

    public serverArguments(): string[] {
        const gdbport = this.ports['gdbPort'];

        let serverargs = [];

        serverargs.push('-startserver');
        serverargs.push('-singlesession');
        serverargs.push(`-device=${this.args.device}`);
        serverargs.push(`-serverport=${gdbport}`);
        
        if (this.args.ipAddress) {
            serverargs.push(`-serverip=${this.args.ipAddress}`);
        }

        if (this.args.rtos) {
            serverargs.push(`-kernal=${this.args.rtos}`);
        }

        if (this.args.interface === 'jtag') {       // TODO: handle ctag in when this server supports it
            serverargs.push('-usejtag');
        }

        if (this.args.configFiles) {
            serverargs.push(`-configfile=${this.args.configFiles[0]}`);
        }

        if (this.args.serverArgs) {
            serverargs = serverargs.concat(this.args.serverArgs);
        }

        return serverargs;
    }

    public initMatch(): RegExp {
        return /All Servers Running/g;
    }

    public serverLaunchStarted(): void {}
    public serverLaunchCompleted(): void {}
    public debuggerLaunchStarted(): void {}
    public debuggerLaunchCompleted(): void {}
}
