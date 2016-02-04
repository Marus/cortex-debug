# Debug

Native VSCode debugger. Currently only using GDB.

![https://i.imgur.com/ANEvaZg.png](https://i.imgur.com/ANEvaZg.png)

## Usage

![http://i.webfreak.org/540244.png](http://i.webfreak.org/540244.png)

Open your project and click the debug button in your sidebar. At the top right press
the little gear icon and select GDB. It will automatically generate the configuration
you need.

![http://i.webfreak.org/1A53C4.png](http://i.webfreak.org/1A53C4.png)

Now you need to change `target` to the application you want to debug relative
to the cwd. (Which is the workspace root by default)

Before debugging you need to compile your application first, then you can run it using
the green start button in the debug sidebar. For this you could use the `preLaunchTask`
argument vscode allows you to do. Debugging multithreaded applications is currently not
implemented. Adding breakpoints while the program runs will not interrupt it immediately.
For that you need to pause & resume the program once first. However adding breakpoints
while its paused works as expected.

Extending variables is very limited as it does not support child values of variables.
Watching expressions works partially but the result does not get properly parsed and
it shows the raw GDB output of the command. It will run `data-evaluate-expression`
to check for variables.

While running you will get a console where you can manually type GDB commands or GDB/MI
commands prepended with a hyphen `-`. The console shows all output GDB gives separated
in `stdout` for the application, `stderr` for errors and `log` for GDB log messages.

Some exceptions/signals like segmentation faults will be catched and displayed but
it does not support for example most D exceptions.

### Attaching to existing processes

Attaching to existing processes currently only works by specifying the PID in the
`launch.json` and setting `request` to `"attach"`. You also need to specify the executable
path for GDB to find the debug symbols.

```
"request": "attach",
"executable": "./bin/executable",
"target": "4285"
```

This will attach to PID 4285 which should already run. GDB will pause the program on entering.

### Using `gdbserver` for remote debugging

You can also connect to a gdbserver instance and debug using that. For that modify the
`launch.json` by setting `request` to `"attach"` and `remote` to `true` and specifing the
port and optionally hostname in `target`.

```
"request": "attach",
"executable": "./bin/executable",
"target": ":2345",
"remote": true
```

This will attach to the running process managed by gdbserver on localhost:2345. You might
need to hit the start button in the debug bar at the top first to start the program.

## [Issues](https://github.com/WebFreak001/code-debug)