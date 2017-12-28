# Cortex Debug

Debugging support for ARM Cortex-M Microcontrollers with the following features:

* J-Link or OpenOCD GDB Server
* Cortex Core Register Viewer
* Peripheral Viewer (Defined through standard SVD file)
* SWO Deocding - "console" text output, and binary data (signed and unsigned 32-bit integers, Q16.16 fixed point integers, 32-bit single percision floating point integers)
* Live Graphing of SWO Decoded data.

## Installation

Requirements:

* ARM GCC Toolchain (https://developer.arm.com/open-source/gnu-toolchain/gnu-rm/downloads) - provides arm-none-eabi-gdb
* At least one of:
  * J-Link Software Tools - provides the J-Link GDB Server for J-Link based debuggers (https://www.segger.com/downloads/jlink)
  * OpenOCD - provides a GDB Server that can be used with a number of debuggers (http://openocd.org)

The extension is not currently available through the Visual Studio Code Extension Marketplace, to install download the cortex-debug.vsix extension file and install using the 'Extensions: Install from VSIX...' command in Visual Studio Code.

## Usage

