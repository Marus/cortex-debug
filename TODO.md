# Debug Protocol Related

Low, medium, high are importance/usefulness. But they sometimes represent *bang-for-the-buck* as well where the effort could be high vs. relative usefulness. Some of there are here because there is new functionality in VSCode APIs

* **Done**: High: Better support for multi-core and multi-session debugging in a single instance of the IDE
* Low: `Set Value` in `Watch` Window
* **In Progress**: Medium: Support full disassembly using the new Debug Protocol perhaps.
  * Source with assembly -- Available but UI could be better. You can toggle source embedding on/off.
  * Done: More than one function or a virtual display for the entire executable
  * Instruction level step/next
  * Seamless, full disassembly, but on demand
  * Registers (in Variables Window), Call stack, source code, Disassembly can all be in sync -- takes a bit of window arrangement but not hard.
  * We can say goodbye to our version of Disassembly soon
  * Performance is a bit worrisome. May need an option to turn off the feature completely. Didn't see an issue unless you start Disassembly and even after that but not sure on slower computers.
* **Done**: Medium: Logpoints: See #542
* Super Low: New memory window using MS Hex Editor
  * They messed up the UX where it inteferes with a debug session repeately. They do not appear willing to revert back to the way they had it which was much nicer. We could fork or include it but it is way too much work.
* **Done**: Low: Add registers to `Variables` Window
  * Chance to deprecate `Registers` window
  * Ability to setValue
  * IMPORTANT: View Registers for each thread/frame in the Stack Window. Currently only shows for one context whereas it should be tracking the current frame in the stack window
  * We thought we will lose the ability to highlight changed values. Not true, there is some indication as to what changed but it evaporates after a while. Maybe a good thing, looks better than what we had

# Other

* Medium: RTOS plugins. There is a PR for FreeRTOS but we may want to thing of creaating a plugin mecheanism for various RTOSes. I don't want to hardcode all the different RTOS data structures but rather have one generic one driven by a JSON file or a custom ones.
* Medium: WSL: First class support. This includes Docker, WSL and perhaps 'ssh'. VSCode and WSL seem to be maturing. Still not there but...there may be enough.
  * This may not be needed anymore since there is an effort to support a USB proxy mechanism in WSL. If that works out, then there is no need for us to do anything.
* Low: Live Debug: See if we can update program status without stopping the program. Not sure what will work and with which gdb-server
  * invasive method: program is periodically paused and updates provided -- it has the look of live but is invasive for sure
  * non-invasive (non-stop): Update without pausing the program. I should say minimally invasive.
