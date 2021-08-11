| Attribute | Applies To | Description |
| --------- | ---------- | ----------- |
| cmsisPack | Common | Path to a CMSIS-Pack file. Use to add extra device support.
| cwd | Common | Path of project
| debuggerArgs | Common | Additional arguments to pass to GDB command line
| device | Common | Target Device Identifier
| executable | Common | Path of executable
| gdbPath | Common | This setting can be used to overrride the GDB path user/workspace setting for a particular launch configuration. This should be the full pathname to the executable (or name of the executable if it is in your PATH). Note that other toolchain executables with the configured prefix must still be available.
| graphConfig | Common | (unknown)
| interface | Common | Debug Interface type to use for connections (defaults to SWD) - Used for J-Link, ST-LINK and BMP probes.
| numberOfProcessors | Common | Number of processors/cores in the target device.
| overrideAttachCommands | Common | You can use this to property to override the commands that are normally executed as part of attaching to a running target. In most cases it is preferable to use preAttachCommands and postAttachCommands to customize the GDB attach sequence.
| overrideGDBServerStartedRegex | Common | You can supply a regular expression (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions) in the configuration property to override the output from the GDB server that is looked for to determine if the GDB server has started. Under most circumstances this will not be necessary - but could be needed as a result of a change in the output of a GDB server making it incompatible with cortex-debug. This property has no effect for bmp or external GDB server types.
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
| rtos | Common | RTOS being used. For JLink this can be FreeRTOS, embOS, Zephyr or the path to a custom JLink RTOS Plugin library. For OpenOCD this can be eCos, ThreadX, FreeRTOS, ChibiOS, embKernel, mqx, or uCOS-III.
| rttConfig | Common | SEGGER's Real Time Trace (RTT) and supported by JLink, OpenOCD and perhaps others in the future
| runToEntryPoint | Common | If enabled the debugger will run until the start of the given function.
| runToMain | Common | Deprecated: please use 'runToEntryPoint' instead.
| serverArgs | Common | Additional arguments to pass to gdb-server command line
| serverpath | Common | This setting can be used to override the gdb-server path user/workspace setting for a particular launch configuration. It is the full pathname to the executable or name of executable if it is in your PATH
| servertype | Common | GDB Server type - supported types are jlink, openocd, pyocd, pe, stlink, stutil, qemu and external
| showDevDebugOutput | Common | Prints all GDB responses to the console
| showDevDebugTimestamps | Common | Show timestamps when 'showDevDebugOutput' is true
| svdFile | Common | Path to an SVD file describing the peripherals of the microcontroller; if not supplied then one may be selected based upon the 'device' entered.
| swoConfig | Common | (unknown)
| targetId | Common | On BMP this is the ID number that should be passed to the attach command (defaults to 1); for PyOCD this is the target identifier (only needed for custom hardware)
| targetProcessor | Common | The processor you want to debug. Zero based integer index. Must be less than 'numberOfProcessors'
| toolchainPrefix | Common | This setting can be used to override the toolchainPrefix user setting for a particular launch configuration.
| BMPGDBSerialPort | BMP Specific | The serial port for the Black Magic Probe GDB server. On Windows this will be "COM<num>", on Linux this will be something similar to /dev/ttyACM0, on OS X something like /dev/cu.usbmodemE2C0C4C6 (do not use tty versions on OS X)
| powerOverBMP | BMP Specific | Power up the board over Black Magic Probe. "powerOverBMP" : "enable" or "powerOverBMP" : "disable". If not set it will use the last power state.
| demangle | C++ specific | Experimental: If enabled the debugger will demangle C++ names.
| gdbTarget | External | For externally controlled GDB servers you must specify the GDB target to connect to. This can either be a "hostname:port" combination or path to a serial port
| ipAddress | J-Link Specific | IP Address for networked J-Link Adapter
| jlinkscript | J-Link Specific | J-Link script file - optional input file for customizing J-Link actions.
| serialNumber | J-Link Specific | J-Link or ST-LINK Serial Number - only needed if multiple J-Links/ST-LINKs are connected to the computer
| configFiles | OpenOCD Specific | OpenOCD configuration file(s) to load
| openOCDLaunchCommands | OpenOCD Specific | OpenOCD commands after config. files are loaded (-c options)
| openOCDPreConfigLaunchCommands | OpenOCD Specific | OpenOCD commands before config. files are loaded (-c options)
| searchDir | OpenOCD Specific | OpenOCD dir to search for config files and scripts
| boardId | PyOCD Specific | PyOCD Board Identifier. Needed if multiple compatible boards are connected.
| cpu | QEMU Specific | CPU Type Selection - used for QEMU server type
| machine | QEMU Specific | Machine Type Selection - used for QEMU server type
| stm32cubeprogrammer | ST-LINK GDB server specific | This path is normally resolved to the installed STM32CubeIDE or STM32CubeProgrammer but can be overridden here.
| v1 | StUtil Specific | For st-util only. Set this to true if your debug probe is a ST-Link V1 (for example, the ST-Link on the STM32 VL Discovery is a V1 device). When set to false a ST-Link V2 device is used.
