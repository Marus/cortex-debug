#
# Cortex-Debug extension calls this function during initialization. You can copy this
# file, modify it and specifyy it as one of the config files supplied in launch.json
# preferably at the beginning.
#
# Note that this file simply defines a function for use later when it is time to configure
# for SWO.
#
set USE_SWO 0
proc CDSWOConfigure { CDCPUFreqHz CDSWOFreqHz CDSWOOutput } {    
    # We don't create/configure the entire TPIU which requires advanced knowledge of the device
    # like which DAP/AP ports to use, what their bases addresses are, etc. That should already
    # be done by the config files from the Silicon Vendor
    tpiu init; # we are allowed to call this multiple times. So, call it just in case
    set tipu_names [tpiu names]
    if { [llength $tipu_names] == 0 } {
        puts stderr "[info script]: Error: Could not find TPIU/SWO names. Perhaps it hasn't been created?"
    } else {
        set mytpiu [lindex $tipu_names 0]
        # We don't create/configure the entire TPIU which requires advanced knowledge of the device
        # like which DAP/AP ports to use, what their bases addresses are, etc. That should already
        # be done by the config files from the Silicon Vendor
        puts "[info script]: $mytpiu configure -protocol uart -output $CDSWOOutput -traceclk $CDCPUFreqHz -pin-freq $CDSWOFreqHz"
        $mytpiu configure -protocol uart -output $CDSWOOutput -traceclk $CDCPUFreqHz -pin-freq $CDSWOFreqHz
        $mytpiu enable
    }
}

proc CDRTOSConfigure { rtos } {
    set target [target current]
    if { $target != "" } {
        puts "[info script]: $target configure -rtos $rtos"
        $target configure -rtos $rtos
    } else {
        # Maybe this function was called too early?
        puts stderr "[info script]: Error: No current target. Could not configure target for RTOS"
    }
}
