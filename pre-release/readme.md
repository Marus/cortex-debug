haneefdm: This is super experimental. I want to see if I can put pre-release VSIX files here that users can pickup. VSCode does not have any way to push alpha/beta releases. So, perhaps interested users can pickup from here.

In the next few days, I will be experimenting with this mechanism myself.

## Install from vsix
* Download the vsix file
* Invoke the `Command Palatte` and select `Extensions: Install from VSIX...`. Just typing `vsix` will probably get you there.
* Or, from the command line, you can do
```bash
    code --install-extension filename.vsix
```
