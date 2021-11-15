ChangeLog

#V0.4.8
* Store register/peripheral settings in the appropriate folder instead of the first folder
* Kill gdb-server if the user kills/exits gdb without using the proper disconnect/Stop buttons/process/commands
* VSCode was terminating Cortex-Debug before it was done. st-util exit behavior was also not clean as it did not exit on a disconnect.
* Preliminary support for data watchpoints
* SVD now can allow no merge of consecutive addresses with a -1 specified for `svdAddrGapThreshold`. This will make peripheral updates very slow but certain devices may need this option.
* You can now save the output of a gdb-server into a text file by specifying `cortex-debug.dbgServerLogfile` in User/Workspace/Folder settings. This will save output from the servers from all sessions (not just the recent ones). This is primarily for debugging and for users when submitting issues.
* Pathnames for gdb-servers can be OS specific. For instance `cortex-debug.openocdPath` can be suffixed with one of `.linux`, `.osx` or `.windows`. For instance `cortex-debug.openocdPath.windows` is used only on Windows and if that is missing, it will default looking for cortex-debug.openocdPath`.
* SWO output can now be logged (saved) to a file just like RTT output
* Issues #524 and #525

#V0.4.7
* Fixed a regression for STLink gdbserver. It was in fact accidentally working in prior releases. The real bug is now fixed. Issue #494
* We may have **finally** found a way to exit OpenOCD without having to kill it and OpenOCD not hanging around after the session ends. This is of course dependent on OpenOCD behaving as documented. Thanks to #482 and @bohdan-tymkiv for a solution
* Timestamps for RTT and SWO have been standardized to be of the form `[ISO-Date-Time, +NNNNNNms]` where the first part is the date/time of day and the NNNNNNms is the number of milliseconds elapsed since the debug session began.
* `timestamp` is now an option for SWO console decoders. Default is `false`. A timestamp is output only when a newline is received or a timeout of 5 seconds

#V0.4.6
* Bugfix: Issue #493 In the previous release, we were trying to end OpenOCD using a SIGINT first and then SIGTERM. The way VSCode works, this did not work in production releases. Reverting back to the previous method of just using SIGTERM. Unfortunately. Still looking for a better method to end OpenOCD.

#V0.4.5
* Support for resume/suspend after Launch/Attach. With new UI features added to VSCode, the Stop button (after `Launch`) can now also be used for a Disconnect using keyboard shortcuts. The reverse is true when using an `Attach` type session. But this requires co-operation from the gdb-server to comply. Certain versions of OpenOCD do comply, JLink always seems to resume (see issue $481). Provided the gdb-server cooperates, the expected behavior now when you end a debug session is:
  * `Stop` will leave the program in a halted state
  * `Disconnect` will let the program continue
* You can now have RTT console output lines contain a timestamp. Use the `timestamp` option for the RTT decoder. Default is false (no timestamp)
* Issues #482 addressed for JLink. It always cleanly exits on it own. OpenOCD is still an issue where it has to be killed which once in a blue moon does not seem to work.
* Integrated PR #480 -- creates .vscode director if it doesn't exist for saving register/peripheral states.
* PRs #489, #490, #488, #478 submitted by @trond-snekvik merged. They fix issues and enhances your experience with Cortex-Debug in various ways. Thank you @trond-snekvik

# V0.4.4

New Features
* **Reset button**: There is now a button for resetting the device in the Debug Toolbar. This is distinct from the `Restart` button provided by VSCode framework. The `Reset` button does not trigger a rebuild but other than that, the behaviour *should* be the same. The customization commands for `Restart` are also used for `Reset`. Those are `preRestartCommands`, `overrideRestartCommands`, `postRestartCommands` and `postRestartSessionCommands`.

  <img src=https://user-images.githubusercontent.com/41269583/132694054-e4a2e085-132c-4bac-9c79-f5fdbdd9b1f8.png width=200 />

  * The only place we could put the `Reset` button was at the beginning. We would have rather put it closer to the end but there isn't an API to do that as far as we know. Note that the toolbar appears in docking and floating modes and it is the docking mode where this was not possible. Hopefully, it is not a hinderance.
  * `Restart` causes VSCode to clear the `Debug Console` but `Reset` does not do that as VSCode is not involved.
  * Some gdb-servers do not respond appropriately to being reset and are not compatible with `gdb` expectations. You will have to find out what set of gdb-server/gdb commands work for you and use appropriate options in the `launch.json`. For instance, just after 'reset halt' some versions of OpenOCD do not provide `gdb` the updated registers (SP, PC, LR, etc.). Some devices may have a more complicated, customized reset mechanism, boot-loaders, etc. To force a synchronization between `OpenOCD` and `gdb`, you can do the following in `launch.json`.
```
     "postRestartSessionCommands": [ // OpenOCD only
       "monitor gdb_sync",
       "stepi"    // Because of the command above, this is a no-op. No code is actually executed
     ]
```
* **`Run Without Debugging (^F5)`**: Experimental. This will now work but VSCode does not clearly define what this button should do. In an embedded cases, that is even murkier because without GDB and a gdb-server, there is no way to start the program. Between VSCode and Cortex-Debug, the end result is as follows
    * VSCode does not transmit any breakpoints to Cortex-Debug and hence no breakpoints
    * VSCode does show a pause button in active mode but pressing on it does nothing because that action is not sent to Cortex-Debug
    * `runToEntryPoint` and `breakAfterReset` options are disregarded
    * If the program halts because of an exception or any other reason, it is handled normally and now you will enter the normal debugger

* **Auto-continue**: New behavior. Operations `Launch`, `Reset`, and `Restart` will now issue a `continue` to gdb upon successful reset-halt. This is not done in the following cases
  * `runToEntryPoint` has been used for a `Launch` session or it is an `Attach` session
  * If a post-session-start commands (i.e., `postStartSessionCommands`, `postRestartSessionCommands`) are used; you can insert the `continue` command in there.
  * Or you have used the `"breakAfterReset" = true`

* `svdAddrGapThreshold` option in `launch.json`. Normally adjacent register addresses with small gaps are combined to reduce the number of (slow) device memory reads. Default is 16 bytes. You can now control the number of bytes the gap can be including zero. Zero means strict reading of bytes but adjacent registers are still combined.

* JLinkGDBServer will no longer display a graphical progress bar at `Launch`. If you need it, you can use the `-gui` command-line option in `launch.json`'s `serverArgs`

# V0.4.3

* Registers (CPU and Peripheral) now indicate with a highlighted value, which ones changed since last update
* Line-based Breakpoints now visually indicate which line a breakpoint is actually set when different from what was requested. Normal VSCode behavior is to revert back to the original line when debug session ends.
* Peripheral update will try to update as much as possible instead of bailing entire peripheral update after a single memory read failure. Failed reads are now indicated with `0xffffffff`

# V0.4.2

* Now you can toggle Hex mode for Registers and Variables independently from the Debug Panel.
  * The title bar of the Registers View contains a button to toggle between Hex and Natural modes

    <img src=https://user-images.githubusercontent.com/41269583/129577447-473bfbde-a748-441c-83f1-315c1568cb5a.png width="250" />
  * In the Variable Window, you can right click on any variable and it allows you to toggle the Hex mode. This setting applies also applies to Watch variables. Too bad we don't have access to the title bar and there is no good way of implementing a per-variable format

    <img src=https://user-images.githubusercontent.com/41269583/129577748-ffd64c20-4e0b-4508-9434-63cef9a74329.png width=250 />
* There is now a Refresh button in the title bars of the Registers and Peripheral Windows. The registers window, when refreshed will use the current stack/frame to retrieve the values.
* You can hover over a scalar variable name and get a tool-tip that gives you decimal, hex, octal and binary forms of the same.

  <img src=https://user-images.githubusercontent.com/41269583/129586732-71228fee-6d6c-4993-ac8f-c9ca93b7772f.png width=350 />
* Terminal input
  * Support for `Paste` in RTT in RTT terminals (See Issue #463)
  * Input entered into RTT Terminals can now have their encoding be use using the `iencoding` option for the `console` and `binary` encoders
* Global variables are now sorted in the Variables Windows. But all variables starting with double underscores `__` are pushed to the bottom.

# V0.4.1

Minor bug fix. The `launch.json` option `clearSearch` was not working for `rttConfig`. Only affected OpenOCD users.
# V0.4.0

This is a major release with a lot of changes and many new features. The `TERMINAL` area of VSCode is utilized a lot to enable bidirectional communication with the firmware. It is used for RTT, SWO and Semi-hosting.

New Features:
   * Support for RTT (SEGGER Real Time Trace) with OpenOCD and JLink. This RTT host side implementation has the following features. See https://github.com/Marus/cortex-debug/wiki/SEGGER-RTT-support for more details
       * If you are used to RTT tools from SEGGER, this implementation adds many features, especially if OpenOCD is your gdb-server
       * Setup of RTT is automatic by default. For this to work, your executable needs to have symbols so we can locate the address of the global variable `_SEGGER_RTT`
       * The start of the RTT control block contains a string that OpenOCD/JLinkGDBServer look for. If the address auto-detected, we clear out the string. This will help with cases where you might have stale information from a previous run.
       * For OpenOCD, you can customize the `polling_interval`, and the search string. The default `polling_interval` is 100ms as of today. 10ms seems more acceptable as a tradeoff between creating bus traffic and not losing/blocking data. If nothing changes in the MCU, then OpenOCD does not do much even if the interval is small.
       * It is perfectly fine to have Cortex-Debug enable RTT but not use any display features. This way you can use external tools (like JLink tools or custom ones)
       * You can plot RTT data just like you could with SWO. The setup in launch.json is identical. [See this comment](https://github.com/Marus/cortex-debug/issues/456#issuecomment-896021784).
       * **Channel sharing:** You can use the same RTT channels in multiple ways. Cortex-Debug reads the channel data from OpenOCD/JLink once and distributes to all subscribers (terminals & graphs & logfiles). For instance, you can plot a channel and also look at its binary data in a terminal. Just use two decoders with the same channel (actually called port) number.
       * Note: JLink RTT has a limitation that it can ONLY work with one channel (channel 0). There is another artifact with RTT channels where you may see output from a previous run at the very beginning.
       * Note: This implementation does not support Virtual Terminals that you see in the JLink RTTViewer. All output goes to the same terminal.
   * SWO console and binary decoded text data now appears in a "TERMINAL" tab instead in the "OUTPUT" tab
   * All gdb-server (OpenOCD, JLink, etc.) output is also in the "TERMINAL" tab. In there you can also interact with your semihosting
   * The terminals for all the features above have the following (optional) features
     * RTT and gdb-server terminals allow user input. Used to communicate with your FW
     * Set the prompt to be used (including no prompt)
     * Set label used for the terminal. This label is used to the far right where you can switch between terminals
     * In VSCode yuo can now drag a terminal window to the editor area or to on of the panels on the left
     * Your FW can emit ANSI escape sequences to set colors, font attributes, etc.
     * The terminal supports various `inputmode`s. The terminology was borrowed from age old Unix `stty`
       * `cooked` - Default: Line mode. This is the normal mode. Bash style line editing is supported. In this mode, the FW will not see your input until you press Enter/Return key.
       * `raw` - Zero input processing is done. Keys are sent to the FW as you type. The FW has to do any input processing it wishes to do. Not even backspace will work
       * `rawecho` - Minimal processing is done. The terminal will echo characters you type and as such handle the Enter/Return keys as well. However, input is still sent to the FW as you type with zero processing
       * `disabled` - No user input is allowed. This is useful when the FW is not expecting any input and for unidirectional Terminals.
   * `demangle` is on by default. You can turn it off in `launch.json`
   * Support in debugger for `Jump to Cursor`, thanks to [PR#417](https://github.com/Marus/cortex-debug/pull/417)
   * A change in this pre-release, you will see some debug information in the gdb-server console. You will also see messages output by the extension that are not part of the actual output in bright magenta. This will happen in all terminals (RTT, SWO and console)
   * WARNING: The `Adapter Output` window in the `OUTPUT` tab will go away. Replaced by the 'gdb-server' in the `TERMINAL` tab mentioned above.

A big thanks to Henrik Maier @hwmaier for helping me with the RTT feedback. Without that, it would have taken a lot longer and perhaps not as nice.
# V0.3.13

New Features:
   * `"external"` server type now supports SWO. It works in the following way depending on `"source"`
     * `"source": "probe"` -- We do not recommend this method as there are issues with File I/O buffering causing delays and stalls, especially on Windows. Use a `"socket"` instead. It will use a auto-created temporary file name.
       * On Windows, it will use normal file-io
       * On Linux/Mac, it will use an OS supported FIFO which is more efficient than a normal file
     * `"source": "socket"` (best option if available)
       * You MUST specify the `"swoPort": "[host:]port"` option in the `"swoConfig"`
     * `"source": "file"`, then the file specified by `"swoPath"` will be used. Same caveats as when`"source"` is `"probe"` but you have control over the file-name
   * `"openocd"` server type will now use a TCP port for SWO instead of file/fifo for a more reliable connection across all platforms. Port selection is automatically. You can still use a serial port in which case, `"source": "serial"`.
   * Support for `pyoocd` SWO over a TCP port. You can specify the SWO source as `probe`. This is rather new for `pyocd`, so it hasn't been extensively tested.

Bug fixes and minor changes:
   * Use the `pyocd` executable with `gdbserver` as first argument instead of the `pyocd-gdbserver` executable. This is a potentially breaking change but long overdue as the old use model has been deprecated by `pyocd`.
   * Few other minor changes

# V0.3.12

New Features:
   * Added a new `runToEntryPoint` `launch.json` option that takes a configurable name for the entry point instead of assuming main. This change deprecates  `runToMain` (while `runToMain` will still function currently it will likely be removed in the future; it is recommended to replace `"runToMain": true` with `"runToEntryPoint": "main"` in your `launch.json` configurations). This addresses issue [#389](https://github.com/Marus/cortex-debug/issues/389) - thanks to [manuargue](https://github.com/manuargue) for yet another contribution to the project.

Bug Fixes:
   * Fixed issues with P&E Micro GDB support when using SWD connection to the target - thanks [adamkulpa](https://github.com/adamkulpa) for the PR.
   * Fixed issues with being unable to set breakpoints in rust, assembly, and cortex-debug disassembly views on Visual Studio Code version 1.53

# V0.3.11

New Features:
   * Enable ChibiOS RTOS support for the J-Link server
   * Added additional details to the the register and field level hover tooltips in the peripheral register view.
# V0.3.10
This feature upgrades our VSCode dependency for the extension - as a result V0.3.10 will only support the Visual Studio Code version 1.52 and above.

Also wanted to call out the `gdbPath` user setting that was introduced at V0.3.8 (but not included in the changelog) - this allows users to override the complete path to GDB including the executable name - allowing the use of `gdb-multiarch`.

New Features:
   * Added support for Linux ARM hosts (both aarch64 and armhf) to the binary modules
   * Added the ability to pin certain peripherals in the Peripheral Register view so they remain at the top of the view. Thanks to [manuargue](https://github.com/manuargue) for the PR. This provides an alternate solution to issue [#370](https://github.com/Marus/cortex-debug/issues/370)
   * Added the ability to set `gdbPath` as an override in your launch.json file.

# V0.3.9

Bug fix

# V0.3.8
1. New Feature:
   * Added initial support for STMicroelectronic's official ST-LINK GDB server. This server is currently only supported on Windows as we are having difficulties with getting it to run inside the visual studio environment on Linux and Windows. Also, this GDB server does not currently support SWO output through the probe. Big thanks to hwmaier for their PR that provided most of this support.
   * Added a `gdbPath` user setting (settings.json) - this allows you to override the full GDB path including the executable name - allowing the use of `gdb-multiarch` for example. Note that currently this only exists in user settings.
2. Issues Fixed:
   * Updated binary modules to support current versions of VS Code, fixing the support for serial based SWO output - some older versions were also removed to download size. Currently this is supported on macOS (x64), Linux (x64) and Windows (x64, x86); support for Linux AArch64 and armhf architectures is coming soon.
   * Fixed Issue [#382](https://github.com/Marus/cortex-debug/issues/382) - GDB commands in configuration (such as postLaunchCommands) that had had quotation marks (") were not handled correctly when being passed to GDB
   * Fixed Issue [#374](https://github.com/Marus/cortex-debug/issues/374) - Breakpoints are not cleared in GDB when exiting a debug session - this can cause issues in GDB servers like J-Link that support flash breakpoints as they would not have a chance to remove the modifications made to the flash memory to support that feature.
   * Fixed issue with not being able to properly disable function break points

# V0.3.7
Minor bug fix release

1. New feature
   * Support for IAR produced elf files which just did not work with V0.3.6. They didn't quite work with earlier releases either. They are non-standard (kinda) compared to what gcc produced or what objdump documents
   * With the latest version of VSCode, there were too many popups coming. They are all harmless, but annoying. There were changed made to suppress these but they caused other problems. We may just have to live with those popups (that are non-modal and disappear after a while) until we figure out how VSCode has changed. May take a while
2. Issues Fixed
   * Fixed Issue [#273](https://github.com/Marus/cortex-debug/issues/273). Handle peripherals blocks with no addressBlocks. Also fix issue with multiple address blocks where only the first one was being used
   * Fixed Issue [#284](https://github.com/Marus/cortex-debug/issues/284). Implement/support 'derivedFrom' at register level.
   * Fixed Issue [#306](https://github.com/Marus/cortex-debug/issues/306). Support displaying more than 20 stack frames
   * When runToMain was enabled there were 1-2 harmless popups when the program stopped in main. They were very frequent on Windows, less frequent on Linux and very rare if any on a Mac.

# V0.3.6

Minor bug fix release

1. New feature
   * A performance improvement has been made at startup. It was taking 2-3 seconds to parse the symbols out of the elf file. It is now cut in half and the results are cached. When cached results are used, it takes a few milliseconds.
2. Issues fixed
   * Fixed Issue [#263](https://github.com/Marus/cortex-debug/issues/263). Static functions were not properly detected because of the differences in how gdb and objdump reported pathnames. It made things like step/next to not work. Much thanks to @Lykkeberg and @stalyatech for reporting and testing solutions
   * When using multiple processors, TCP ports should be allocated consecutively, remote chance of failures avoided
   * `serialport` binary module updated for latest Node.js/Electron
   * Watch and hovers caused too many popups. Something changed in VSCode. These are now suppressed. There were also popups when setting a breakpoint while program was running and single stepping too fast and these are now suppressed.
   * When `runToMain` was enabled, it caused a popup to appear for a failed stack trace. Again something changed in VSCode where it is requesting stack traces when program is not stopped.

# V0.3.5

This is a pretty big release. The biggest change is to address C++ (and maybe Rust) de-mangled names. It had a big effect on the overall code base especially with regards to how disassembly was provided. The separator `::` caused quite a few issues and there are strange and unexpected things in the symbol table. It can affect users not even using C++ or de-mangling.

1. Issues Fixed
   * Issue #232: SVD Enumerated types `derivedFrom` attribute now supported (used by ST quite a lot). Caused silent SVD parsing failures before and the Peripherals window said `No SVD File Loaded`.
   * Issue #229: Better handling of multiple anonymous unions and structs in the same data structure. Only the first one was shown previously, defect in VSCode really, but had to find a workaround.
   * Issue #179: Depending on how the compiler was used, only static variables declared in files in the current directory were being displayed. It was an issue with how `objdump` and `gdb` behaved differently. Not a perfect fix. Use Watch Window when in doubt and report any further issues and discrepancies.
   * Issues with `serialport` module: Updated to work with the latest version of VSCode/Electron. This will be an ongoing problem but hopefully, we can keep up with new releases of VSCode better in the future. When VSCode moves to a new version of Electron this extension has to be updated. For those adventurous enough, there is a script you can use to generate a compatible version yourself.
2. New Features
   * Preliminary support for C++ de-mangled names. In `launch.json`, there is now a configuration option `"demangle"` to enable de-mangling of symbols both by GDB and Cortex-Debug. We may remove this property in the future and demangle all the time. All users are encouraged to enable this to see if it affects debugging in a negative way. With C++, there can be a lot of issues related to overloading and templates. Please report issues.
   * There is a new `launch.json` configuration option `"serverArgs"` to add additional command-line arguments when launching any supported gdb-server (like J-Link, ST-LINK, etc.)
   * Could be classified as a bug-fix. Before, setting static variable values in the Variables Window did not work. Now, it should work as expected.
   * There were some performance enhancements done for loading the Variables window when Global or Static scopes were expanded. Noticeable when single-stepping in large executables.
   * New setting `flattenAnonymous` which will flatten anonymous structs/unions. Default=false
   * New setting `registerUseNaturalFormat` which will display registers either in Natural format or Hex: Default=true
   * The command `View Disassembly (Function)` now supports a regular expression as input. It will try an exact match for a function name first. But, it that fails treats the input string as a regular expression, and if the input string ends with `/i` it is treated as case-insensitive. As always, if there are multiple matches, you have to pick one.
   * You can now specify the `numberOfProcessors` and the `targetProcessor` to debug in `launch.json` when there are multiple cores/processors in the DAP chain. Cortex-Debug will allocate the required number of TCP ports and use the right one(s) for the processor. This has been tested with `pyOCD` and `OpenOCD`

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
2. There are now no SVD files bundled with the main Cortex-Debug extension; these SVD files added significant bulk to the download sizes for the main extension install and update while not being always needed and not changing often. The bundled SVD files will be separated out into separate "Device Support Pack" extensions that target particular microcontrollers (or families of microcontrollers); starting with packs for the STM32F1, STM32F4 and STM32L4 families that had been bundled previously. If you were using your own SVD file specified through the `svdFile` property in your `launch.json` then no configuration changes are needed, but if you were using one of the previously auto-detected SVD files through the `device` property then you will need to install the appropriate "Device Support Packs" (search for "Cortex-Debug" in the extension marketplace).

### Other Changes in V0.3.0
* Added support for formatting watch values; add the following format strings:
	* `b` - format in binary
	* `h` or `x` - format in hexadecimal
	* `d` - format in decimal
	* `o` - format in octal

	These format specifiers are appended to the end of the watch expression separated by a `,` - eg. `*(unsigned int *)(0x40011004),b` would display the contents at address `0x40011004` in binary.
* Changed core registers to be displayed using their "natural" formatting:
	* `rXX` in decimal
	* `sXX` in floating point
	* stack pointers (`sp`, `msp`, `psp`) in hexadecimal
	* program counter (`pc`) in hexadecimal with corresponding symbol location if available
	* xPSR/cPSR/Control in hexadecimal (this is overridden from the GDB defaults for those registers)

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
* Added ability to select value for matting in the Core and Peripheral Register Views (Right click and Select "Set Value Format")
* Preserve state for Core and Peripheral Register Views (Set format and expanded) from one debug session to the next.
* Syntax highlighting for the raw memory view.

# V0.1.13

* Enabled setting breakpoints in rust code
* Improved ITM console decoder
* Fixed ITM configuration GDB macros to work properly with rust code

# V0.1.12

* Fixed issues with parsing dimIndex elements in some SVD files.

# V0.1.11

* Improved SVD parsing:
    * Fields now support bit ranges being defined with <msb> and <lsb> elements; This would have impacted SVD files supplied by Nordic Semiconductor, Fujitsu and Spansion
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
	* You can force it to always disassemble through the "Cortex-Debug: Set Force Disassembly" command and selecting the "Forced" option.
* SWO Decoding has been significantly overhauled
	* It is now possible to use a serial port (such as a FTDI USB to UART) to capture SWO data, allowing the use of SWO output on probes that do not support it natively or have poor performance. To use this set the "source" key under "swoConfig" to the UART device (COM port on Windows).
	* The ITM, DWT and TPIU registers needed to match the configuration in the launch.json file will be set automatically; avoiding the need for your firmware to make the configurations. SWO output will still need to be enabled in your firmware though, as this part of the configuration is microcontroller specific.
	* A number of configuration options have changed; please edit your launch.json file
* Initial support for the Black Magic Probe has been added; this server has not been tested extensively yet, so there may still be some issues. SWO output through the probe is not currently support when using the Black Magic Probe.
* Fixed issue with Peripheral Register viewer not working after the first launch request
* Fixed a bug with the variables and watches view incorrectly updating the value on a struct/array when a contained element changed
* Updated the view memory output format to match the format used by the hexdump for VSCode extension (https://marketplace.visualstudio.com/items?itemName=slevesque.vscode-hexdump) - this will enable the syntax highlighting, and hopefully in the future the inspector, from that plugin.

# V0.1.9

* Added initial support for texane's STLINK utilities st-util GDB server (https://github.com/texane/stlink) - this configuration does not support SWO output.
* Enabled updating registers and fields (Read/Write or Write-Only in the SVD definition) in the Cortex Peripherals view - Right click on the register/field and select "Update"
* Enabled copying registers and fields values in the Cortex Peripherals and Cortex Registers Views - Right click on the register/field and select "Copy Value"

# V0.1.8

* Fixed possible freeze with memory viewer command and addresses above 0x80000000

# V0.1.6

* Improved parsing of SVD definitions (registers without fields; repeating registers (dim, dimInteger, dimIncrement))
* Added initial support for PyOCD GDB Server (SWO not supported)

# V0.1.5

* Initial Public Preview on VS Code Market Place
