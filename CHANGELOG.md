# V0.3.5-beta

This is a pretty big release. The biggest change is to address C++ (and maybe Rust) de-mangled names. It had a big effect on the overall code base especially with regards to how disassembly was provided. The separator `::` caused quite a few issues and there are strange an un-expected things in the symbol table. It can affect users not even using C++ or de-mangling. Wish there was a way to publish beta releases in VSCode

1. Issues Fixed
   * Issue #232: SVD Enumerated types `derivedFrom` attribute now supported (used by ST quite a lot). Caused silent SVD parsing failures before and the Peripherals window said `No SVD File Loaded`.
   * Issue #229: Better handling of multiple anonymous unions and structs in the same data structure. Only the first one was shown previously, defect in VSCode really, but had to find a workaround.
   * Issue #179: Depending on how the compiler was used, only static variables declared in files the current directory were being displayed. It was an issue with how `objdump` and `gdb` behaved differently. Not a perfect fix. Use Watch Window when in doubt and report any further issues and discrepancies.
2. New Features
   * Preliminary support for C++ de-mangled names. In `launch.json`, there is now a configuration option `"demangle"` to enable de-mangling of symbols both by GDB and Cortex-Debug. We may remove this property in the future and demangle all the time. All users are encouraged to enable this to see if affects debugging in a negative way. With C++, there can be a lot of issues related to overloading and templates. Please report issues.
   * There is a new `launch.json` configuration option `"serverArgs"` to add additional command-line arguments when launching any supported gdb-server (like J-Link, STlink, etc.)
   * Could be classified as a bug-fix. Before, setting static variable values in the Variables Window did not work. Now, it should work as expected.
   * There were some performance enhancements done for loading the Variables window when Global or Static scopes were expanded. Noticeable when single-stepping in large executables.
   * New setting `flattenAnonymous` which will flatten anonymous structs/unions. Default=false
   * New setting `registerUseNaturalFormat` which will display registers either in Natural format or Hex: Default=true
   * The command `View Disassembly (Function)` now supports a regular expression as input. It will try an exact match for a function name first. But, it that fails treats the input string as a regular expression, and if the input string ends with `/i` it is treated as case-insensitive. As always, if there are multiple matches, you have to pick one.

# V0.3.4

* Fixed an issue where in an attach type debug session, if the disconnect button was used to end debugging, the gdb-server (like OpenOCD) kept running preventing a future attach/launch from starting until the server was killed manually.

# V0.3.3

1. New Features
   * Added `postStartSessionCommands` and `postRestartSessionCommands` configuration options to `launch.json`. These gdb commands are executed after a debug session has (re)started. These options apply to both `launch` and `attach` sessions. However, `postStartSessionCommands` is ignored if `runToMain` is enabled. See [Issue 197](https://github.com/Marus/cortex-debug/issues/197). You can use this feature to issue a `continue` or request a gdb-server like OpenOCD to perform a sync, etc.
   * Added `openOCDPreConfigLaunchCommands` configuration option to `launch.json`. This is similar to `openOCDLaunchCommands` but are executed before any OpenOCD config files are loaded.
   * Added the ability to use an expression for the start address of a memory window. This can be any valid expression understood by GDB
2. There are several changes related to RTOS thread aware debugging. In general, the experience is much better but we have become aware that many gdb-servers are not fully compliant or get out of sync with gdb and thus Cortex-Debug. This is especially true at the (re)start of a debug session.
   * Better tracking of thread creation/exiting and the entire program exiting
   * When the debugger pauses due to any reason, the proper thread is highlighted in the Call Stack Window
   * Variables and Watch windows better track the current thread/frame. Same is true for hover and REPL; expressions evaluate in the context of the currently selected thread/frame in the Call Stack Window.
3. The gdb-server (like OpenOCD/pyocd) now starts in the same directory as the `cwd` option in `launch.json`. Before, it was undefined.
4. Fixed a crash if an SVD peripheral had no registers. Issue [#208](https://github.com/Marus/cortex-debug/issues/208)
5. Fixed an issue where setting a variable was not working in the Variables Window. There may still be an issue with file static variables.

# V0.3.0

## NOTE: Cortex-Debug is now only compatible with Visual Studio Code V1.34.0 or newer.

**NOTE: V0.3.0 has a few backwards incompatible changes that may require you to update your `launch.json` file.**
1. The deprecated launch configuration types (`jlink-gdb`, `openocd-gdb`, `pyocd-gdb`, `stutil-gdb`, and `pe-gdb`) have now been removed - all launch configurations for Cortex-Debug should now use the `cortex-debug` type.
2. There are now no SVD files bundled with the main Cortex-Debug extension; these SVD files added significant bulk to the download sizes for the main extension install and update while not being always needed and not changing often. The bundled SVD files will be separated out into separate "Device Support Pack" extensions that target particular microcontrollers (or families of microcontrollers); starting with packs for the STM32F1, STM32F4 and STM32L4 families that had been bundled previously. If you were using your own SVD file specified through the `svdFile` property in your `launch.json` then no configuration changes are needd, but if you were using one of the previously auto-detected SVD files through the `device` property then you will need to install the appropriate "Device Support Packs" (search for "Cortex-Debug" in the extension marketplace).

### Other Changes in V0.3.0
* Added support for formatting watch values; add the following format strings:
	* `b` - format in binary
	* `h` or `x` - format in hexadecimal
	* `d` - format in decimal
	* `o` - format in octal
	
	These format sepecifiers are appended to the end of the watch expression separated by a `,` - eg. `*(unsigned int *)(0x40011004),b` would display the contents at address `0x40011004` in binary.
* Changed core registers to be displayed using their "natural" formatting:
	* `rXX` in decimal
	* `sXX` in floating point
	* stack pointers (`sp`, `msp`, `psp`) in hexidecimal
	* program counter (`pc`) in hexidecimal with corresponding symbol location if available
	* xPSR/cPSR/Control in hexidecimal (this is overridden from the GDB defaults for those registers)

	Note that with this change the ability to set formatting for these registers has been disabled; a more flexible formatting solution will be re-added in the future. You can also use a Watch expression for a register to the desired $reg,format to get the format you desire. For instance `$r0,x` will display the register value of `r0` in hexadecimal format.
* Major refactor of the code for the Core Register and Peripheral Register displays; along with bringing (hopefully) improved formatting and UX to this views will make the code much easier to maintain and expand in the future.
* The SWO grapher view should now be functional again on newer of VSCode. This view is now also theme aware and will adapt the colour scheme for standard elements to work with your theme (you still need to provide appropriate colours for your plots in the graph config).
* Extension code is now bundled for faster load time and smaller installs

# V0.2.7

* Added new `servertype` of external for cases where you want to control the GDB server yourself. This could be used for cases where you need to run the GDB server on a different machine, or in cases where there are multiple target cores which may cause the debug server to not operate as expected by cortex-debug. This configuration may require more customizations to the launch.json file than other more automated server types. When this `servertype` is selected a value for the `gdbTarget` launch.json property must be supplied.
* Added new launch.json options (overrideLaunchCommands, overrideRestartCommands and overrideAttachCommands) to be able to override the default commands run on those operations. In most cases this is not needed, but may be required for `external` server types (by default commands that are compatible with openocd are used for `external` server types).
* Add a `overrideGDBServerStartedRegex` launch.json configuration option - this allows you to provide the system with an alternative regular expression to detect that the GDB server has completed launching and is ready to accept connections. In most cases this will be need - but may be useful in cases where the debug servers output has changed and is no longer recognized.
* Major upgrade to the system for finding free ports to use (big thanks to https://github.com/haneefdm for his work on this); should fix recurring problems with port number collisions (e.g. 117(https://github.com/Marus/cortex-debug/issues/117)).
* Updates to PyOCD to enable support for CMSIS-Pack specification (added in PyOCD v0.16.0) - thanks to https://github.com/pelrun for this improvement

# V0.2.6

* Updated watch var name generation to avoid problems with certain expressions containing reserved characters/strings. Should fix issue [159](https://github.com/Marus/cortex-debug/issues/159) and partially fix [157](https://github.com/Marus/cortex-debug/issues/157).

# V0.2.5

* Updated PyOCD start detection to work with newer versions - Fixes issue [165](https://github.com/Marus/cortex-debug/issues/165)

# V0.2.4

* Updated some embedded SVD files (Thanks https://github.com/clementperon for your PR)
* Fixed parsing of some SVD files (Issue [126](https://github.com/Marus/cortex-debug/issues/126) - Thanks https://github.com/mryndzionek for your PR)
* Fixed issues with race condition on start up and improved OpenOCD support; Should fix issues [147](https://github.com/Marus/cortex-debug/issues/147), [149](https://github.com/Marus/cortex-debug/issues/149) and [150](https://github.com/Marus/cortex-debug/issues/150). A huge thanks to https://github.com/haneefdm for this PR, and his ongoing support on the project.
* Ability to specify port ranges used (Thanks https://github.com/blckmn for your PR)

# V0.2.2

* Fixed issues with serial port source for SWO data (Currently only working on macOS and Linux; Windows support will be restored soon)
* Extension now requires VS Code 1.29 or newer

# V0.2.1

* Fixed issues with variable substitution
* Fixed issues with blocking run if executable doesn't exist and may be created by the preLaunchTask

# V0.2.0

* Work around for some issues introduced with VSCode 1.29
* Added initial support for PE Micro Debug Interfaces (Special thanks to https://github.com/danebou for your PR)
* Fixed a number of bugs with the peripheral view - hopefully registers will be updating properly now (note that you can no longer just select a node to expand, you must click on the expand/collapse arrow)

# V0.1.21

* Fixed issue with people sometimes not being able to set new breakpoints after launching. Special thanks to @xiaoyongdong for his fix and @microwavesafe for his help in testing.

# V0.1.20

* Fixed issue with setting breakpoints while the target is running
* Fixed issues with the 'Add to Watch' and 'Copy Expression' options in the variable view
* Fixed issues with parsing some Atmel SVD files (Thanks to https://github.com/ivankravets for your PR)
* Allow overriding the armToolchainPath setting on a per lunch configuration basis

# V0.1.19

* Updated command names for JLink - newer versions of JLink rename the GDB server on Linux and macOS to JLinkGDBServerCLExe - this update searches for both the new JLinkGDBServerCLExe name and, if not found, falls back to the old JLinkGDBServer name.

# V0.1.18

* Fixed bug with the restart command if the target was currently in a running state.
* Added add a runToMain setting to launch debug requests (not applicable to attach requests).
* Added a searchDir setting for OpenOCD GDB server that allows specifying what directories to search for OpenOCD configuration files. Thanks https://github.com/KaDw

# V0.1.17

* Improved highlighting in the raw memory view
* Workaround for an issue with *enumeratedValue* having *isDefault* instead of a *value*

# V0.1.16

* Fixed a bug where it may not detect that a port is in use and get a port conflict when starting the GDB server.

# V0.1.15

* RTOS Support (configured through the rtos property in your launch.json file)
    * Depends on support from GDB Server - currently only J-Link and OpenOCD provide support for RTOS (supported RTOS varies)
	* In general if you have RTOS support enabled you should not perform stepping operations before the RTOSs data structures/scheduler have been initialized. Doing so tends to either crash the GDB server or leave it in an inconsistent state which will prevent proper functionality. If you need to debug startup code before the RTOS has been completely initialized then you should disable RTOS support.
* Some basic telemetry has been added
    * This telemetry has been added to help me determine what/how features are being used to help me better determine future feature development/improvements.
	* No information about your projects source code is collected - only information directly related to the use of cortex-debug is collected. For example the following is collected:
	    * Number/length of debugging sessions
		* Specific features used (peripheral register view, disassembly view, rtos support, memory view, SWO decoding, Graphing, etc.)
		* Certain errors within the extension are reported
		* GDB Server Used
		* Target device (if entered in launch.json)
		* Extension Version
		* Visual Studio Code Version
		* Visual Studio Code Platform
	* The information collected is not user-identifiable.
	* You can disable all telemetry reporting through the following user/workspace settings:
		* setting **telemetry.enableTelemetry** to false (this will disable telemetry for VS Code and other extensions that respect this setting)
		* setting **cortex-debug.enableTelemetry** to false (this will disable telemetry just for Cortex-Debug)
* Improved support for customizing the launch, attach and restart processes. In most cases these parameters can simply be ignored - but for added flexibility the following settings in your launch.json file can be provided
	* preLaunchCommands/preAttachCommands - these are executed near the start of the main launch/attach sequence (immediately after attaching to the target)
	* postLaunchCommands/postAttachCommands - these are executed at the end of the main launch/attachSequence
	* preRestartCommands - these are executed at the start of the restart sequence (immediately following interrupting the processor)
	* postRestartCommands - these are executed at the end of the restart sequence
* Fixes for advanced SWO Decoders

# V0.1.14

* Workaround for issues with st-util GDB server on Windows environment
* Added ability to select value for matting in the Core and Preipheral Register Views (Right click and Select "Set Value Format")
* Perserve state for Core and Peripheral Register Views (Set format and expanded) from one debug session to the next.
* Syntax highlighting for the raw memory view.

# V0.1.13

* Enabled setting breakpoints in rust code
* Improved ITM console decoder
* Fixed ITM configuration GDB macros to work properly with rust code

# V0.1.12

* Fixed issues with parsing dimIndex elements in some SVD files.

# V0.1.11

* Improved SVD parsing:
    * Fields now support bit ranges being defined with <msb> and <lsb> elements; This would have impacted SVD files supplied by Nordi Semiconductor, Fujitsu and Spansion
	* Improved support for repeating fields/registers for "array" style repeats, versus explicitly named repeats; This would have impacted SVD files supplied by Nordic Semiconductor, Microchip/Atmel, and some of NXP's LPC line
	* Support for register clusters, to group multiple closely related registers, within peripherals; This would have impacted SVD files supplied by Nordic Semiconductor and Microchip/Atmel
	* Fixed issue with values being displayed as if they were signed.
	* Improved display of Write-Only registers
* Improved behaviour with the Disassembly View:
	* Manual triggered disassembly names will now match those automatically generated by missing source/forced disassembly mode - prevents it from opening two copies of the disassembly.
	* If there are multiple functions with the same symbol name (two static functions with the same name in two different compilation units) you can now choose between them when manually opening a disassembly view.
	* If you are focused on a manual disassembly view for the current frame the debugger will use instruction level stepping, instead of source line level stepping.
* Added a "postLaunchCommands" property to the supported launch.json properties. This should be an array of GDB commands to send after the main launch/attach sequence (you do not need to include things like "target extended-remote ...", "load", or "monitor reset" as these are generated automatically).

# V0.1.10

* The update has a significant refactoring of code to make supporting the expanding list of GDB Servers more feasible. From the user side this necessitates updating your launch.json files as all debug types have now been combined into one common *cortex-debug* type
    * The typical changes needed are to replace *"type": "<server>-gdb" in your launch.json file with "type": "cortex-debug" and "servertype" : "<server>";
	* The extension will attempt to map old configurations automatically - but this may not work in all cases; additionally there launch.json editor will not recognize the old types any more
	* You no longer specify paths to the individual tools in your launch.json file; now there are settings you can set (either user level or workspace level) for paths to the individual GDB servers as well as the arm toolchain. For the arm toolchain path the setting should point to the toolchains bin directory - not an individual executable - as multiple tools from the toolchain are now used (current arm-none-eabi-gdb and arm-none-eabi-objdump; but possibly others in the future)
* A globals and static scope has been added to the variables view
* A disassembly view has been added. This can show up in three possible ways:
    * You can manually view the disassembly for a particular function by selecting the "Cortex-Debug: View Disassembly (Function) command from the command palette and entering the function name. (While you can view the disassembly in this case, stepping will still be based upon source lines currently)
	* If the source file cannot be located it will automatically disassemble and display the current function (In this case stepping is by instruction)
	* You can force it to always disassembe through the "Cortex-Debug: Set Force Disassembly" command and selecting the "Forced" option.
* SWO Decoding has been significantly overhauled
	* It is now possible to use a serial port (such as a FTDI USB to UART) to capture SWO data, allowing the use of SWO output on probes that do not support it natively or have poor performance. To use this set the "source" key under "swoConfig" to the UART device (COM port on Windows).
	* The ITM, DWT and TPIU registers needed to match the configuration in the launch.json file will be set automatically; avoiding the need for your firmware to make the configurations. SWO output will still need to be enabled in your firmware though, as this part of the configuration is microcontroller specific.
	* A number of configuration options have changed; please edit your launch.json file
* Inital support for the Black Magic Probe has been added; this server has not been tested extensively yet, so there may still be some issues. SWO output through the probe is not currently support when using the Black Magic Probe.
* Fixed issue with Peripheral Register viewer not working after the first launch request
* Fixed a bug with the variables and watches view incorrectly updating the value on a struct/array when a contained element changed
* Updated the view memory output format to match the format used by the hexdump for VSCode extension (https://marketplace.visualstudio.com/items?itemName=slevesque.vscode-hexdump) - this will enable the syntax highlighting, and hopefully in the future the inspector, from that plugin.

# V0.1.9

* Added initial support for texane's stlink utilites st-util GDB server (https://github.com/texane/stlink) - this configuration does not support SWO output.
* Enabled updating registers and fields (Read/Write or Write-Only in the SVD defintion) in the Cortex Peripherals view - Right click on the register/field and select "Update"
* Enabled copying registers and fields values in the Cortex Peripherals and Cortex Registers Views - Right click on the register/field and select "Copy Value"

# V0.1.8

* Fixed possible freeze with memory viewer command and addresses above 0x80000000

# V0.1.6

* Improved parsing of SVD definitions (registers without fields; repeating registesr (dim, dimInteger, dimIncrement))
* Added initial support for PyOCD GDB Server (SWO not supported)

# V0.1.5

* Initial Public Preview on VS Code Market Place
