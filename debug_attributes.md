The following attributes (properties) can be used in your launch.json to control various aspects of debugging.
Besides these attributes, you can also have `cortex-debug` User/Workspace settings that can apply to all cortex-debug sessions.
Use VSCode Settings to manage the User/Workspace Cortex-Debug extension settings.
Also using IntelliSense while editing launch.json in VSCode can be quite helpful.
| Attribute | Applies To | Description |
| --------- | ---------- | ----------- |
| breakAfterReset | Common | Applies to Restart/Reset/Launch, halt debugger after a reset. Ignored if `runToEntryPoint` is used.
| chainedConfigurations | Common | (unknown)
| cwd | Common | Directory to run commands from
| debuggerArgs | Common | Additional arguments to pass to GDB command line
| device | Common | Target Device Identifier
| executable | Common | Path of executable for symbols and program information. See also `loadFiles`, `symbolFiles`
| gdbPath | Common | This setting can be used to override the GDB path user/workspace setting for a particular launch configuration. This should be the full pathname to the executable (or name of the executable if it is in your PATH). Note that other toolchain executables with the configured prefix must still be available.
| graphConfig | Common | (unknown)
| interface | Common | Debug Interface type to use for connections (defaults to SWD) - Used for J-Link, ST-LINK and BMP probes.
| loadFiles | Common | List of files (hex/bin/elf files) to load/program instead of the executable file. Symbols are not loaded (see `symbolFiles`). Can be an empty list to specify none. If this property does not exist, then the executable is used to program the device
| name | Common | ????
| numberOfProcessors | Common | Number of processors/cores in the target device.
| objdumpPath | Common | This setting can be used to override the objdump (used to find globals/statics) path user/workspace setting for a particular launch configuration. This should be the full pathname to the executable (or name of the executable if it is in your PATH). Note that other toolchain executables with the configured prefix must still be available. The program 'nm' is also expected alongside
| overrideAttachCommands | Common | You can use this to property to override the commands that are normally executed as part of attaching to a running target. In most cases it is preferable to use preAttachCommands and postAttachCommands to customize the GDB attach sequence.
| overrideGDBServerStartedRegex | Common | You can supply a regular expression (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions) in the configuration property to override the output from the GDB Server that is looked for to determine if the GDB Server has started. Under most circumstances this will not be necessary - but could be needed as a result of a change in the output of a GDB Server making it incompatible with cortex-debug. This property has no effect for bmp or external GDB Server types.
| overrideLaunchCommands | Common | You can use this to property to override the commands that are normally executed as part of flashing and launching the target. In most cases it is preferable to use preLaunchCommands and postLaunchCommands to customize the GDB launch sequence.
| overrideRestartCommands | Common | You can use this to property to override the commands that are normally executed as part of restarting the target. In most cases it is preferable to use preRestartCommands and postRestartCommands to customize the GDB restart sequence.
| postAttachCommands | Common | Additional GDB Commands to be executed after the main attach sequence has finished.
| postLaunchCommands | Common | Additional GDB Commands to be executed after the main launch sequence has finished.
| postRestartCommands | Common | Additional GDB Commands to be executed at the end of the restart sequence.
| postRestartSessionCommands | Common | Additional GDB Commands to be executed at the end of the re-start sequence, after a debug session has already started.
| postStartSessionCommands | Common | Additional GDB Commands to be executed at the end of the start sequence, after a debug session has already started and runToEntryPoint is not specified.
| preAttachCommands | Common | Additional GDB Commands to be executed at the start of the main attach sequence (immediately after attaching to target).
| preLaunchCommands | Common | Additional GDB Commands to be executed at the start of the main launch sequence (immediately after attaching to target).
| preRestartCommands | Common | Additional GDB Commands to be executed at the beginning of the restart sequence (after interrupting execution).
| request | Common | ????
| rtos | Common | RTOS being used. For JLink this can be Azure, ChibiOS, embOS, FreeRTOS, NuttX, Zephyr or the path to a custom JLink RTOS Plugin library. For OpenOCD this can be ChibiOS, eCos, embKernel, FreeRTOS, mqx, nuttx, ThreadX, uCOS-III, or auto.
| rttConfig | Common | SEGGER's Real Time Trace (RTT) and supported by JLink, OpenOCD and perhaps others in the future
| runToEntryPoint | Common | Applies to Launch/Restart/Reset, ignored for Attach. If enabled the debugger will run until the start of the given function.
| runToMain | Common | Deprecated: please use 'runToEntryPoint' instead.
| serverArgs | Common | Additional arguments to pass to GDB Server command line
| serverCwd | Common | ????
| serverpath | Common | This setting can be used to override the GDB Server path user/workspace setting for a particular launch configuration. It is the full pathname to the executable or name of executable if it is in your PATH
| servertype | Common | GDB Server type - supported types are jlink, openocd, pyocd, pe, stlink, stutil, qemu, bmp and external
| showDevDebugOutput | Common | Used to debug this extension. Prints all GDB responses to the console. 'raw' prints gdb responses, 'parsed' prints results after parsing, 'both' prints both. 'vscode' shows raw and VSCode interactions
| showDevDebugTimestamps | Common | Show timestamps when 'showDevDebugOutput' is enabled
| svdAddrGapThreshold | Common | If the gap between registers is less than this threshold (multiple of 8), combine into a single read from device. -1 means never combine registers and is very slow
| svdFile | Common | Path to a CMSIS SVD file describing the peripherals of the microcontroller; if not supplied then one may be selected based upon the 'device' entered.
| swoConfig | Common | (unknown)
| symbolFiles | Common | List of ELF files to load symbols from instead of the executable file. Program information is ignored (see `loadFiles`). Can be an empty list to specify none. If this property does not exist, then the executable is used for symbols
| targetId | Common | On BMP this is the ID number that should be passed to the attach command (defaults to 1); for PyOCD this is the target identifier (only needed for custom hardware)
| targetProcessor | Common | The processor you want to debug. Zero based integer index. Must be less than 'numberOfProcessors'
| toolchainPrefix | Common | This setting can be used to override the toolchainPrefix user setting for a particular launch configuration.
| BMPGDBSerialPort | BMP Specific | The serial port for the Black Magic Probe GDB Server. On Windows this will be "COM<num>", on Linux this will be something similar to /dev/ttyACM0, on OS X something like /dev/cu.usbmodemE2C0C4C6 (do not use tty versions on OS X)
| powerOverBMP | BMP Specific | Power up the board over Black Magic Probe. "powerOverBMP" : "enable" or "powerOverBMP" : "disable". If not set it will use the last power state.
| gdbTarget | External | For externally controlled GDB Servers you must specify the GDB target to connect to. This can either be a "hostname:port" combination or path to a serial port
| ipAddress | J-Link Specific | IP Address for networked J-Link Adapter
| jlinkscript | J-Link Specific | J-Link script file - optional input file for customizing J-Link actions.
| serialNumber | J-Link Specific | J-Link or ST-LINK Serial Number - only needed if multiple J-Links/ST-LINKs are connected to the computer
| configFiles | OpenOCD Specific | OpenOCD/PE GDB Server configuration file(s) to use when debugging (OpenOCD -f option)
| openOCDLaunchCommands | OpenOCD Specific | OpenOCD command(s) after configuration files are loaded (-c options)
| openOCDPreConfigLaunchCommands | OpenOCD Specific | OpenOCD command(s) before configuration files are loaded (-c options)
| searchDir | OpenOCD Specific | OpenOCD directories to search for config files and scripts (-s option). If no search directories are specified, it defaults to the configured cwd.
| boardId | PyOCD Specific | PyOCD Board Identifier. Needed if multiple compatible boards are connected.
| cmsisPack | PyOCD Specific | Path to a CMSIS-Pack file. Use to add extra device support.
| cpu | QEMU Specific | CPU Type Selection - used for QEMU server type
| machine | QEMU Specific | Machine Type Selection - used for QEMU server type
| stm32cubeprogrammer | ST-LINK GDB server specific | This path is normally resolved to the installed STM32CubeIDE or STM32CubeProgrammer but can be overridden here.
| v1 | StUtil Specific | For st-util only. Set this to true if your debug probe is a ST-Link V1 (for example, the ST-Link on the STM32 VL Discovery is a V1 device). When set to false a ST-Link V2 device is used.
