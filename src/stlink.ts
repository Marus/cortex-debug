import { DebugProtocol } from 'vscode-debugprotocol';
import { GDBServerController, ConfigurationArguments, SWOConfigureEvent, calculatePortMask, createPortName } from './common';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';

// Path of the top-level STM32CubeIDE installation directory, os-dependant
const ST_DIR = (
    os.platform() === 'win32' ? 'c:\\ST' :
        os.platform() === 'darwin' ? '/Applications/STM32CubeIDE.app/Contents/Eclipse' : '/opt/st'
    );

const SERVER_EXECUTABLE_NAME = (
    os.platform() === 'win32' ? 'ST-LINK_gdbserver.exe' : 'ST-LINK_gdbserver'
);

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
    const dir = path.join(...dirSegments);
    let resolvedDir;
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
                    resolvedDir = fullPath;
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
        if (os.platform() === 'darwin') {
            return ST_DIR;
        } else {
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
        return [];
    }
    public serverExecutable(): string {
        if (this.args.serverpath) { return this.args.serverpath; }
        else { return resolveCubePath([STLinkServerController.getSTMCubeIdeDir(), 'plugins'], GDB_REGEX, 'tools/bin', SERVER_EXECUTABLE_NAME); }
    }

    public serverArguments(): string[] {
        const gdbport = this.ports['gdbPort'];

        let serverargs = ['-p', gdbport.toString()];

        // The -cp parameter is mandatory and either STM32CubeProgrammer or STM32CubeProgrammer must be installed
        if (this.args.stm32cubeprogrammer) {
            serverargs.push('-cp', this.args.stm32cubeprogrammer);
        } else {
            let stm32cubeprogrammer = resolveCubePath([STLinkServerController.getSTMCubeIdeDir(), 'plugins'], PROG_REGEX, 'tools/bin');
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
        }

        return serverargs;
    }

    public initMatch(): RegExp {
        return /Listening at \*/g;
    }

    public serverLaunchStarted(): void {}
    public serverLaunchCompleted(): void {
    }
    
    public debuggerLaunchStarted(): void {}
    public debuggerLaunchCompleted(): void {}
}
