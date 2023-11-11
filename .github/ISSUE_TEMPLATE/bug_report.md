---
name: Bug/issue report. You MUST use this form unless you have a feature request
about: Create a report to help us improve
title: ''
labels: ''
assignees: ''

---
### Please make you search through our existing [issues](https://github.com/Marus/cortex-debug/issues?q=type:issue) (both open and closed)
It may help to look at these instructions in `Preview` mode. Please visit the correct repo to file an issue. If this is an issue with
* Peripherals/SVD Viewer: [https://github.com/mcu-debug/peripheral-viewer](https://github.com/mcu-debug/peripheral-viewer)
* Memory Viewer: [https://github.com/mcu-debug/memview](https://github.com/mcu-debug/memview)
* RTOS Viewer: [https://github.com/mcu-debug/rtos-views](https://github.com/mcu-debug/rtos-views)
* the debugger itself, continue below

Please read our documentation as well. You have a lot of control over how Cortex-Debug works. Besides the top level [README.md](https://github.com/Marus/cortex-debug/blob/master/README.md), we have the following

https://github.com/Marus/cortex-debug/wiki
https://github.com/Marus/cortex-debug/wiki/Cortex-Debug-Under-the-hood
https://github.com/Marus/cortex-debug/blob/master/debug_attributes.md

*Finally, make sure all your external tools are configured properly and working. We print all the commands in the Debug Console. Most of the bug reports are from Linux users with improperly installed GNU tools. If you can't run those tools, neither can we.*

Thank you for helping reduce the number of issues which is becoming overwhelming as most of them are not issues at all. You can delete all the above text and start filing the issue

**Describe the bug**
A clear and concise description of what the bug is.
**To Reproduce**
Steps to reproduce the behavior:
1. Start debug session
2. Click on '....'
3. Scroll down to '....'
4. See issue

**Expected behavior**

[comment]: <> A clear and concise description of what you expected to happen.

**Screenshots**

[comment]: <> If applicable, add screenshots to help explain your problem.

**Environment (please complete the following information):**

[comment]: <> Whenever possible, please make sure you are using the latest versions of VSCode and our extension

 - Cortex-Debug Version (this extension) [e.g. 0.2.3]
 - OS: [e.g. Linux Ubuntu 18.04 LTS, Windows 11, etc.]
 - GDB Version: [e.g. 1.11.1]
 - Compiler Toolchain Version: [e.g. arn-none-eabi V 11.1]

**Please include `launch.json`**

*Note: We are unlikely to look at the issue if you do not supply this*
```
Paste launch.json contents here
```

**Attach text from `Debug Console`**

Please enable debug output in your launch.json (`"showDevDebugOutput": "raw"`). It this is too large, please attach it as a file
```
Paste Debug Console contents here
```

**Additional context**
Add any other context about the problem here.
