import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import { STLinkServerController } from './../stlink';
import { GDBServerConsole } from './server_console';
import { ADAPTER_DEBUG_MODE, ChainedConfigurations, ChainedEvents, CortexDebugKeys, sanitizeDevDebug, ConfigurationArguments, validateELFHeader, SymbolFile, defSymbolFile } from '../common';
import { CDebugChainedSessionItem, CDebugSession } from './cortex_debug_session';
import * as path from 'path';

// Please confirm these names with OpenOCD source code. Their docs are incorrect as to case
const OPENOCD_VALID_RTOS: string[] = [
    'auto',
    'FreeRTOS',
    'ThreadX',
    'chibios',
    'Chromium-EC',
    'eCos',
    'embKernel',
    // 'hwthread',
    'linux',
    'mqx',
    'nuttx',
    'RIOT',
    'uCOS-III',
    'Zephyr'
];
const JLINK_VALID_RTOS: string[] = ['Azure', 'ChibiOS', 'embOS', 'FreeRTOS', 'NuttX', 'Zephyr'];

export class CortexDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    constructor(private context: vscode.ExtensionContext) {}

    public resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration> {
        if (GDBServerConsole.BackendPort <= 0) {
            vscode.window.showErrorMessage('GDB server console not yet ready. Please try again. Report this problem');
            return undefined;
        }
        config.gdbServerConsolePort = GDBServerConsole.BackendPort;
        config.pvtAvoidPorts = CDebugSession.getAllUsedPorts();

        // Flatten the platform specific stuff as it is not done by VSCode at this point.
        switch (os.platform()) {
            case 'darwin': Object.assign(config, config.osx); delete config.osx; break;
            case 'win32': Object.assign(config, config.windows); delete config.windows; break;
            case 'linux': Object.assign(config, config.linux); delete config.linux; break;
            default: console.log(`Unknown platform ${os.platform()}`);
        }
        this.sanitizeChainedConfigs(config);
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
        if (!config.rttConfig) {
            config.rttConfig = { enabled: false, decoders: [] };
        }
        else if (!config.rttConfig.decoders) {
            config.rttConfig.decoders = [];
        }

        if (!config.graphConfig) { config.graphConfig = []; }
        if (!config.preLaunchCommands) { config.preLaunchCommands = []; }
        if (!config.postLaunchCommands) { config.postLaunchCommands = []; }
        if (!config.preAttachCommands) { config.preAttachCommands = []; }
        if (!config.postAttachCommands) { config.postAttachCommands = []; }
        if (!config.preRestartCommands) { config.preRestartCommands = []; }
        if (!config.postRestartCommands) { config.postRestartCommands = []; }
        if (!config.preResetCommands) { config.preResetCommands = config.preRestartCommands; }
        if (!config.postResetCommands) { config.postResetCommands = config.postRestartCommands; }
        if (config.runToEntryPoint) { config.runToEntryPoint = config.runToEntryPoint.trim(); }
        else if (config.runToMain) {
            config.runToEntryPoint = 'main';
            vscode.window.showWarningMessage(
                'launch.json: "runToMain" has been deprecated and will not work in future versions of Cortex-Debug. Please use "runToEntryPoint" instead');
        }

        if ((type !== 'openocd') || !config.ctiOpenOCDConfig?.enabled) {
            delete config.ctiOpenOCDConfig;
        }

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
        if (config.showDevDebugOutput === undefined) {
            config.showDevDebugOutput = configuration.get(CortexDebugKeys.DEV_DEBUG_MODE, ADAPTER_DEBUG_MODE.NONE);
        }
        if (!sanitizeDevDebug(config)) {
            const modes = Object.values(ADAPTER_DEBUG_MODE);
            vscode.window.showInformationMessage(`launch.json: "showDevDebugOutput" muse be one of ${modes}. Setting to "${config.showDevDebugOutput}"`);
        }

        if (config.armToolchainPath) { config.toolchainPath = config.armToolchainPath; }
        this.setOsSpecficConfigSetting(config, 'toolchainPath', 'armToolchainPath');

        if (!config.toolchainPath) {
            // Special case to auto-resolve GCC toolchain for STM32CubeIDE users
            if (!config.armToolchainPath && config.servertype === 'stlink') {
               config.armToolchainPath = STLinkServerController.getArmToolchainPath();
            }
        }

        if (!config.toolchainPrefix) {
            config.toolchainPrefix = configuration.armToolchainPrefix || 'arm-none-eabi';
        }

        this.setOsSpecficConfigSetting(config, 'gdbPath');
        this.setOsSpecficConfigSetting(config, 'objdumpPath');
        config.extensionPath = this.context.extensionPath;
        if (os.platform() === 'win32') {
            config.extensionPath = config.extensionPath.replace(/\\/g, '/'); // GDB doesn't interpret the path correctly with backslashes.
        }

        config.registerUseNaturalFormat = configuration.get(CortexDebugKeys.REGISTER_DISPLAY_MODE, true);
        config.variableUseNaturalFormat = configuration.get(CortexDebugKeys.VARIABLE_DISPLAY_MODE, true);

        if (validationResponse) {
            vscode.window.showErrorMessage(validationResponse);
            return undefined;
        }

        return config;
    }

    public resolveDebugConfigurationWithSubstitutedVariables(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration> {
        let cwd = config.cwd || folder.uri.fsPath;
        if (!path.isAbsolute(cwd)) {
            cwd = path.join(folder.uri.fsPath, cwd);
        }
        config.cwd = cwd;
        if (!fs.existsSync(cwd)) {
            vscode.window.showWarningMessage(`Invalid "cwd": "${cwd}". Many operations can fail. Trying to continue`);
        }
        this.validateLoadAndSymbolFiles(config, cwd);

        const extension = vscode.extensions.getExtension('marus25.cortex-debug');
        config.pvtVersion = extension?.packageJSON?.version || '<unknown version>';

        if (config.liveWatch?.enabled) {
            const supportedList = ['openocd', 'jlink', 'stlink'];
            if (supportedList.indexOf(config.servertype) < 0) {
                let str = '';
                for (const s of supportedList) {
                    str += (str ? ', ' : '') + `'${s}'`;
                }
                // config.liveWatch.enabled = false;
                vscode.window.showWarningMessage(
                    `Live watch is not supported for servertype '${config.servertype}'. Only ${str} supported/tested.\n` +
                    `Report back to us if it works with '${config.servertype}'`);
            }
        }

        let validationResponse: string = null;
        switch (config.servertype) {
            case 'jlink':
                validationResponse = this.verifyJLinkConfigurationAfterSubstitution(folder, config);
                break;
            default:
                /* config.servertype was already checked in resolveDebugConfiguration */
                validationResponse = null;
                break;
        }
        if (validationResponse) {
            vscode.window.showErrorMessage(validationResponse);
            return undefined;
        }

        return config;
    }

    private static adjustStrIntProp(obj: object, prop: string, where: string) {
        if (!obj.hasOwnProperty(prop)) {
            return;
        }
        let val: any = obj[prop];
        if (val) {
            let isIntString = false;
            if (typeof val === 'string') {
                val = (val as string).trim();
                isIntString = (val.match(/^0[x][0-9a-f]+/i) || val.match(/^[0-9]+/));
            }
            if (isIntString) {
                obj[prop] = parseInt(val);
            } else if (typeof obj[prop] !== 'number') {
                vscode.window.showErrorMessage(`Invalid "${prop}" value ${val} for ${where}. Must be a number or a string." +
                    " Use a string starting with "0x" for a hexadecimal number`);
                delete obj[prop];
            }
        }
    }

    private validateLoadAndSymbolFiles(config: vscode.DebugConfiguration, cwd: any) {
        // Right now, we don't consider a bad executable as fatal. Technically, you don't need an executable but
        // users will get a horrible debug experience ... so many things don't work.
        const def = defSymbolFile(config.executable);
        const symFiles: SymbolFile[] = config.symbolFiles || [def];
        if (!symFiles || (symFiles.length === 0)) {
            vscode.window.showWarningMessage('No "executable" or "symbolFiles" specified. We will try to run program without symbols');
        } else {
            for (const symF of symFiles) {
                let exe = symF.file;
                exe = path.isAbsolute(exe) ? exe : path.join(cwd, exe);
                exe = path.normalize(exe).replace(/\\/g, '/');
                if (!config.symbolFiles) {
                    config.executable = exe;
                } else {
                    symF.file = exe;
                }
                CortexDebugConfigurationProvider.adjustStrIntProp(symF, 'offset', `file ${exe}`);
                CortexDebugConfigurationProvider.adjustStrIntProp(symF, 'textaddress', `file ${exe}`);
                symF.sectionMap = {};
                symF.sections = symF.sections || [];
                for (const section of symF.sections) {
                    CortexDebugConfigurationProvider.adjustStrIntProp(section, 'address', `section ${section.name} of file ${exe}`);
                    symF.sectionMap[section.name] = section;
                }
                validateELFHeader(exe, (str: string, fatal: boolean) => {
                    if (fatal) {
                        vscode.window.showErrorMessage(str);
                    } else {
                        // vscode.window.showWarningMessage(str);
                    }
                });
            }
            if (config.symbolFiles) {
                config.symbolFiles = symFiles;
            }
        }

        if (config.loadFiles) {
            for (let ix = 0; ix < config.loadFiles.length; ix++) {
                let fName = config.loadFiles[ix];
                fName = path.isAbsolute(fName) ? fName : path.join(cwd, fName);
                fName = path.normalize(fName).replace(/\\/g, '/');
                config.loadFiles[ix] = fName;
            }
        }
    }

    private handleChainedInherits(config: vscode.DebugConfiguration, parent: any, props: string[]) {
        if (!props) {
            return;
        }
        const blackList: string[] = [
            'type',
            'name',
            'request',
            'chainedConfigurations'
        ];

        for (const propName of props) {
            if (blackList.includes(propName) || propName.startsWith('pvt')) {
                vscode.window.showWarningMessage(`Cannot inherit property '${propName}' for configuration '${config.name}' because it is reserved`);
                continue;
            }
            const val = parent[propName];
            if (val !== undefined) {
                config[propName] = val;
            } else {
                // tslint:disable-next-line: max-line-length
                vscode.window.showWarningMessage(`Cannot inherit property '${propName}' for configuration '${config.name}' because it does not exist in parent configuration`);
            }
        }
    }

    private handleChainedOverrides(config: vscode.DebugConfiguration, props: any) {
        if (!props) {
            return;
        }
        const blackList: string[] = [
            'type',
            'name',
            'request'
        ];

        for (const propName of Object.keys(props)) {
            if (blackList.includes(propName) || propName.startsWith('pvt')) {
                continue;
            }
            const val = props[propName];
            if (val === null) {
                delete config[propName];
            } else {
                config[propName] = val;
            }
        }
    }

    private sanitizeChainedConfigs(config: vscode.DebugConfiguration) {
        // First are we chained ... as in do we have a parent?
        const isChained = CDebugChainedSessionItem.FindByName(config.name);
        if (isChained) {
            config.pvtParent = isChained.parent.config;
            config.pvtMyConfigFromParent = isChained.config;
            this.handleChainedInherits(config, config.pvtParent, isChained.config.inherits);
            this.handleChainedOverrides(config, isChained.config.overrides);
        }

        // See if we gave children and sanitize them
        const chained = config.chainedConfigurations as ChainedConfigurations;
        if (!chained || !chained.enabled || !chained.launches || (chained.launches.length === 0)) {
            config.chainedConfigurations = { enabled: false };
            return;
        }
        if (!chained.delayMs) { chained.delayMs = 0; }
        if (!chained.waitOnEvent || !Object.values(ChainedEvents).includes(chained.waitOnEvent)) {
            chained.waitOnEvent = ChainedEvents.POSTINIT;
        }
        if ((chained.detached === undefined) || (chained.detached === null)) {
            chained.detached = (config.servertype === 'jlink') ? true : false;
        }
        if ((chained.lifecycleManagedByParent === undefined) || (chained.lifecycleManagedByParent === null)) {
            chained.lifecycleManagedByParent = true;
        }
        const overrides = chained.overrides || {};
        for (const launch of chained.launches) {
            if ((launch.enabled === undefined) || (launch.enabled === null)) {
                launch.enabled = true;
            }
            if (launch.delayMs === undefined) {
                launch.delayMs = chained.delayMs;
            }
            if ((launch.detached === undefined) || (launch.detached === null)) {
                launch.detached = chained.detached;
            }
            if ((launch.waitOnEvent === undefined) || !Object.values(ChainedEvents).includes(launch.waitOnEvent)) {
                launch.waitOnEvent = chained.waitOnEvent;
            }
            if ((launch.lifecycleManagedByParent === undefined) || (launch.lifecycleManagedByParent === null)) {
                launch.lifecycleManagedByParent = chained.lifecycleManagedByParent;
            }
            const inherits = (launch.inherits || []).concat(chained.inherits || []);
            if (inherits.length > 0) {
                launch.inherits = inherits;
            } else {
                delete launch.inherits;
            }

            const tmp = launch.overrides || {};
            if ((Object.keys(overrides).length > 0) || (Object.keys(tmp).length > 0)) {
                launch.overrides = Object.assign(overrides, tmp);
            } else {
                delete launch.overrides;
            }
        }
    }

    private setOsSpecficConfigSetting(config: vscode.DebugConfiguration, dstName: string, propName: string = '') {
        if (!config[dstName]) {
            propName = propName || dstName;
            const settings = vscode.workspace.getConfiguration('cortex-debug');
            const obj = settings[propName];
            if (obj) {
                if (typeof obj === 'object') {
                    const osName = os.platform();
                    const osOverride = ((osName === 'win32') ? 'windows' : (osName === 'darwin') ? 'osx' : 'linux');
                    config[dstName] = obj[osOverride] || '';
                } else {
                    config[dstName] = obj;
                }
            }
        }
    }

    private verifyQEMUConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): string {
        this.setOsSpecficConfigSetting(config, 'serverpath', 'qemupath');
        // if (config.qemupath && !config.serverpath) { config.serverpath = config.qemupath; }

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
        if (config.jlinkpath && !config.serverpath) { config.serverpath = config.jlinkpath; }   // Obsolete
        if (!config.interface && config.jlinkInterface) { config.interface = config.jlinkInterface; }
        if (!config.interface) { config.interface = 'swd'; }

        this.setOsSpecficConfigSetting(config, 'serverpath', 'JLinkGDBServerPath');

        if (!config.device) {
            // tslint:disable-next-line:max-line-length
            return 'Device Identifier is required for J-Link configurations. Please see https://www.segger.com/downloads/supported-devices.php for supported devices';
        }

        if (((config.interface === 'jtag') || (config.interface === 'cjtag')) && config.swoConfig.enabled && config.swoConfig.source === 'probe') {
            return 'SWO Decoding cannot be performed through the J-Link Probe in JTAG mode.';
        }

        if (config.rttConfig && config.rttConfig.enabled && config.rttConfig.decoders && (config.rttConfig.decoders.length !== 0)) {
            let chosenPort;
            for (const dec of config.rttConfig.decoders) {
                if (dec.port === undefined) {
                    dec.port = 0;
                } else if (dec.port < 0 || dec.port > 15) {
                    return `Invalid port/channel '${dec.port}'.  JLink RTT port/channel must be between 0 and 15.`;
                }

                if ((chosenPort !== undefined) && (chosenPort !== dec.port)) {
                    return `Port/channel ${dec.port} selected but another decoder is using port ${chosenPort}. ` +
                        'JLink RTT only allows a single RTT port/channel per debugging session.';
                } else {
                    chosenPort = dec.port;
                }
            }
        }

        return null;
    }

    private verifyJLinkConfigurationAfterSubstitution(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): string {
        function defaultExt() {
            switch (os.platform()) {
                case 'darwin':
                    return '.dylib';
                case 'linux':
                    return '.so';
                case 'win32':
                    return '.dll';
                default:
                    console.log(`Unknown platform ${os.platform()}`);
                    return '';
            }
        }

        if (config.rtos) {
            if (JLINK_VALID_RTOS.indexOf(config.rtos) === -1) {
                /* When we do not have a file extension use the default OS one for file check, as J-Link allows the
                 * parameter to be used without one.
                 */
                if ('' === path.extname(config.rtos)) {
                    config.rtos = config.rtos + defaultExt();
                }

                if (!fs.existsSync(config.rtos)) {
                    return `JLink RTOS plugin file "${config.rtos}" not found.\n` +
                        `The following RTOS values are supported by J-Link: ${JLINK_VALID_RTOS.join(', ')}.` +
                        ' A custom plugin can be used by supplying a complete path to a J-Link GDB Server Plugin.';
                }
            }
            else {
                config.rtos = `GDBServer/RTOSPlugin_${config.rtos}` + defaultExt();
            }
        }

        return null;
    }

    private verifyOpenOCDConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): string {
        if (config.openOCDPath && !config.serverpath) { config.serverpath = config.openOCDPath; }   // Obsolete
        this.setOsSpecficConfigSetting(config, 'serverpath', 'openocdPath');

        if (config.rtos && OPENOCD_VALID_RTOS.indexOf(config.rtos) === -1) {
            return `The following RTOS values are supported by OpenOCD: ${OPENOCD_VALID_RTOS.join(' ')}.` +
                'You can always use "auto" and OpenOCD generally does the right thing';
        }

        if (!CDebugChainedSessionItem.FindByName(config.name)) {
            // Not chained so configFiles, searchDir matter
            if (!config.configFiles || config.configFiles.length === 0) {
                return 'At least one OpenOCD Configuration File must be specified.';
            }

            if (!config.searchDir || config.searchDir.length === 0) {
                config.searchDir = [];
            }
        }

        return null;
    }

    private verifySTUtilConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): string {
        if (config.stutilpath && !config.serverpath) { config.serverpath = config.stutilpath; }     // obsolete
        this.setOsSpecficConfigSetting(config, 'serverpath', 'stutilPath');

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
        if (config.stlinkPath && !config.serverpath) { config.serverpath = config.stlinkPath; } // Obsolete
        this.setOsSpecficConfigSetting(config, 'serverpath', 'stlinkPath');
        this.setOsSpecficConfigSetting(config, 'stm32cubeprogrammer');

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
        if (config.pyocdPath && !config.serverpath) { config.serverpath = config.pyocdPath; }   // Obsolete
        this.setOsSpecficConfigSetting(config, 'serverpath', 'pyocdPath');

        if (config.rtos) {
            return 'The PyOCD GDB Server does not have support for the rtos option.';
        }

        if (config.board && !config.boardId) { config.boardId = config.board; }
        if (config.target && !config.targetId) { config.targetId = config.target; }

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
        this.setOsSpecficConfigSetting(config, 'serverpath', 'PEGDBServerPath');

        if (config.configFiles && config.configFiles.length > 1) {
            return 'Only one pegdbserver Configuration File is allowed.';
        }

        if (!config.device) {
            return 'Device Identifier is required for PE configurations. Please run `pegdbserver_console.exe -devicelist` for supported devices';
        }

        if (config.swoConfig.enabled && config.swoConfig.source !== 'socket') {
            return 'The PE GDB Server Only supports socket type SWO';
        }

        return null;
    }

    private verifyExternalConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): string {
        if (config.swoConfig.enabled) {
            if (config.swoConfig.source === 'socket' && !config.swoConfig.swoPort) {
                vscode.window.showWarningMessage('SWO source type "socket" requires a "swoPort". Disabling SWO support.');
                config.swoConfig = { enabled: false };
                config.graphConfig = [];
            }
            else if (config.swoConfig.source !== 'socket' && !config.swoConfig.swoPath) {
                vscode.window.showWarningMessage(`SWO source type "${config.swoConfig.source}" requires a "swoPath". Disabling SWO support.`);
                config.swoConfig = { enabled: false };
                config.graphConfig = [];
            }
        }

        if (!config.gdbTarget) {
            return 'External GDB server type must specify the GDB target. This should either be a "hostname:port" combination or a serial port.';
        }

        return null;
    }
}
