#!/usr/bin/env python3

import pprint
import json
import re

pp = pprint.PrettyPrinter()

expected_diff_properties = ['overrideAttachCommands', 'overrideLaunchCommands',
                            'postAttachCommands', 'postLaunchCommands',
                            'preAttachCommands', 'preLaunchCommands',
                            'runToEntryPoint', 'runToMain', 'loadFiles']

def get_properties(pkg, type):
    attributes = pkg['contributes']['debuggers'][0]['configurationAttributes'][type]
    return dict([(p, attributes['properties'][p].get('description', '(unknown)'))
                 for p in attributes['properties']])


with open('package.json') as f:
    package = json.load(f)

attach_properties = get_properties(package, 'attach')
launch_properties = get_properties(package, 'launch')
extra_properties = list(set(list(attach_properties.keys() -
                        launch_properties.keys()) + list(launch_properties.keys() - attach_properties.keys())) - set(expected_diff_properties))
extra_properties.sort()
if len(extra_properties) > 0:
    print("WARNING: launch_properties and attach_properties DIFFER UNEXPECTEDLY:")
    print(extra_properties)

# pp.pprint(attach_properties)

with open('src/common.ts') as f:
    common_ts = f.read()

config_args = re.search(
    '^export interface ConfigurationArguments extends DebugProtocol.LaunchRequestArguments {(.*?)^}$', common_ts, re.M + re.S).groups()[0]

categories = {}
category_name = ''
category_list = []
for line in config_args.splitlines():
    line = line.strip()
    if len(line) == 0 or line.startswith('///') or line.startswith('pvt'):
        continue
    if line.startswith('// '):
        categories[category_name] = category_list
        category_name = line[3:]
        category_list = []
    else:
        category_list.append(line.split(':')[0])
categories[category_name] = category_list


# pp.pprint(categories)

MISSING_ATTRIBUTES = ['extensionPath', 'registerUseNaturalFormat', 'variableUseNaturalFormat', 'toolchainPath']

all_properties = {**attach_properties, **launch_properties}

with open('debug_attributes.md', 'w') as f:
    f.write('The following attributes (properties) can be used in your launch.json to control various aspects of debugging.\n')
    f.write('Besides these attributes, you can also have `cortex-debug` User/Workspace settings that can apply to all cortex-debug sessions.\n')
    f.write('Use VSCode Settings to manage the User/Workspace Cortex-Debug extension settings.\n')
    f.write('Also using IntelliSense while editing launch.json in VSCode can be quite helpful.\n')
    f.write('| Attribute | Applies To | Description |\n')
    f.write('| --------- | ---------- | ----------- |\n')
    for category in sorted(categories.keys()):
        if len(category) == 0:
            category_name = 'Common'
        else:
            category_name = category
        for attribute in sorted(categories[category]):
            if attribute in MISSING_ATTRIBUTES:
                continue
            if attribute in all_properties.keys():
                if attribute in attach_properties.keys() and attribute in launch_properties.keys():
                    if attach_properties[attribute] != launch_properties[attribute]:
                        print("WARNING: configuration property {} DIFFER UNEXPECTEDLY between attach and launch".format(attribute))
                f.write('| {} | {} | {}\n'.format(
                    attribute, category_name, all_properties[attribute]))
            else:
                f.write('| {} | {} | ????\n'.format(
                    attribute, category_name))
