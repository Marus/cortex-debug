import { DebugProtocol } from 'vscode-debugprotocol';
import { GDBServerController, ConfigurationArguments, SWOConfigureEvent, calculatePortMask, createPortName } from './common';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';


// Path of the top-level STM32CubeIDE installation directory, os-dependant
const ST_DIR = os.platform() === 'win32' ? 'c:\\ST' : '/opt/st';

const STMCUBEIDE_REGEX = /^STM32CubeIDE_(.+)$/;
// Example: c:\ST\STM32CubeIDE_1.5.0\
const GDB_REGEX = /com\.st\.stm32cube\.ide\.mcu\.externaltools\.stlink-gdb-server\.(.+)/;
// Example: c:\ST\STM32CubeIDE_1.5.0\STM32CubeIDE\plugins\com.st.stm32cube.ide.mcu.externaltools.stlink-gdb-server.win32_1.5.0.202011040924\
const PROG_REGEX = /com\.st\.stm32cube\.ide\.mcu\.externaltools\.cubeprogrammer\.(.+)/;
// Example: c:\ST\STM32CubeIDE_1.5.0\STM32CubeIDE\plugins\com.st.stm32cube.ide.mcu.externaltools.cubeprogrammer.win32_1.5.0.202011040924\
const GCC_REGEX = /com\.st\.stm32cube\.ide\.mcu\.externaltools\.gnu-tools-for-stm32\.(.+)/;
// Example: c:\ST\STM32CubeIDE_1.5.0\STM32CubeIDE\plugins\com.st.stm32cube.ide.mcu.externaltools.gnu-tools-for-stm32.7-2018-q2-update.win32_1.5.0.202011040924\


/**
 * Resolves the path location of a STM32CubeIDE plugin irrespective of version number.
 * Works for most recent version STM32CubeIDE_1.4.0 and STM32CubeIDE_1.5.0.
 */
function resolveCubePath(dirSegments, regex, suffix, executable = '')
{
    let dir = path.join(...dirSegments);
    let resolvedDir;
    try {
        for (let subDir of fs.readdirSync(dir, { withFileTypes: true }).sort()) {
            if (!subDir.isDirectory())
                continue;
            let match = subDir.name.match(regex);
            if (match) {
                let fullPath = path.join(dir, match[0], suffix, executable);
                if (fs.existsSync(fullPath)) {
                    resolvedDir = fullPath;
                }
            }
        }
    }
    catch(error) {
        // Ignore
    }
    return resolvedDir ? resolvedDir : executable;
}


export class STLinkServerController extends EventEmitter implements GDBServerController {
    public readonly name: string = 'ST-LINK';
    public readonly portsNeeded: string[] = ['gdbPort'];

    private args: ConfigurationArguments;
    private ports: { [name: string]: number };
    private static readonly stmCubeIdeDir: string = resolveCubePath([ST_DIR], STMCUBEIDE_REGEX, 'STM32CubeIDE');


    public static getArmToolchainPath(): string {
        // Try to resolve gcc location
        return resolveCubePath([this.stmCubeIdeDir, 'plugins'], GCC_REGEX, 'tools/bin'); 
    }

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
        else { return resolveCubePath([STLinkServerController.stmCubeIdeDir, 'plugins'], GDB_REGEX, 'tools/bin', os.platform() === 'win32' ? 'ST-LINK_gdbserver.exe' : 'ST-LINK_gdbserver') }
    }

    public serverArguments(): string[] {
        const gdbport = this.ports['gdbPort'];

        let serverargs = ['-p', gdbport.toString()];

        // The -cp parameter is mandatory and either STM32CubeProgrammer or STM32CubeProgrammer must be installed
        if (this.args.stm32cubeprogrammer) {
            serverargs.push('-cp', this.args.stm32cubeprogrammer);
        } else {
            let stm32cubeprogrammer = resolveCubePath([STLinkServerController.stmCubeIdeDir, 'plugins'], PROG_REGEX, 'tools/bin');
            // Fallback to standalone programmer if no STMCube32IDE is installed:
            if (!stm32cubeprogrammer) {
                if (os.platform() === 'win32') {
                    stm32cubeprogrammer = process.env.ProgramFiles + '\\STMicroelectronics\\STM32Cube\\STM32CubeProgrammer\\bin';
                } else {
                    stm32cubeprogrammer = '/usr/local/STMicroelectronics/STM32Cube/STM32CubeProgrammer/bin';
                }
            }
            serverargs.push('-cp', stm32cubeprogrammer);
        }

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
