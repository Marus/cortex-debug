# Cortex Debug

![Visual Studio Code with Cortex-Debug Installed](./images/vs-code-screenshot.png)

Debugging support for ARM Cortex-M Microcontrollers with the following features:

* Support J-Link, OpenOCD GDB Server
* Initial support for STMicroelectronic's ST-LINK GDB server (no SWO support yet)
* Partial support for PyOCD and textane/stlink (st-util) GDB Servers (SWO can only be captured via a serial port)
* Initial support for the Black Magic Probe (This has not been as heavily tested; SWO can only be captured via a serial port)
* Cortex Core Register Viewer
    * In some cases the st-util GDB server can report incomplete/incorrect registers, so there may be some issues here.
* Peripheral Register Viewer (Defined through standard SVD file)
* SWO Decoding - "console" text output and binary data (signed and unsigned 32-bit integers, Q16.16 fixed point integers, single percision floating point values)
    * The registers that are part of the DWT, TPIU, and ITM debug components will automatically be configured and do not need to be set in firmware.
    * Firmware may still need to enable the SWO output pin - as this part of the setup is microcontroller dependant.
    * Decoding ETM data over the SWO pin is not currently supported.
* Support for Custom ITM Data Decoders:
    * Ability to define JavaScript modules to decode complex data formats streamed over one or more ITM ports. Data can be printed to a output window, or sent to the graphing system.
* Live graphing of decoded ITM data.
* Raw Memory Viewer ("Cortex-Debug: View Memory" command)
* Ability to view and step through the disassembled binary. There are three ways that disassembled code will be shown:
    * Disassembly code will automatically be shown if it cannot locate the corresponding source code.
    * You can manually see the disassembly for a particular function ("Cortex-Debug: View Disassembly (Function)" command)
    * You can set the debugger to always show show disassembly ("Cortex-Debug: Set Force Disassembly" command)
* Globals and Static scopes in the variables view
* Initial support for Rust code (most functionality is working; disassembly views and variables view may still have issues)
* RTOS Support (J-Link and OpenOCD - RTOS supported depends on GDB server support)
    * As a general rule do not try to use stepping instructions before the scheduler of your RTOS has started - in many cases this tends to crash the GDB servers or leave it in an inconsistent state.


### Planned Features

* Additional Graphing Options
* Enhanced SVD Auto-selection
* Semihosting Support

## Installation

Requirements:

* ARM GCC Toolchain (https://developer.arm.com/open-source/gnu-toolchain/gnu-rm/downloads) - provides arm-none-eabi-gdb and related tools
* At least one of:
    * J-Link Software Tools - provides the J-Link GDB Server for J-Link based debuggers (https://www.segger.com/downloads/jlink)
    * OpenOCD - provides a GDB Server that can be used with a number of debuggers (http://openocd.org)
        * NOTE: On macOS do not use the default version of OpenOCD provided by homebrew, this is not compatible with releases V0.2.4 and newer. You can either install from source using homebrew (`brew install open-ocd --HEAD`) or the packages from https://github.com/gnu-mcu-eclipse/openocd/releases will also work. Some linux versions and Windows may also need a more up-to-date version of OpenOCD from the gnu-mcu-eclipse releases.
    * Texane's st-util GDB server - Only supports ST-Link Debug Probes (https://github.com/texane/stlink)
    * ST-LINK GDB server - This server is packaged with the [STM32CubeIDE](https://www.st.com/en/development-tools/stm32cubeide.html) which must be installed. The location of the STM32CubeIDE and related tools is automatically resolved but also can be overridden using configuration settings (`armToolchainPath`, `stm32cubeprogrammer` and `serverpath`).
    * pyOCD GDB Server - GDB server that supports the CMSIS-DAP debugger on a number of mbed boards (https://github.com/mbedmicro/pyOCD)
    * Black Magic Probe

## Usage

See https://github.com/Marus/cortex-debug/wiki for usage information. This needs some help from the community

## Acknowledgments

Parts of this extension are based upon Jan Jurzitza's (WebFreak) code-debug extension (https://github.com/WebFreak001/code-debug). His project provided an excellent base for GDB MI parsing and interaction.
