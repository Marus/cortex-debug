import * as fs from 'fs';

function handleObject(obj: any, prop: string, appliesTo, stream: fs.WriteStream) {
    const keys = Object.keys(obj).sort();
    for (const key of keys) {
        const child = obj[key];
        const chProp = prop + '<br>.' + key;
        const chType = getType(child);
        stream.write(`| ${chProp} | ${chType} | ${appliesTo} | ${child.description} |\n`);
        if (child.properties) {
            handleObject(child.properties, chProp, appliesTo, stream);
        }
    }
}

function getType(obj: any) {
    const pipe = ' &#124; ';
    if (Array.isArray(obj.type)) {
        return obj.type.join(pipe);
    }
    if (obj.properties) {
        return 'object';
    }
    if ((obj.type === 'array') && obj.items) {
        if (typeof obj.items === 'string') {
            return obj.items + '[]';
        } else if (obj.items.properties) {
            return 'object[]';
        } else if (obj.items.anyOf || obj.items.oneOf) {
            return newFunction(obj.items);
        } else if (obj.items.type) {
            return getType(obj.items) + '[]';
        }
    } else if (obj.anyOf || obj.oneOf) {
        return newFunction(obj);
    } else if (obj.type) {
        return obj.type;
    } else {
        return '??';
    }

    function newFunction(obj: any) {
        const ary = [];
        let isComplex = false;
        for (const item of (obj.anyOf || obj.oneOf)) {
            const tmp = getType(item);
            if (ary.findIndex((s) => s === tmp) === -1) {
                ary.push(getType(item));
            }
            if (item.itemms || item.properties || item.anyOf || item.oneOf) {
                isComplex = true;
            }
        }
        if (isComplex) {
            return '{' + ary.join(pipe) + '}';
        }
        return ary.join(pipe);
    }
}

function writeHeader(f: fs.WriteStream) {
    f.write('There are many `User/Workspace Settings` to control things globally. You can find these in the VSCode Settings UI. `launch.json`');
    f.write(' can override some of those settings. There is a lot of functionality that is available via `Settings` and some may be useful in a');
    f.write(' team environment and/or can be used across all cortex-debug sessions\n\n');
    f.write('![](./images/cortex-debug-settings.png)\n\n');
    f.write('The following attributes (properties) can be used in your `launch.json` to control various aspects of debugging.');
    f.write(' Also `IntelliSense` is an invaluable aid while editing `launch.json`. With `IntelliSense`, you can hover over an attribute to get');
    f.write(' more information and/or help you find attributes (just start typing a double-quote, use Tab key) and provide defaults/options.\n\n');
    f.write('If the type is marked as `{...}` it means that it is a complex item can have multiple types. Possibly consult our Wiki\n');
}

export function packageJSONtoMd(path: string, outPath: string) {
    let obj: any;
    try {
        const txt = fs.readFileSync(path);
        obj = JSON.parse(txt.toString());
    }
    catch (e) {
        console.error(`Error: Could not open/read file ${path}`, e);
        return 1;
    }
    const dbgSections = obj?.contributes?.debuggers;
    if (!dbgSections) {
        console.error(`No "debuggers" found in file ${path}`);
        return 1;
    }
    for (const dbgSection of dbgSections) {
        const attrs = dbgSection.configurationAttributes;
        const attach = attrs?.attach?.properties;
        const launch = attrs?.launch?.properties;
        if (!attach) {
            console.error('"attach" properties not found');
            return 1;
        }
        if (!launch) {
            console.error('"launch" properties not found');
            return 1;
        }
        let attachProps = Object.keys(attach);
        let launchProps = Object.keys(launch);
        const common = {};
        for (const prop of launchProps) {
            if (attach[prop]?.deprecated || launch[prop]?.deprecated) {
                delete launch[prop];
                delete attach[prop];
                continue;
            }
            if (attachProps.findIndex((str) => str === prop) !== -1) {
                common[prop] = launch[prop];
                if (launch[prop].description !== attach[prop].description) {
                    console.warn(`Warning: Description does not match for property ${prop} between attach and launch`);
                }
                delete launch[prop];
                delete attach[prop];
            }
        }
        attachProps = Object.keys(attach).sort();
        launchProps = Object.keys(launch).sort();
        const commonProps = Object.keys(common).sort();
        const allProps = attachProps.concat(launchProps).concat(commonProps).sort();
        // console.log('launch', launchProps);
        // console.log('attach', attachProps);
        // console.log('common', commonProps);
        try {
            const stream = fs.createWriteStream(outPath);
            writeHeader(stream);
            stream.write('| Attribute | Type | Launch/ Attach | Description |\n');
            stream.write('| --------- | ---- | ---------------- | ----------- |\n');
            for (const prop of allProps) {
                let obj = common[prop];
                let appliesTo = 'Both';
                if (!obj) {
                    obj = launch[prop];
                    if (obj) {
                        appliesTo = 'Launch';
                    } else {
                        obj = attach[prop];
                        appliesTo = 'Attach';
                    }
                }
                const objType = getType(obj);
                stream.write(`| ${prop} | ${objType} | ${appliesTo} | ${obj.description} |\n`);
                if (obj.properties) {
                    handleObject(obj.properties, prop, appliesTo, stream);
                } else if (obj.items) {
                }
            }
        }
        catch (e) {
            console.error(`Could not write to file ${outPath}`);
        }
        break;
    }
}

packageJSONtoMd('./package.json', './debug_attributes.md');
