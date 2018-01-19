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