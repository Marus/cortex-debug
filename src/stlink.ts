import { DebugProtocol } from '@vscode/debugprotocol';
import { GDBServerController, ConfigurationArguments, SWOConfigureEvent, calculatePortMask, createPortName, genDownloadCommands } from './common';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';

function get_CLT_INSTALL_DIR(): string {
    const STMCUBECLT_REGEX = /^STM32CubeCLT_(.+)$/i;
    let clt: string;
    switch (os.platform()) {
        case 'darwin':
            clt = '/opt/ST';
            break;
        case 'win32':
            clt = 'C:\\ST';
            break;
        default: {
            const dirName = (process.env.HOME || os.homedir()) + '/st';
            clt = fs.existsSync(dirName) ? dirName : '/opt/st';
        }
    }
    if (fs.existsSync(clt)) {
        const stats = fs.statSync(clt);
        if (stats.isDirectory()) {
            const ret = resolveCubePath([clt], STMCUBECLT_REGEX, '');
            return ret;
        }
    }
    return '';
}

function get_ST_DIR(): string {
    switch (os.platform()) {
        case 'win32':
            return 'C:\\ST';
        case 'darwin':
            return '/Applications/STM32CubeIDE.app/Contents/Eclipse';
        default: {
            const dirName = (process.env.HOME || os.homedir()) + '/st';
            return fs.existsSync(dirName) ? dirName : '/opt/st';
        }
    }
}

// Path of the top-level STM32CubeIDE installation directory, os-dependant
/*
const ST_DIR = get_ST_DIR();
const ST_CLT_ISTALL_DIR = get_CLT_INSTALL_DIR();
*/
const SERVER_EXECUTABLE_NAME = os.platform() === 'win32' ? 'ST-LINK_gdbserver.exe' : 'ST-LINK_gdbserver';

const STMCUBEIDE_REGEX = /^STM32CubeIDE_(.+)$/i;
// Example: c:\ST\STM32CubeIDE_1.5.0\
const GDB_SERVER_REGEX = /com\.st\.stm32cube\.ide\.mcu\.externaltools\.stlink-gdb-server\.(.+)/;
// Example: c:\ST\STM32CubeIDE_1.5.0\STM32CubeIDE\plugins\com.st.stm32cube.ide.mcu.externaltools.stlink-gdb-server.win32_1.5.0.202011040924\
const PROG_REGEX = /com\.st\.stm32cube\.ide\.mcu\.externaltools\.cubeprogrammer\.(.+)/;
// Example: c:\ST\STM32CubeIDE_1.5.0\STM32CubeIDE\plugins\com.st.stm32cube.ide.mcu.externaltools.cubeprogrammer.win32_1.5.0.202011040924\
const GCC_REGEX = /com\.st\.stm32cube\.ide\.mcu\.externaltools\.gnu-tools-for-stm32\.(.+)/;
// Example: c:\ST\STM32CubeIDE_1.5.0\STM32CubeIDE\plugins\com.st.stm32cube.ide.mcu.externaltools.gnu-tools-for-stm32.7-2018-q2-update.win32_1.5.0.202011040924\

/**
 * Resolves the path location of a STM32CubeIDE plugin irrespective of version number.
 * Works for most recent version STM32CubeIDE_1.4.0 and STM32CubeIDE_1.5.0.
 */
function resolveCubePath(dirSegments: string[], regex: RegExp, suffix: string, executable = '') {
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
                    if (!resolvedDir || (resolvedDir.localeCompare(fullPath, undefined, { sensitivity: 'base', numeric: true })) < 0) {
                        resolvedDir = fullPath;     // Many times, multiple versions exist. Take latest. Hopefully!!
                    }
                }
            }
        }
    } catch (error) {
        // Ignore
    }
    return resolvedDir ? resolvedDir : executable;
}

export class STLinkServerController extends EventEmitter implements GDBServerController {
    public readonly name: string = 'ST-LINK';
    // STLink uses 4 ports per core. Not sure what 3rd and 4th are for but reserve them anyways
    public readonly portsNeeded: string[] = ['gdbPort', 'swoPort', 'gap1', 'gap2'];
    public readonly ST_DIR = get_ST_DIR();
    public readonly ST_CLT_ISTALL_DIR = get_CLT_INSTALL_DIR();
    private args: ConfigurationArguments;
    private ports: { [name: string]: number };
    private targetProcessor: number = 0;

    public getSTMCubeIdeDir(): string {
        switch (os.platform()) {
            case 'darwin':
                return this.ST_DIR;
            case 'linux':
                return resolveCubePath([this.ST_DIR], STMCUBEIDE_REGEX, '');
            default:
                return resolveCubePath([this.ST_DIR], STMCUBEIDE_REGEX, 'STM32CubeIDE');
        }
    }

    public getArmToolchainPath(): string {
        // Try to resolve gcc location
        if (this.ST_CLT_ISTALL_DIR) {
            const p = path.join(this.ST_CLT_ISTALL_DIR, 'GNU-tools-for-STM32', 'bin');
            if (fs.existsSync(p)) {
                return p;
            }
        }
        return resolveCubePath([this.getSTMCubeIdeDir(), 'plugins'], GCC_REGEX, 'tools/bin');
    }

    constructor() {
        super();
    }

    public setPorts(ports: { [name: string]: number }): void {
        this.ports = ports;
    }

    public setArguments(args: ConfigurationArguments): void {
        // With STLink, there isn't a concept of debugging multiple processors with one instance of the server like openocd
        // It is more like JLink. But, we do have to pass on command line which processor we want to debug
        // While we do that, we pretend like there is only one processor.
        if (args.targetProcessor > 0) {
            this.targetProcessor = args.targetProcessor;
        }
        args.numberOfProcessors = 1;
        args.targetProcessor = 0;
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
            // 'interpreter-exec console "monitor halt"', // Not needed because of -halt, not supported in older versions, still not documented
            ...genDownloadCommands(this.args, ['interpreter-exec console "monitor reset"']),
            'interpreter-exec console "monitor reset"',
            'interpreter-exec console "monitor halt"'
        ];
        return commands;
    }

    public attachCommands(): string[] {
        const commands: string[] = [
            // 'interpreter-exec console "monitor halt"', // Not needed because of --attach
        ];
        return commands;
    }

    public resetCommands(): string[] {
        const commands: string[] = [
            'interpreter-exec console "monitor reset"'
        ];
        return commands;
    }

    public swoAndRTTCommands(): string[] {
        const commands: string[] = [];
        if (this.args.swoConfig.enabled) {
            const swocommands = this.SWOConfigurationCommands();
            commands.push(...swocommands);
        }
        return commands;
    }

    private SWOConfigurationCommands(): string[] {
        const { decoders, swoFrequency, cpuFrequency } = this.args.swoConfig;
        const portMask = '0x' + calculatePortMask(decoders).toString(16);
        const ratio = Math.floor(cpuFrequency / swoFrequency) - 1;

        const commands = [
            `set $cpuFreq = ${cpuFrequency}`,
            `set $swoFreq = ${swoFrequency}`,
            `set $swoPortMask = ${portMask}`,
            'SWO_Init'
        ];

        return commands.map((c) => `interpreter-exec console "${c}"`);
    }

    public serverExecutable(): string {
        if (this.args.serverpath) {
            return this.args.serverpath;
        } else {
            if (this.ST_CLT_ISTALL_DIR) {
                const p = path.join(this.ST_CLT_ISTALL_DIR, 'STLink-gdb-server', 'bin', SERVER_EXECUTABLE_NAME);
                if (fs.existsSync(p)) {
                    this.args.serverpath = p;
                    return p;
                }
            }
            return resolveCubePath([this.getSTMCubeIdeDir(), 'plugins'], GDB_SERVER_REGEX, 'tools/bin', SERVER_EXECUTABLE_NAME);
        }
    }

    public allocateRTTPorts(): Promise<void> {
        return Promise.resolve();
    }

    public serverArguments(): string[] {
        const gdbport = this.ports['gdbPort'];

        let serverargs = ['-p', gdbport.toString()];

        // The -cp parameter is mandatory and either STM32CubeIDE or STM32CubeProgrammer must be installed
        let stm32cubeprogrammer = this.args.stm32cubeprogrammer;
        if (stm32cubeprogrammer) {
            serverargs.push('-cp', stm32cubeprogrammer);
        } else {
            if (this.ST_CLT_ISTALL_DIR) {
                const p = path.join(this.ST_CLT_ISTALL_DIR, 'STM32CubeProgrammer', 'bin');
                if (fs.existsSync(p)) {
                    stm32cubeprogrammer = p;
                }
            }
            if (!stm32cubeprogrammer) {
                stm32cubeprogrammer = resolveCubePath([this.getSTMCubeIdeDir(), 'plugins'], PROG_REGEX, 'tools/bin');
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
            }
            serverargs.push('-cp', stm32cubeprogrammer);
        }

        if ((this.args.interface !== 'jtag') && (this.args.interface !== 'cjtag')) {       // TODO: handle ctag in when this server supports it
            serverargs.push('--swd');
        }

        if (this.args.swoConfig.enabled) {
            const swoport = this.ports['swoPort'];
            serverargs.push('--swo-port', swoport.toString());

            const { cpuFrequency, swoFrequency } = this.args.swoConfig;

            serverargs.push('--cpu-clock', cpuFrequency.toString());
            serverargs.push('--swo-clock-div', Math.floor(cpuFrequency / swoFrequency).toString());
        }

        if (this.args.serialNumber) {
            serverargs.push('--serial-number', this.args.serialNumber);
        }
        if (this.args.request === 'attach') {
            serverargs.push('--attach');
        }
        serverargs.push('--halt');      // Need this for reset to work as expected (perform a halt)
        if (this.targetProcessor > 0) {
            serverargs.push('-m', `this.targetProcessor`);
        }

        if (this.args.serverArgs) {
            serverargs = serverargs.concat(this.args.serverArgs);
        }

        return serverargs;
    }

    public initMatch(): RegExp {
        return /(Waiting for debugger connection|Listening at).*/ig;
    }

    public serverLaunchStarted(): void {}
    public serverLaunchCompleted(): void {
        if (this.args.swoConfig.enabled) {
            this.emit('event', new SWOConfigureEvent({
                type: 'socket',
                args: this.args,
                port: this.ports['swoPort'].toString()
            }));
        }
    }

    public debuggerLaunchStarted(): void {}
    public debuggerLaunchCompleted(): void {}
}
