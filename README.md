# Cortex Debug

![Visual Studio Code with Cortex-Debug Installed](./images/vs-code-screenshot.png)

Debugging support for ARM Cortex-M Microcontrollers with the following features:

* Highly configurable. See https://github.com/Marus/cortex-debug/blob/master/debug_attributes.md
* Support J-Link, OpenOCD GDB Server, STMicroelectronic's ST-LINK GDB server (no SWO support yet), pyOCD
* Initial support for the Black Magic Probe (This has not been as heavily tested; SWO can only be captured via a serial port)
* Partial support textane/stlink (st-util) GDB Servers (SWO can only be captured via a serial port)
* Multi-core and multi-session debugging. See https://github.com/Marus/cortex-debug/wiki/Multi-core-debugging
* Disassembly of source code available along with instruction level breakpoints and stepping. The actual disassembly window is provided and managed by VSCode. See https://github.com/Marus/cortex-debug/wiki/Disassembly-Debugging
* Cortex Core Register Viewer (integrated into Variables window since V1.2)
    * In some cases the st-util GDB server can report incomplete/incorrect registers, so there may be some issues here.
* SWO Decoding - "console" text output and binary data (signed and unsigned 32-bit integers, Q16.16 fixed point integers, single precision floating point values)
    * The registers that are part of the DWT, TPIU, and ITM debug components will automatically be configured and do not need to be set in firmware.
    * Firmware may still need to enable the SWO output pin - as this part of the setup is microcontroller dependant.
    * Decoding ETM data over the SWO pin is not currently supported.
* Live graphing of decoded ITM data.
* Support for Custom ITM Data Decoders:
    * Ability to define JavaScript modules to decode complex data formats streamed over one or more ITM ports. Data can be printed to a output window, or sent to the graphing system. If you are using TCP/IP instead, you can use a variety of tools to connect to the that port.
* Semi-hosting Support. In the `TERMINAL` tab, there will be a sub-window called `gdb-server`. That terminal is bidirectional and is intended for semi-hosting. This applies to those gdb-servers that do their semi-hosting on their stdio.
![](images/gdb-server.png)
* Support for SEGGER Real Time Trace (RTT) using OpenOCD and J-Link gdb-servers. All the features supported for SWO (text, binary, graphing) are also supported with RTT. See image above for console style output. SWO output also creates another section.
* Globals and Static scopes in the variables view
* Initial support for Rust code (most functionality is working; report any issues
* RTOS Thread Support in `CALL STACK` window (J-Link, OpenOCD, pyOCD - RTOS supported depend on GDB server)
    * As a general rule do not try to use stepping instructions before the scheduler of your RTOS has started - in many cases this tends to crash the GDB servers or leave it in an inconsistent state.
* Live Watch with supported GDB servers (tested with OpenOCD, J-Link, STLink so far - since V1.6)
* We have a set of extensions that this extension relies on for various frontend services (since V1.6)
  * These services are under the mcu-debug organization and lot of that content was re-factored from this extension to make them work with other debuggers and with browsers
  * Visit https://marketplace.visualstudio.com/search?term=mcu-debug&target=VSCode&category=All%20categories&sortBy=Relevance\
  * Highlights are a Memory Viewer, RTOS viewer, Peripheral (SVD) Viewer
  ![image](https://user-images.githubusercontent.com/41269583/227667748-599a7ad1-afa8-4fab-92a8-17c3da3b0fdd.png)<br>
  ![image](https://user-images.githubusercontent.com/41269583/227667788-df4bfcea-e4a1-4ea6-86a8-9cf70198817e.png)
  * These extensions are considered as dependency of this extension and VSCode should help you install all of them. We will consider make an `Extension Pack` in the future

### Release Versioning
Cortex-Debug uses a [versioning system specified by Microsoft](https://code.visualstudio.com/updates/v1_63#_pre-release-extensions) that allows distribution of pre-releases via the marketplace. You can enable (or disable) pre-releases within VSCode for this extension and you will automatically get new pre-releases. By default, pre-releases are disabled. We use pre-releases as allow testing of bug fixes and new features. They allow you participate during the formation of a feature of how an issue gets addressed. [More info about pre-releases](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#prerelease-extensions). To summarize, extensions use [semantic versioning (SemVer)](https://semver.org/) system which in simple terms is `major.minor.patch`. With MS convention, if the `minor` version is `odd`, then it is a pre-release.

### Planned Features
* Additional Graphing Options
* [Our TODO file](https://github.com/Marus/cortex-debug/blob/master/TODO.md)

## Installation

Requirements:

* ARM GCC Toolchain (https://developer.arm.com/open-source/gnu-toolchain/gnu-rm/downloads) - provides arm-none-eabi-gdb and related tools
* At least one of:
  * J-Link Software Tools - provides the J-Link GDB Server for J-Link based debuggers (https://www.segger.com/downloads/jlink)
  * OpenOCD - provides a GDB Server that can be used with a number of debuggers (http://openocd.org)
    * NOTE: If a chip vendor ships it's own OpenOCD version, for sure use NOTHING but that
    * NOTE: On macOS do not use the default version of OpenOCD provided by homebrew, this is not compatible with releases V0.2.4 and newer.
      * You can either install from source using homebrew (`brew install open-ocd --HEAD`) or the packages from https://github.com/xpack-dev-tools/openocd-xpack/releases/ will also work.
    * NOTE: Some linux versions and Windows may also need a more up-to-date version of OpenOCD from the xPack releases.
  * Texane's st-util GDB server - Only supports ST-Link Debug Probes (https://github.com/texane/stlink)
  * ST-LINK GDB server - This server is packaged with the [STM32CubeIDE](https://www.st.com/en/development-tools/stm32cubeide.html) which must be installed. The location of the STM32CubeIDE and related tools is automatically resolved but also can be overridden using configuration settings (`armToolchainPath`, `stm32cubeprogrammer` and `serverpath`).
  * pyOCD GDB Server - GDB server that supports the CMSIS-DAP debugger on a number of mbed boards (https://github.com/mbedmicro/pyOCD)
  * Black Magic Probe

## Usage

See https://github.com/Marus/cortex-debug/wiki for usage information. This needs some help from the community. See https://github.com/Marus/cortex-debug/blob/master/debug_attributes.md for a summary of all properties that are available in your `launch.json`

## How to Build from sources
* `git clone https://github.com/Marus/cortex-debug.git`
* `cd cortex-debug`
* Optionally switch to a branch: `git checkout <existing-branch-name>`
* `npm install`
* Optional `npm run compile`
* Open VSCode in the top folder and run the task `npm watch`. This will compile the code and watch for any changes and auto compile. The first time, it may take a minute or so for it to watch the entire folder. You can see the output of `npm watch` in the Terminal tab.

## How to debug
The extension is split into two main parts.
1) The front-end which is what you interact with mostly
2) The backend called `debug adapter` which interfaces between `gdb`, `vscode/front-end`, and the `gdb-server`. We just start the server and from then on the debug adapter only interacts with `gdb`. All requests go to `gdb` and the results are read back from `gdb` using `gdb`'s MI (machine interface)

If you want to debug both parts, in `launch.json` use the `Extension + Debug Server` configuration. It will launch a new window -- the `debuggee`. In the `debuggee` VSCode window, load a FW folder/workspace (VSCode remembers the last one) and add the following to `debuggee`'s `launch.json`.
```
            "debugServer": 4711
```
Now, launch a debug session and you wil be able to use the primary VSCode window to observe the Cortex-Debug extension

## Acknowledgments

Parts of this extension are based upon Jan Jurzitza's (WebFreak) code-debug extension (https://github.com/WebFreak001/code-debug).<br>
His project provided an excellent base for GDB MI parsing and interaction.
