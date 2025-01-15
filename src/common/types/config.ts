import { RTTConfiguration, SWOConfiguration } from '@common/types';

export enum ADAPTER_DEBUG_MODE {
    NONE = 'none',
    PARSED = 'parsed',
    BOTH = 'both',
    RAW = 'raw',
    VSCODE = 'vscode'
}

export enum CortexDebugKeys {
    REGISTER_DISPLAY_MODE = 'registerUseNaturalFormat',
    VARIABLE_DISPLAY_MODE = 'variableUseNaturalFormat',
    SERVER_LOG_FILE_NAME = 'dbgServerLogfile',
    DEV_DEBUG_MODE = 'showDevDebugOutput'
}

export enum NumberFormat {
    Auto = 0,
    Hexadecimal,
    Decimal,
    Binary
}

export interface ElfSection {
    name: string;
    address: number;            // New base address
    addressOrig: number;        // original base address in Elf file
}

export interface SymbolFile {
    file: string;
    offset?: number;
    textaddress?: number;
    sections: ElfSection[];
    sectionMap: {[name: string]: ElfSection};
}

export interface DebugOptions {
    file?: string;
    disassembly?: boolean;
}

export interface CTIOpenOCDConfig {
    enabled: boolean;
    initCommands: string[];
    pauseCommands: string[];
    resumeCommands: string[];
}

export interface LiveWatchConfig {
    enabled: boolean;
    samplesPerSecond?: number;
}

export interface ConfigurationArguments {
    name: string;
    request: string;
    toolchainPath: string;
    toolchainPrefix: string;
    executable: string;
    servertype: string;
    serverpath: string;
    gdbPath: string;
    objdumpPath: string;
    serverArgs: string[];
    serverCwd: string;
    device: string;
    loadFiles: string[];
    symbolFiles: SymbolFile[];
    debuggerArgs: string[];
    preLaunchCommands: string[];
    postLaunchCommands: string[];
    overrideLaunchCommands: string[];
    preAttachCommands: string[];
    postAttachCommands: string[];
    overrideAttachCommands: string[];
    preResetCommands: string[];
    postResetCommands: string[];
    overrideResetCommands: string[];
    postStartSessionCommands: string[];
    postResetSessionCommands: string[];
    overrideGDBServerStartedRegex: string;
    breakAfterReset: boolean;
    svdFile: string;
    svdAddrGapThreshold: number;
    ctiOpenOCDConfig: CTIOpenOCDConfig;
    rttConfig: RTTConfiguration;
    swoConfig: SWOConfiguration;
    liveWatch: LiveWatchConfig;
    graphConfig: any[];
    /// Triple slashes will cause the line to be ignored by the options-doc.py script
    /// We don't expect the following to be in booleann form or have the value of 'none' after
    /// The config provider has done the conversion. If it exists, it means output 'something'
    showDevDebugOutput: ADAPTER_DEBUG_MODE;
    pvtShowDevDebugOutput: ADAPTER_DEBUG_MODE;
    showDevDebugTimestamps: boolean;
    cwd: string;
    extensionPath: string;
    rtos: string;
    interface: 'jtag' | 'swd' | 'cjtag';
    targetId: string | number;
    runToMain: boolean;         // Deprecated: kept here for backwards compatibility
    runToEntryPoint: string;
    registerUseNaturalFormat: boolean;
    variableUseNaturalFormat: boolean;
    chainedConfigurations: ChainedConfigurations;

    pvtIsReset: boolean;
    pvtPorts: { [name: string]: number; };
    pvtParent: ConfigurationArguments;
    pvtMyConfigFromParent: ChainedConfig;     // My configuration coming from the parent
    pvtAvoidPorts: number[];
    pvtVersion: string;                       // Version from package.json
    pvtOpenOCDDebug: boolean;
    pvtAdapterDebugOptions?: DebugOptions;

    numberOfProcessors: number;
    targetProcessor: number;

    // J-Link Specific
    ipAddress: string;
    serialNumber: string;
    jlinkscript: string;
    
    // OpenOCD Specific
    configFiles: string[];
    searchDir: string[];
    openOCDLaunchCommands: string[];
    openOCDPreConfigLaunchCommands: string[];

    // PyOCD Specific
    boardId: string;
    cmsisPack: string;
    
    // StUtil Specific
    v1: boolean;

    // ST-LINK GDB server specific
    stm32cubeprogrammer: string;

    // BMP Specific
    BMPGDBSerialPort: string;
    powerOverBMP: string;

    // QEMU Specific
    cpu: string;
    machine: string;

    // External 
    gdbTarget: string;
}

export enum ChainedEvents {
    POSTSTART = 'postStart', // Default - a connection was established with the gdb-server, before initialization is done
    POSTINIT = 'postInit'    // all init functionality has been done. Generally past programming and stopped at or
                             // past reset-vector but depends on customizations
}
export interface ChainedConfig {
    enabled: boolean;
    name: string;           // Debug configuration to launch (could be attach or launch)
    delayMs: number;
    waitOnEvent: ChainedEvents;
    detached: boolean;
    lifecycleManagedByParent: boolean;
    folder: string;
    overrides: {[key: string]: any};
    inherits: string[];
}

export interface ChainedConfigurations {
    enabled: boolean;
    launches: ChainedConfig[];
    waitOnEvent: ChainedEvents;
    detached: boolean;
    lifecycleManagedByParent: boolean;
    delayMs: number;
    overrides: {[key: string]: any};
    inherits: string[];
}
