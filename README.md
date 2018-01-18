# Cortex Debug

![Visual Studio Code with Cortex-Debug Installed](./images/vs-code-screenshot.png)

Debugging support for ARM Cortex-M Microcontrollers with the following features:

* Supports J-Link or OpenOCD GDB Server
* Cortex Core Register Viewer
* Peripheral Register Viewer (Defined through standard SVD file)
* SWO Deocding - "console" text output and binary data (signed and unsigned 32-bit integers, Q16.16 fixed point integers, single percision floating point values)
    * Currently decoding of ITM Timestamp and Synchronization packets are not supported; these features will need to be disabled in the code for the microcontroller.
* Support for Custom ITM Data Decoders:
    * Ability to define JavaScript modules to decode complex data formats streamed over a particular ITM port. Data can be printed to a output window, or sent to the graphing system.
* Live graphing of decoded ITM data.
* Raw Memory Viewer (From the command menu select Cortex-Debug: View Memory)
* Initial support for PyOCD GDB Server (No SWO support for PyOCD)

### In Progress Features
* RTOS/Muti-Threaded Support (Dependant on GDB server support)
* Improved SWO Decoding

### Planned Features

* Additional Graphing Options
* Enhanced SVD Auto-selection
* Support for Black Magic Probe
* Semihosting Support

## Installation

Requirements:

* ARM GCC Toolchain (https://developer.arm.com/open-source/gnu-toolchain/gnu-rm/downloads) - provides arm-none-eabi-gdb
* At least one of:
    * J-Link Software Tools - provides the J-Link GDB Server for J-Link based debuggers (https://www.segger.com/downloads/jlink)
    * OpenOCD - provides a GDB Server that can be used with a number of debuggers (http://openocd.org)

## Usage

See https://marcelball.ca/projects/cortex-debug/ for usage information

## Acknowledgments

Parts of this extension are based upon Jan Jurzitza's (WebFreak) code-debug extension (https://github.com/WebFreak001/code-debug). His project provided an excellent base for GDB MI parsing and interaction.
