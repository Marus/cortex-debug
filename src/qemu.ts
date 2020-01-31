import { DebugProtocol } from 'vscode-debugprotocol';
import { GDBServerController, ConfigurationArguments, calculatePortMask, SWOConfigureEvent } from './common';
import * as os from 'os';
import { EventEmitter } from 'events';

const commandExistsSync = require('command-exists').sync;
const EXECUTABLE_NAMES = ['qemu-system-arm'];

export class QEMUServerController extends EventEmitter implements GDBServerController {
    public portsNeeded: string[] = ['gdbPort'];
    public name: 'QEMU';

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
            'enable-pretty-printing'
        ];

        return commands;
    }

    public attachCommands(): string[] {
        const commands = [
            'enable-pretty-printing'
        ];
        
        return commands;
    }

    public restartCommands(): string[] {
        const commands: string[] = [
            'interpreter-exec console "monitor stop"',
            'interpreter-exec console "monitor system_reset"'
        ];

        return commands;
    }

    public swoCommands(): string[] {
        return [];
    }

    public serverExecutable() {
        if (this.args.serverpath) { return this.args.serverpath; }
        else {
            for (const name in EXECUTABLE_NAMES) {
                if (commandExistsSync(name)) { return name; }
            }
            return 'qemu-system-arm';
        }
    }
    
    public serverArguments(): string[] {
        const gdbport = this.ports['gdbPort'];

        let cmdargs = [
            '-cpu', this.args.cpu,
            '-machine', this.args.machine,
            '-nographic',
            '-semihosting-config', 'enable=on,target=native',
            '-gdb', 'tcp::' + gdbport.toString(),
            '-S',
            '-kernel', this.args.executable
        ];

        if (this.args.serverArgs) {
            cmdargs = cmdargs.concat(this.args.serverArgs);
        }

        return cmdargs;
    }

    public initMatch(): RegExp {
        return null;
    }

    public serverLaunchStarted(): void {}
    public serverLaunchCompleted(): void {}
    public debuggerLaunchStarted(): void {}
    public debuggerLaunchCompleted(): void {}
}
