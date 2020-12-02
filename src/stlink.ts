import { DebugProtocol } from 'vscode-debugprotocol';
import { GDBServerController, ConfigurationArguments, SWOConfigureEvent, calculatePortMask, createPortName } from './common';
import * as os from 'os';
import { EventEmitter } from 'events';

export class STLinkServerController extends EventEmitter implements GDBServerController {
    public readonly name: string = 'ST-LINK';
    public readonly portsNeeded: string[] = ['gdbPort'];

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

    public restartCommands(): string[] {
        const commands: string[] = [
            'interpreter-exec console "monitor reset halt"'
        ];
        return commands;
    }

    public swoCommands(): string[] {
        const commands = [];
        // if (this.args.swoConfig.enabled && this.args.swoConfig.source !== 'probe') {
        //     const swocommands = this.SWOConfigurationCommands();
        //     commands.push(...swocommands);
        // }
        return commands;
    }

    // private SWOConfigurationCommands(): string[] {
    //     const portMask = '0x' + calculatePortMask(this.args.swoConfig.decoders).toString(16);
    //     const swoFrequency = this.args.swoConfig.swoFrequency;
    //     const cpuFrequency = this.args.swoConfig.cpuFrequency;

    //     const ratio = Math.floor(cpuFrequency / swoFrequency) - 1;
        
    //     const commands: string[] = [
    //         'EnableITMAccess',
    //         `BaseSWOSetup ${ratio}`,
    //         'SetITMId 1',
    //         'ITMDWTTransferEnable',
    //         'DisableITMPorts 0xFFFFFFFF',
    //         `EnableITMPorts ${portMask}`,
    //         'EnableDWTSync',
    //         'ITMSyncEnable',
    //         'ITMGlobalEnable'
    //     ];

    //     commands.push(this.args.swoConfig.profile ? 'EnablePCSample' : 'DisablePCSample');
        
    //     return commands.map((c) => `interpreter-exec console "${c}"`);
    // }

    public serverExecutable(): string {
        if (this.args.serverpath) { return this.args.serverpath; }
        else { return os.platform() === 'win32' ? 'ST-LINK_gdbserver.exe' : 'ST-LINK_gdbserver'; }
    }

    public serverArguments(): string[] {
        const gdbport = this.ports['gdbPort'];

        let serverargs = ['-p', gdbport.toString()];

        // The -cp parameter is mandatory and STM32CubeProgrammer must be installed
        let stm32cubeprogrammer;
        if (this.args.stm32cubeprogrammer) {
            stm32cubeprogrammer = this.args.stm32cubeprogrammer;
        } else {
            if (os.platform() === 'win32') {
                stm32cubeprogrammer = process.env.ProgramFiles + '\\STMicroelectronics\\STM32Cube\\STM32CubeProgrammer\\bin';
            } else {
                stm32cubeprogrammer = '/usr/local/STMicroelectronics/STM32Cube/STM32CubeProgrammer/bin';
            }
        }
        serverargs.push('-cp', stm32cubeprogrammer);

        if (this.args.interface !== 'jtag') {
            serverargs.push('--swd');
        }

        if (this.args.serialNumber) {
            serverargs.push('--serial-number', this.args.serialNumber);
        }
        
        if (this.args.serverArgs) {
            serverargs = serverargs.concat(this.args.serverArgs);
        }

        return serverargs;
    }

    public initMatch(): RegExp {
        return /Listening at \*/g;
    }

    public serverLaunchStarted(): void {}
    public serverLaunchCompleted(): void {
        // if (this.args.swoConfig.enabled && this.args.swoConfig.source !== 'probe') {
        //     this.emit('event', new SWOConfigureEvent({
        //         type: 'serial',
        //         device: this.args.swoConfig.source,
        //         baudRate: this.args.swoConfig.swoFrequency
        //     }));
        // }
    }
    
    public debuggerLaunchStarted(): void {}
    public debuggerLaunchCompleted(): void {}
}
