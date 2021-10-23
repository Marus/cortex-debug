# Debug Protocol Related

Low, medium, high are importance/usefulness. But they sometimes represent *bang-for-the-buck* as well where the effort could be high vs. relative usefulness. Some of there are here because there is new functionality in VSCode APIs

* Low: `Set Value` in `Watch` Window
* Medium: Support full disassembly using the new Debug Protocol perhaps.
  * Source with assembly
  * More than one function or a virtual diplay for the entire executable
* Low: New memory window using MS Hex Editor
* Low: Add registers to `Variables` Window
  * Chance to deprecate `Registers` window
  * Ability to setValue
  * IMPORTANT: View Registers for each thread/frame in the Stack Window. Currently only shows for one context whereas it should be tracking the current frame in the stack window
  * Con: Will lose the ability to highlight changed values

# Other

* High: WSL: First class support. This includes Docker, WSL and perhaps 'ssh'. VSCode and WSL seem to be maturing. Still not there but...there may be enough
* Low: Live Debug: See if we can update program status without stopping the program. Not sure what will work and with which gdb-server
  * invasive method: program is periodically paused and updates provided -- it has the look of live but is invasive for sure
  * non-invasive (non-stop): Update without pausing the program. I should say minimally invasive.
