# Cortex Debug

Debugging support for ARM Cortex-M Microcontrollers with the following features:

* Supports J-Link or OpenOCD GDB Server
* Cortex Core Register Viewer
* Peripheral Register Viewer (Defined through standard SVD file)
* SWO Deocding - "console" text output and binary data (signed and unsigned 32-bit integers, Q16.16 fixed point integers)
    * Currently SWO decoding is not supported when using OpenOCD on Windows
* Live graphing of SWO decoded data.

### Planned Features

* Additional Graphing Options
* Raw Memory Viewer
* Enhanced SVD Auto-selection
* Support for Black Magic Probe
* SWO Decoding for OpenOCD on Windows
* SWO Decoding for 32-bit floating point number

## Installation

Requirements:

* ARM GCC Toolchain (https://developer.arm.com/open-source/gnu-toolchain/gnu-rm/downloads) - provides arm-none-eabi-gdb
* At least one of:
    * J-Link Software Tools - provides the J-Link GDB Server for J-Link based debuggers (https://www.segger.com/downloads/jlink)
    * OpenOCD - provides a GDB Server that can be used with a number of debuggers (http://openocd.org)

The extension is not currently available through the Visual Studio Code Extension Marketplace, to install download the cortex-debug.vsix extension file (from the releases page https://github.com/Marus/cortex-debug/releases) and install using the 'Extensions: Install from VSIX...' command in Visual Studio Code.

## Usage

See https://marcelball.ca/projects/cortex-debug/ for usage information

## Acknowledgments

Parts of this extension are based upon Jan Jurzitza's (WebFreak) code-debug extension (https://github.com/WebFreak001/code-debug). His project provided an excellent base for GDB MI parsing and interaction.
