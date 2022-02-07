import { DebugProtocol } from '@vscode/debugprotocol';
import { GDBServerController, ConfigurationArguments, SWOConfigureEvent, calculatePortMask, createPortName, genDownloadCommands } from './common';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';

function get_ST_DIR() {
    switch (os.platform()) {
        case 'win32':
            return 'C:\\ST';
        case 'darwin':
            return '/Applications/STM32CubeIDE.app/Contents/Eclipse';
        default:
            const dirName = (process.env.HOME || os.homedir()) + '/st';
            return fs.existsSync(dirName) ? dirName : '/opt/st';
    }
}

// Path of the top-level STM32CubeIDE installation directory, os-dependant
const ST_DIR = get_ST_DIR();
const SERVER_EXECUTABLE_NAME = os.platform() === 'win32' ? 'ST-LINK_gdbserver.exe' : 'ST-LINK_gdbserver';

const STMCUBEIDE_REGEX = /^STM32CubeIDE_(.+)$/i;
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
function resolveCubePath(dirSegments: string[], regex: RegExp, suffix: string, executable = '')
{
    const dir = path.join(...dirSegments);
    let resolvedDir: string;
    try {
        for (const subDir of fs.readdirSync(dir).sort()) {
            const fullPath = path.join(dir, subDir);
            const stats = fs.statSync(fullPath);
            if (!stats.isDirectory()) {
                continue;
            }
            
            const match = subDir.match(regex);
            if (match) {
                const fullPath = path.join(dir, match[0], suffix, executable);
                if (fs.existsSync(fullPath)) {
                    if (!resolvedDir || (resolvedDir.localeCompare(fullPath, undefined, {sensitivity: 'base', numeric: true})) < 0) {
                        resolvedDir = fullPath;     // Many times, multiple versions exist. Take latest. Hopefully!!
                    }
                }
            }
        }
    }
    catch (error) {
        // Ignore
    }
    return resolvedDir ? resolvedDir : executable;
}

export class STLinkServerController extends EventEmitter implements GDBServerController {
    public readonly name: string = 'ST-LINK';
    public readonly portsNeeded: string[] = ['gdbPort'];

    private args: ConfigurationArguments;
    private ports: { [name: string]: number };
    
    public static getSTMCubeIdeDir(): string {
        switch (os.platform()) {
        case 'darwin':
            return ST_DIR;
        case 'linux':
            return resolveCubePath([ST_DIR], STMCUBEIDE_REGEX, '');
        default:
            return resolveCubePath([ST_DIR], STMCUBEIDE_REGEX, 'STM32CubeIDE');
        }
    }

    public static getArmToolchainPath(): string {
        // Try to resolve gcc location
        return resolveCubePath([this.getSTMCubeIdeDir(), 'plugins'], GCC_REGEX, 'tools/bin');
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
            'interpreter-exec console "monitor halt"',
            ...genDownloadCommands(this.args, ['interpreter-exec console "monitor reset"']),
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
            'interpreter-exec console "monitor reset"'
        ];
        return commands;
    }

    public swoAndRTTCommands(): string[] {
        return [];
    }

    public serverExecutable(): string {
        if (this.args.serverpath) {
            return this.args.serverpath;
        } else {
            return resolveCubePath([STLinkServerController.getSTMCubeIdeDir(), 'plugins'], GDB_REGEX, 'tools/bin', SERVER_EXECUTABLE_NAME);
        }
    }

    public serverArguments(): string[] {
        const gdbport = this.ports['gdbPort'];

        let serverargs = ['-p', gdbport.toString()];

        // The -cp parameter is mandatory and either STM32CubeIDE or STM32CubeProgrammer must be installed
        let stm32cubeprogrammer = this.args.stm32cubeprogrammer;
        if (stm32cubeprogrammer) {
            serverargs.push('-cp', stm32cubeprogrammer);
        } else {
            stm32cubeprogrammer = resolveCubePath([STLinkServerController.getSTMCubeIdeDir(), 'plugins'], PROG_REGEX, 'tools/bin');
            // Fallback to standalone programmer if no STMCube32IDE is installed:
            if (!stm32cubeprogrammer) {
                if (os.platform() === 'win32') {
                    stm32cubeprogrammer = process.env.ProgramFiles + '\\STMicroelectronics\\STM32Cube\\STM32CubeProgrammer\\bin';
                } else if (os.platform() === 'darwin') {
                    stm32cubeprogrammer = '/Applications/STMicroelectronics/STM32Cube/STM32CubeProgrammer/STM32CubeProgrammer.app/Contents/MacOs/bin';
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
        } else {
            // User may want to not use our default behavior but no other way to control it
            // If they continue to want the halting behaviour, it has to be speicifed by 'serverArgs'
            serverargs.push('--halt');
        }

        return serverargs;
    }

    public initMatch(): RegExp {
        return /(Waiting for debugger connection|Listening at).*/ig;
    }

    public serverLaunchStarted(): void {}
    public serverLaunchCompleted(): void {}
    
    public debuggerLaunchStarted(): void {}
    public debuggerLaunchCompleted(): void {}
}
