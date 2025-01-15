import { DebugProtocol } from '@vscode/debugprotocol';
import * as os from 'os';
import * as tmp from 'tmp';
import { EventEmitter } from 'events';
import * as ChildProcess from 'child_process';
import { genDownloadCommands } from './common';
import { GDBServerController } from './gdb.interfaces';
import { ConfigurationArguments } from '@common/types';
import { SWOConfigureEvent } from '@common/events';

export class ExternalServerController extends EventEmitter implements GDBServerController {
    public readonly name: string = 'External';
    public readonly portsNeeded: string[] = [];
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
        if (this.args.swoConfig.enabled) {
            if (os.platform() === 'win32') {
                this.swoPath = this.swoPath.replace(/\\/g, '/');
            }
        }
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

    public swoAndRTTCommands(): string[] {
        return [];
    }

    public resetCommands(): string[] {
        const commands: string[] = [
            'interpreter-exec console "monitor reset halt"'
        ];

        return commands;
    }

    public serverExecutable(): string {
        return null;
    }

    public allocateRTTPorts(): Promise<void> {
        return Promise.resolve();
    }
        
    public serverArguments(): string[] {
        return [];
    }

    public initMatch(): RegExp {
        return null;
    }

    public serverLaunchStarted(): void {
        if (this.args.swoConfig.enabled && this.args.swoConfig.source === 'probe' && os.platform() !== 'win32') {
            const mkfifoReturn = ChildProcess.spawnSync('mkfifo', [this.swoPath]);
            this.emit('event', new SWOConfigureEvent({
                type: 'fifo',
                args: this.args,
                path: this.swoPath
            }));
        }
    }

    public serverLaunchCompleted(): void {
        if (this.args.swoConfig.enabled) {
            if (this.args.swoConfig.source === 'probe' && os.platform() === 'win32') {
                this.emit('event', new SWOConfigureEvent({
                    type: 'file',
                    args: this.args,
                    path: this.swoPath
                }));
            }
            else if (this.args.swoConfig.source === 'socket') {
                this.emit('event', new SWOConfigureEvent({
                    type: 'socket',
                    args: this.args,
                    port: this.args.swoConfig.swoPort
                }));
            }
            else if (this.args.swoConfig.source === 'file') {
                this.emit('event', new SWOConfigureEvent({
                    type: 'file',
                    args: this.args,
                    path: this.args.swoConfig.swoPath
                }));
            }
            else if (this.args.swoConfig.source === 'serial') {
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
    public debuggerLaunchCompleted(): void {}
}
