import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import { STLinkServerController } from './../stlink';

const OPENOCD_VALID_RTOS: string[] = ['eCos', 'ThreadX', 'FreeRTOS', 'ChibiOS', 'embKernel', 'mqx', 'uCOS-III', 'auto'];
const JLINK_VALID_RTOS: string[] = ['FreeRTOS', 'embOS', 'ChibiOS', 'Zephyr'];

export class CortexDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    constructor(private context: vscode.ExtensionContext) {}

    public resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration> {
        // Flatten the platform specific stuff as it is not done by VSCode at this point.
        switch (os.platform()) {
            case 'darwin': Object.assign(config, config.osx); delete config.osx; break;
            case 'win32': Object.assign(config, config.windows); delete config.windows; break;
            case 'linux': Object.assign(config, config.linux); delete config.linux; break;
            default: console.log(`Unknown platform ${os.platform()}`);
        }
        if (config.debugger_args && !config.debuggerArgs) {
            config.debuggerArgs = config.debugger_args;
        }
        if (!config.debuggerArgs) { config.debuggerArgs = []; }
        
        const type = config.servertype;

        let validationResponse: string = null;

        if (!config.swoConfig) {
            config.swoConfig = { enabled: false, decoders: [], cpuFrequency: 0, swoFrequency: 0, source: 'probe' };
        }
        else {
            if (config.swoConfig.ports && !config.swoConfig.decoders) {
                config.swoConfig.decoders = config.swoConfig.ports;
            }
            if (!config.swoConfig.source) { config.swoConfig.source = 'probe'; }
            if (!config.swoConfig.decoders) { config.swoConfig.decoders = []; }
            config.swoConfig.decoders.forEach((d, idx) => {
                if (d.type === 'advanced') {
                    if (d.ports === undefined && d.number !== undefined) {
                        d.ports = [d.number];
                    }
                }
                else {
                    if (d.port === undefined && d.number !== undefined) {
                        d.port = d.number;
                    }
                }
            });
        }
        if (!config.graphConfig) { config.graphConfig = []; }
        if (!config.preLaunchCommands) { config.preLaunchCommands = []; }
        if (!config.postLaunchCommands) { config.postLaunchCommands = []; }
        if (!config.preAttachCommands) { config.preAttachCommands = []; }
        if (!config.postAttachCommands) { config.postAttachCommands = []; }
        if (!config.preRestartCommands) { config.preRestartCommands = []; }
        if (!config.postRestartCommands) { config.postRestartCommands = []; }
        if (config.request !== 'launch') { config.runToEntryPoint = null; }
        else if (config.runToEntryPoint) { config.runToEntryPoint = config.runToEntryPoint.trim(); }
        else if (config.runToMain) { config.runToEntryPoint = 'main'; }

        switch (type) {
            case 'jlink':
                validationResponse = this.verifyJLinkConfiguration(folder, config);
                break;
            case 'openocd':
                validationResponse = this.verifyOpenOCDConfiguration(folder, config);
                break;
            case 'stutil':
                validationResponse = this.verifySTUtilConfiguration(folder, config);
                break;
            case 'stlink':
                validationResponse = this.verifySTLinkConfiguration(folder, config);
                break;
            case 'pyocd':
                validationResponse = this.verifyPyOCDConfiguration(folder, config);
                break;
            case 'bmp':
                validationResponse = this.verifyBMPConfiguration(folder, config);
                break;
            case 'pe':
                validationResponse = this.verifyPEConfiguration(folder, config);
                break;
            case 'external':
                validationResponse = this.verifyExternalConfiguration(folder, config);
                break;
            case 'qemu':
                validationResponse = this.verifyQEMUConfiguration(folder, config);
                break;
            default:
                // tslint:disable-next-line:max-line-length
                validationResponse = 'Invalid servertype parameters. The following values are supported: "jlink", "openocd", "stlink", "stutil", "pyocd", "bmp", "pe", "qemu", "external"';
                break;
        }

        const configuration = vscode.workspace.getConfiguration('cortex-debug');

        // Special case to auto-resolve GCC toolchain for STM32CubeIDE users
        if (!config.armToolchainPath && config.servertype === 'stlink') {
           config.armToolchainPath = STLinkServerController.getArmToolchainPath();
        }

        if (config.armToolchainPath) { config.toolchainPath = config.armToolchainPath; }
        if (!config.toolchainPath) {
            config.toolchainPath = configuration.armToolchainPath;
        }
        
        if (!config.toolchainPrefix) {
            config.toolchainPrefix = configuration.armToolchainPrefix || 'arm-none-eabi';
        }
        
        if (!config.gdbPath) {
            config.gdbPath = configuration.gdbPath;
        }

        config.extensionPath = this.context.extensionPath;
        if (os.platform() === 'win32') {
            config.extensionPath = config.extensionPath.replace(/\\/g, '/'); // GDB doesn't interpret the path correctly with backslashes.
        }

        config.flattenAnonymous = configuration.flattenAnonymous;
        config.registerUseNaturalFormat = configuration.registerUseNaturalFormat;
        
        if (validationResponse) {
            vscode.window.showErrorMessage(validationResponse);
            return undefined;
        }
        
        return config;
    }

    private verifyQEMUConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): string {
        if (config.qemupath && !config.serverpath) { config.serverpath = config.qemupath; }

        if (!config.cpu) { config.cpu = 'cortex-m3'; }
        if (!config.machine) { config.machine = 'lm3s6965evb'; }

        if (config.swoConfig.enabled) {
            vscode.window.showWarningMessage('SWO support is not available when using QEMU.');
            config.swoConfig = { enabled: false, ports: [], cpuFrequency: 0, swoFrequency: 0 };
            config.graphConfig = [];
        }

        if (config.rtos) {
            return 'RTOS support is not available when using QEMU';
        }
        
        return null;
    }

    private verifyJLinkConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): string {
        if (config.jlinkpath && !config.serverpath) { config.serverpath = config.jlinkpath; }
        if (!config.interface && config.jlinkInterface) { config.interface = config.jlinkInterface; }
        if (!config.interface) { config.interface = 'swd'; }

        if (!config.serverpath) {
            const configuration = vscode.workspace.getConfiguration('cortex-debug');
            config.serverpath = configuration.JLinkGDBServerPath;
        }
        if (config.rtos) {
            if (JLINK_VALID_RTOS.indexOf(config.rtos) === -1) {
                if (!fs.existsSync(config.rtos)) {
                    // tslint:disable-next-line:max-line-length
                    return `The following RTOS values are supported by J-Link: ${JLINK_VALID_RTOS.join(', ')}. A custom plugin can be used by supplying a complete path to a J-Link GDB Server Plugin.`;
                }
            }
            else {
                config.rtos = `GDBServer/RTOSPlugin_${config.rtos}`;
            }
        }

        if (!config.device) {
            // tslint:disable-next-line:max-line-length
            return 'Device Identifier is required for J-Link configurations. Please see https://www.segger.com/downloads/supported-devices.php for supported devices';
        }

        if (config.interface === 'jtag' && config.swoConfig.enabled && config.swoConfig.source === 'probe') {
            return 'SWO Decoding cannot be performed through the J-Link Probe in JTAG mode.';
        }

        return null;
    }

    private verifyOpenOCDConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): string {
        if (config.openOCDPath && !config.serverpath) { config.serverpath = config.openOCDPath; }
        if (!config.serverpath) {
            const configuration = vscode.workspace.getConfiguration('cortex-debug');
            config.serverpath = configuration.openocdPath;
        }

        if (config.rtos && OPENOCD_VALID_RTOS.indexOf(config.rtos) === -1) {
            return `The following RTOS values are supported by OpenOCD: ${OPENOCD_VALID_RTOS.join(' ')}`;
        }

        if (!config.configFiles || config.configFiles.length === 0) {
            return 'At least one OpenOCD Configuration File must be specified.';
        }

        if (!config.searchDir || config.searchDir.length === 0) {
            config.searchDir = [];
        }
        
        return null;
    }

    private verifySTUtilConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): string {
        if (config.stutilpath && !config.serverpath) { config.serverpath = config.stutilpath; }
        if (!config.serverpath) {
            const configuration = vscode.workspace.getConfiguration('cortex-debug');
            config.serverpath = configuration.stutilPath;
        }

        if (config.rtos) {
            return 'The st-util GDB Server does not have support for the rtos option.';
        }

        if (config.swoConfig.enabled && config.swoConfig.source === 'probe') {
            vscode.window.showWarningMessage('SWO support is not available from the probe when using the ST-Util GDB server. Disabling SWO.');
            config.swoConfig = { enabled: false, ports: [], cpuFrequency: 0, swoFrequency: 0 };
            config.graphConfig = [];
        }

        return null;
    }

    private verifySTLinkConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): string {
        if (config.stlinkPath && !config.serverpath) { config.serverpath = config.stlinkPath; }
        if (!config.serverpath) {
            const configuration = vscode.workspace.getConfiguration('cortex-debug');
            config.serverpath = configuration.stlinkPath;
        }

        if (!config.stm32cubeprogrammer) {
            const configuration = vscode.workspace.getConfiguration('cortex-debug');
            config.stm32cubeprogrammer = configuration.stm32cubeprogrammer;
        }

        if (config.rtos) {
            return 'The ST-Link GDB Server does not have support for the rtos option.';
        }

        if (config.swoConfig.enabled && config.swoConfig.source === 'probe') {
            vscode.window.showWarningMessage('SWO support is not available from the probe when using the ST-Link GDB server. Disabling SWO.');
            config.swoConfig = { enabled: false, ports: [], cpuFrequency: 0, swoFrequency: 0 };
            config.graphConfig = [];
        }

        return null;
    }

    private verifyPyOCDConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): string {
        if (config.pyocdPath && !config.serverpath) { config.serverpath = config.pyocdPath; }
        if (!config.serverpath) {
            const configuration = vscode.workspace.getConfiguration('cortex-debug');
            config.serverpath = configuration.pyocdPath;
        }

        if (config.rtos) {
            return 'The PyOCD GDB Server does not have support for the rtos option.';
        }

        if (config.board && !config.boardId) { config.boardId = config.board; }
        if (config.target && !config.targetId) { config.targetId = config.target; }

        if (config.swoConfig.enabled && config.swoConfig.source === 'probe') {
            vscode.window.showWarningMessage('SWO support is not available from the probe when using the PyOCD GDB server. Disabling SWO.');
            config.swoConfig = { enabled: false, ports: [], cpuFrequency: 0, swoFrequency: 0 };
            config.graphConfig = [];
        }

        return null;
    }

    private verifyBMPConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): string {
        if (!config.BMPGDBSerialPort) { return 'A Serial Port for the Black Magic Probe GDB server is required.'; }
        if (!config.powerOverBMP) { config.powerOverBMP = 'lastState'; }
        if (!config.interface) { config.interface = 'swd'; }
        if (!config.targetId) { config.targetId = 1; }
        
        if (config.rtos) {
            return 'The Black Magic Probe GDB Server does not have support for the rtos option.';
        }

        if (config.swoConfig.enabled && config.swoConfig.source === 'probe') {
            vscode.window.showWarningMessage('SWO support is not available from the probe when using the BMP GDB server. Disabling SWO.');
            config.swoConfig = { enabled: false, ports: [], cpuFrequency: 0, swoFrequency: 0 };
            config.graphConfig = [];
        }

        return null;
    }

    private verifyPEConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): string {
        if (!config.serverpath) {
            const configuration = vscode.workspace.getConfiguration('cortex-debug');
            config.serverpath = configuration.PEGDBServerPath;
        }

        if (config.configFiles && config.configFiles.length > 1) {
            return 'Only one pegdbserver Configuration File is allowed.';
        }

        if (!config.device) {
            return 'Device Identifier is required for PE configurations. Please run `pegdbserver_console.exe -devicelist` for supported devices';
        }

        if (config.swoConfig.enabled) {
            return 'The PE GDB Server does not have support for SWO';
        }

        return null;
    }

    private verifyExternalConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): string {
        if (config.swoConfig.enabled && config.swoConfig.source === 'probe') {
            vscode.window.showWarningMessage('SWO support is not available for external GDB servers. Disabling SWO support.');
            config.swoConfig = { enabled: false, ports: [], cpuFrequency: 0, swoFrequency: 0 };
            config.graphConfig = [];
        }

        if (!config.gdbTarget) {
            return 'External GDB server type must specify the GDB target. This should either be a "hostname:port" combination or a serial port.';
        }

        return null;
    }
}
