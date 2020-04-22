import { DebugProtocol } from 'vscode-debugprotocol';
import { ConfigurationArguments, GDBServerController, SWOConfigureEvent, calculatePortMask } from './common';
import * as os from 'os';
import { EventEmitter } from 'events';

export class ExternalServerController extends EventEmitter implements GDBServerController {
    public readonly name: string = 'External';
    public readonly portsNeeded: string[] = [];

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
        const target = this.args.gdbTarget;
        return [
            `target-select extended-remote ${target}`
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

    public swoCommands(): string[] {
        return [];
    }

    public restartCommands(): string[] {
        const commands: string[] = [
            'interpreter-exec console "monitor reset halt"'
        ];

        return commands;
    }

    public serverExecutable(): string {
        return null;
    }

    public serverArguments(): string[] {
        return [];
    }

    public initMatch(): RegExp {
        return null;
    }

    public serverLaunchStarted(): void {}
    public serverLaunchCompleted(): void {
        if (this.args.swoConfig.enabled) {
            if (this.args.swoConfig.source === 'probe' && os.platform() === 'win32') {
                this.emit('event', new SWOConfigureEvent({ type: 'file', path: this.swoPath }));
            }
            else if (this.args.swoConfig.source !== 'probe') {
                this.emit('event', new SWOConfigureEvent({
                    type: 'fifo',
                    path: this.args.swoConfig.swoPath
                }));
            }
        }
    }
    public debuggerLaunchStarted(): void {}
    public debuggerLaunchCompleted(): void {}
}
