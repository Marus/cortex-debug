import { DebugProtocol } from '@vscode/debugprotocol';
import { GDBServerController, ConfigurationArguments, calculatePortMask,
    createPortName, SWOConfigureEvent, parseHexOrDecInt, RTTServerHelper, genDownloadCommands } from './common';
import * as os from 'os';
import { EventEmitter } from 'events';

const commandExistsSync = require('command-exists').sync;
const EXECUTABLE_NAMES = ['JLinkGDBServerCLExe', 'JLinkGDBServerCL', 'JLinkGDBServer'];

export class JLinkServerController extends EventEmitter implements GDBServerController {
    public portsNeeded: string[] = ['gdbPort', 'swoPort', 'consolePort'];
    public name: 'J-Link';

    private args: ConfigurationArguments;
    private ports: { [name: string]: number };
    private rttHelper: RTTServerHelper = new RTTServerHelper();

    constructor() {
        super();
    }

    public setPorts(ports: { [name: string]: number }): void {
        this.ports = ports;
    }

    public readonly defaultRttPort = 19021;
    public setArguments(args: ConfigurationArguments): void {
        this.args = args;

        // JLink only support one TCP port and that too for channel 0 only. The config provider
        // makes sure that the rttConfig conforms.
        if (args.rttConfig && args.rttConfig.enabled && (!args.rttConfig.decoders || (args.rttConfig.decoders.length === 0))) {
            // We do the RTT setup and pass the right args to JLink but not actually use the TCP Port ourselves. Decided
            // Not to allocate a free port in this case either.

            // getAnyFreePort(this.defaultRttPort).then((p) => {
            //     this.defaultRttPort = p;
            // });
        } else {
            this.rttHelper.allocateRTTPorts(args.rttConfig, this.defaultRttPort);
        }
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
            'interpreter-exec console "monitor halt"',
            'interpreter-exec console "monitor reset"'
        ];
        return commands;
    }

    public rttCommands(): string[] {
        const commands = [];
        if (this.args.rttConfig.enabled && !this.args.pvtRestartOrReset) {
            const cfg = this.args.rttConfig;
            if (this.rttHelper.rttPortsPending > 0) {
                // If we are getting here, we will need some serious re-factoring
                throw new Error('Asynchronous timing error. Could not allocate all the ports needed in time');
            }
            if ((this.args.request === 'launch') && cfg.clearSearch) {
                // The RTT control block may contain a valid search string from a previous run
                // and RTT ends up outputting garbage. Or, the server could read garbage and
                // misconfigure itself. Following will clear the RTT header which
                // will cause the server to wait for the server to actually be initialized
                let addr = parseHexOrDecInt(cfg.address);
                for (let bytes = 0; bytes < cfg.searchId.length; bytes += 4) {
                    commands.push(`interpreter-exec console "monitor exec memU32 0x${addr.toString(16)} = 0"`);
                    addr += 4;
                }
            }
            commands.push(`interpreter-exec console "monitor exec SetRTTAddr ${cfg.address}"`);
        }
        return commands;
    }

    public swoAndRTTCommands(): string[] {
        const commands = [];
        if (this.args.swoConfig.enabled) {
            const swocommands = this.SWOConfigurationCommands();
            commands.push(...swocommands);
        }
        return commands.concat(this.rttCommands());
    }

    private SWOConfigurationCommands(): string[] {
        const portMask = '0x' + calculatePortMask(this.args.swoConfig.decoders).toString(16);
        const swoFrequency = this.args.swoConfig.swoFrequency | 0;
        const cpuFrequency = this.args.swoConfig.cpuFrequency | 0;
        
        const commands: string[] = [
            `monitor SWO EnableTarget ${cpuFrequency} ${swoFrequency} ${portMask} 0`,
            'DisableITMPorts 0xFFFFFFFF',
            `EnableITMPorts ${portMask}`,
            'EnableDWTSync',
            'ITMSyncEnable'
        ];

        commands.push(this.args.swoConfig.profile ? 'EnablePCSample' : 'DisablePCSample');
        
        return commands.map((c) => `interpreter-exec console "${c}"`);
    }

    public serverExecutable() {
        if (this.args.serverpath) { return this.args.serverpath; }
        else {
            if (os.platform() === 'win32') {
                return 'JLinkGDBServerCL.exe';
            }
            else {
                for (const name in EXECUTABLE_NAMES) {
                    if (commandExistsSync(name)) { return name; }
                }
                return 'JLinkGDBServer';
            }
        }
    }
    
    public serverArguments(): string[] {
        const gdbport = this.ports['gdbPort'];
        const swoport = this.ports['swoPort'];
        const consoleport = this.ports['consolePort'];

        let cmdargs = [
            '-singlerun',   // -strict -timeout 0 
            '-nogui',       // removed at users request 
            '-if', this.args.interface,
            '-port', gdbport.toString(),
            '-swoport', swoport.toString(),
            '-telnetport', consoleport.toString(),
            '-device', this.args.device
        ];

        if (this.args.rttConfig.enabled) {
            if (this.rttHelper.rttPortsPending > 0) {
                // If we are getting here, we will need some serious re-factoring
                throw new Error('Asynchronous timing error. Could not allocate all the ports needed in time.');
            }
            const keys = Object.keys(this.rttHelper.rttLocalPortMap);
            let tcpPort = this.defaultRttPort.toString();
            if (keys && (keys.length > 0)) {
                // We only support one port because JLink gdb-server only supports one port
                tcpPort = this.rttHelper.rttLocalPortMap[keys[0]];
            }
            cmdargs.push('-rtttelnetport', tcpPort);
        }

        if (this.args.serialNumber) {
            cmdargs.push('-select', `usb=${this.args.serialNumber}`);
        }
        else if (this.args.ipAddress) {
            cmdargs.push('-select', `ip=${this.args.ipAddress}`);
        }

        if (this.args.rtos) {
            cmdargs.push('-rtos', this.args.rtos);
        }

        if (this.args.jlinkscript) {
            cmdargs.push('-jlinkscriptfile', this.args.jlinkscript);
        }

        if (this.args.serverArgs) {
            cmdargs = cmdargs.concat(this.args.serverArgs);
        }

        return cmdargs;
    }

    public initMatch(): RegExp {
        return /Waiting for GDB connection/g;
    }

    public serverLaunchStarted(): void {}
    public serverLaunchCompleted(): Promise<void> {
        if (this.args.swoConfig.enabled) {
            if ((this.args.swoConfig.source === 'probe') || (this.args.swoConfig.source === 'socket')) {
                const swoPortNm = createPortName(this.args.targetProcessor, 'swoPort');
                this.emit('event', new SWOConfigureEvent({
                    type: 'socket',
                    args: this.args,
                    port: this.ports[swoPortNm].toString(10)
                }));
            }
            else {
                this.emit('event', new SWOConfigureEvent({
                    type: 'serial',
                    args: this.args,
                    device: this.args.swoConfig.source,
                    baudRate: this.args.swoConfig.swoFrequency
                }));
            }
        }

        /* The JLink Server will output its initMatch line before it's actually ready to
         * process commands from a GDB client. This causes the JLink server's state to fall out of
         * sync with the debugger chip from the beginning, and the GDB client will fail to start
         * the processor correctly. This typically surfaces as a "Failed to start CPU" line in
         * the Adapter output and all registers read as 0xdeadbeee or 0xdeadbeef until the debugger
         * chip is reset with "monitor reset".
         *
         * Sleep for 500ms at the end of the server launch to give the JLink server time to
         * settle:
         */
        return new Promise((resolve) => setTimeout(resolve, 500));
    }
    public debuggerLaunchStarted(): void {}
    public debuggerLaunchCompleted(): void {
        this.rttHelper.emitConfigures(this.args.rttConfig, this);
    }
}
