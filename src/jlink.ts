import { DebugProtocol } from 'vscode-debugprotocol';
import { GDBServerController, ConfigurationArguments, calculatePortMask, createPortName,SWOConfigureEvent, getAnyFreePort, parseHexOrDecInt, RTTConfigureEvent, RTTServerHelper } from './common';
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
        this.rttHelper.allocateRTTPorts(args.rttConfig, this.defaultRttPort);
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
            'interpreter-exec console "monitor reset"',
            'target-download',
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
        if (this.args.rttConfig.enabled && !(this.args as any).pvtRestart) {
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
                for (var bytes = 0; bytes < cfg.searchId.length; bytes += 4) {
                    commands.push(`interpreter-exec console "monitor exec memU32 0x${addr.toString(16)} = 0"`);
                    addr += 4;
                }
            }
            commands.push(`interpreter-exec console "monitor exec SetRTTAddr ${cfg.address}"`);
            if (this.rttHelper.rttLocalPortMap[0] && (this.rttHelper.rttLocalPortMap[0] !== this.defaultRttPort.toString())) {
                // This does not work as it needs to be done before the probe connects to device
                // commands.push(`interpreter-exec console "monitor exec SetRTTTelnetPort ${this.rttHelper.rttLocalPortMap[0]}"`);
            }
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
            // '-nogui',    // removed at users request 
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
            cmdargs.push('-rtttelnetport', this.rttHelper.rttLocalPortMap[0]);
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
        return /Waiting for GDB connection\.\.\./g;
    }

    public serverLaunchStarted(): void {}
    public serverLaunchCompleted(): void {
        if (this.args.swoConfig.enabled) {
            if ((this.args.swoConfig.source === 'probe') || (this.args.swoConfig.source === 'socket')) {
                const swoPortNm = createPortName(this.args.targetProcessor, 'swoPort');
                this.emit('event', new SWOConfigureEvent({ type: 'socket', port: this.ports[swoPortNm].toString(10) }));
            }
            else {
                this.emit('event', new SWOConfigureEvent({
                    type: 'serial',
                    device: this.args.swoConfig.source,
                    baudRate: this.args.swoConfig.swoFrequency
                }));
            }
        }
    }
    public debuggerLaunchStarted(): void {}
    public debuggerLaunchCompleted(): void {
        this.rttHelper.emitConfigures(this.args.rttConfig, this);
    }
}
