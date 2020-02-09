haneefdm: This is **super experimental**. I want to see if I can put pre-release VSIX files here that users can pickup. VSCode does not have any way to push alpha/beta releases. So, perhaps interested users can pickup from here.

In the next few days, I will be experimenting with this mechanism myself. Right now, I am uploading a realease from my fork just to see how it works. It does not reflect the actual source in the main repo. This will change and get synced. I need to know if the basic mechanism works. I will try to figure out how add a commit tag to the pre-release as well.

Any help and suggestions are welcome.

## Install from vsix
* Download the vsix file
* Invoke the `Command Palatte` and select `Extensions: Install from VSIX...`. Just typing `vsix` will probably get you there.
* Or, from the command line, you can do
```bash
    code --install-extension filename.vsix
```
