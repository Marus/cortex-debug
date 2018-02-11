import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class DeprecatedDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    constructor(private context: vscode.ExtensionContext, private id: string) {}

    public resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration> {
        // tslint:disable-next-line:max-line-length
        vscode.window.showWarningMessage(`Your current launch configuration has been deprecated. Please replace "type": "${this.id}-gdb" with "type": "cortex-debug" and "servertype": "${this.id}"`);

        config.type = 'cortex-debug';
        config.servertype = this.id;

        const cp = new CortexDebugConfigurationProvider(this.context);
        return cp.resolveDebugConfiguration(folder, config, token);
    }
}

export class CortexDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    constructor(private context: vscode.ExtensionContext) {}

    public resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration> {
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
        if (!config.postLaunchCommands) { config.postLaunchCommands = []; }

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
            case 'pyocd':
                validationResponse = this.verifyPyOCDConfiguration(folder, config);
                break;
            case 'bmp':
                validationResponse = this.verifyBMPConfiguration(folder, config);
                break;
            default:
                validationResponse = 'Invalid servertype parameters. The following values are supported: "jlink", "openocd", "stutil", "pyocd", "bmp"';
                break;
        }

        const configuration = vscode.workspace.getConfiguration('cortex-debug');
        config.toolchainPath = configuration.armToolchainPath;

        config.extensionPath = this.context.extensionPath;
        if (os.platform() === 'win32') {
            config.extensionPath = config.extensionPath.replace(/\\/g, '/'); // GDB doesn't interpret the path correctly with backslashes.
        }
        
        if (validationResponse) {
            vscode.window.showErrorMessage(validationResponse);
            return undefined;
        }
        
        let executable: string = (config.executable || '');
        executable = executable.replace(/\$\{\s*workspaceRoot\s*\}/, folder.uri.fsPath);
        let cwd = config.cwd || '${workspaceRoot}';
        cwd = cwd.replace(/\$\{\s*workspaceRoot\s*\}/, folder.uri.fsPath);

        if (!path.isAbsolute(executable)) {
            executable = path.normalize(path.join(cwd, executable));
        }

        if (fs.existsSync(executable)) {
            config.executable = executable;
        }
        else {
            vscode.window.showErrorMessage(`Invalid executable: ${executable} not found.`);
            return undefined;
        }
        
        return config;
    }

    private verifyJLinkConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): string {
        if (config.jlinkpath && !config.serverpath) { config.serverpath = config.jlinkpath; }
        if (!config.jlinkInterface) { config.jlinkInterface = 'swd'; }
        if (config.jlinkInterface !== 'jtag' && config.jlinkInterface !== 'swd') {
            vscode.window.showWarningMessage(`jlinkInterface parameter ${config.jlinkInterface} is not valid (swd or jtag). Defaulting to SWD mode.`);
            config.jlinkInterface = 'swd';
        }
        if (!config.serverpath) {
            const configuration = vscode.workspace.getConfiguration('cortex-debug');
            config.serverpath = configuration.JLinkGDBServerPath;
        }

        if (!config.device) {
            // tslint:disable-next-line:max-line-length
            return 'Device Identifier is required for J-Link configurations. Please see https://www.segger.com/downloads/supported-devices.php for supported devices';
        }

        if (config.jlinkInterface === 'jtag' && config.swoConfig.enabled && config.swoConfig.source === 'probe') {
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

        if (!config.configFiles || config.configFiles.length === 0) {
            return 'At least one OpenOCD Configuration File must be specified.';
        }

        return null;
    }

    private verifySTUtilConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): string {
        if (config.stutilpath && !config.serverpath) { config.serverpath = config.stutilpath; }
        if (!config.serverpath) {
            const configuration = vscode.workspace.getConfiguration('cortex-debug');
            config.serverpath = configuration.stutilPath;
        }

        if (config.swoConfig.enabled && config.swoConfig.source === 'probe') {
            vscode.window.showWarningMessage('SWO support is not available from the probe when using the ST-Util GDB server. Disabling SWO.');
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

        if (config.swoConfig.enabled && config.swoConfig.source === 'probe') {
            vscode.window.showWarningMessage('SWO support is not available from the probe when using the BMP GDB server. Disabling SWO.');
            config.swoConfig = { enabled: false, ports: [], cpuFrequency: 0, swoFrequency: 0 };
            config.graphConfig = [];
        }

        return null;
    }
}
