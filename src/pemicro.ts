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

    public preserveRanges(): string[] {
        const allowedRanges = ['preserve0', 'preserve1', 'preserve2'];
        const ranges = this.args.pemicro.preserve_ranges;
        const preserveRangesCmds = [];
        for (const range of allowedRanges)
        {
            try {
                const tmp = `interpreter-exec console "monitor ${range} ${ranges[range].enable ? 1 : 0} ${ranges[range].start} ${ranges[range].stop}"`;
                preserveRangesCmds.push(tmp);
            }
            catch (err) {
                // nop
            }
        }
        return preserveRangesCmds;
    }

    public setExceptionCatching(): string {
        const exceptionBitOffsets = {
            hardfault: 10,
            exception_entry_or_return: 9,
            busfault: 8,
            state_info_error: 7,
            checking_error: 6,
            no_coprocessor: 5,
            memmanage: 4,
            reset_vector: 0
        };
        const conf = this.args.pemicro.exception_catching;
        let enableBits = 0;
        for (const exception of Object.keys(exceptionBitOffsets))
        {
            try{
                enableBits |= conf[exception] ?  1 << exceptionBitOffsets[exception] : 0;
            }
            catch (err)
            {
                // nop
            }
        }
        return `interpreter-exec console "monitor setexceptioncatching ${enableBits}"`;
    }

    public launchCommands(): string[] {
        const extraLaunchCmds = [];

        extraLaunchCmds.push(this.setExceptionCatching());
        extraLaunchCmds.push(...this.preserveRanges());

        const commands = [
            'interpreter-exec console "monitor _reset"',
            'interpreter-exec console "monitor startmultiload"',
            ...genDownloadCommands(this.args, extraLaunchCmds),
            'interpreter-exec console "monitor endmultiload"',
            'interpreter-exec console "monitor _reset"'
        ];

        return commands;
    }

    public attachCommands(): string[] {
        const commands = [
            'interpreter-exec console "monitor halt"'
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
        // No commands needed for SWO. All are sent on the streaming port
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

    public allocateRTTPorts(): Promise<void> {
        return Promise.resolve();
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

        if (this.args.swoConfig.enabled) {
            const source = this.args.swoConfig.source;
            if (source === 'socket') {
                const swoPort = this.ports[createPortName(this.args.targetProcessor, 'swoPort')];
                serverargs.push(`-streamingport=${swoPort}`);
            }
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
    public debuggerLaunchCompleted(): void {
        if (this.args.swoConfig.enabled) {
            const source = this.args.swoConfig.source;
            if (source === 'socket') {
                const swoPortNm = createPortName(this.args.targetProcessor, 'swoPort');
                this.emit('event', new SWOConfigureEvent({
                    type: 'socket',
                    args: this.args,
                    port: this.ports[swoPortNm].toString(10)
                }));
            }
        }
    }
}
