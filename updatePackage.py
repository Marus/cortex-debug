import json
import copy


config_base = None
package = None

with open('config_base.json', 'r') as fp:
	config_base = json.load(fp)

with open('package.json', 'r') as fp:
	package = json.load(fp)

# print json.dumps(config_base, indent=4)

def make_config(dtype, request):
	required = copy.deepcopy(config_base['common']['common']['required'])
	properties = copy.deepcopy(config_base['common']['common']['properties'])

	required_2 = copy.deepcopy(config_base['common'][request]['required'])
	properties_2 = copy.deepcopy(config_base['common'][request]['properties'])

	required_3 = copy.deepcopy(config_base[dtype]['common']['required'])
	properties_3 = copy.deepcopy(config_base[dtype]['common']['properties'])

	required_4 = copy.deepcopy(config_base[dtype][request]['required'])
	properties_4 = copy.deepcopy(config_base[dtype][request]['properties'])

	for r in required_2:
		if r not in required:
			required.append(r)

	for r in required_3:
		if r not in required:
			required.append(r)

	for r in required_4:
		if r not in required:
			required.append(r)
	
	properties.update(properties_2)
	properties.update(properties_3)
	properties.update(properties_4)

	if 'removeProperties' in config_base[dtype]:
		for prop in config_base[dtype]['removeProperties']:
			if prop in properties:
				del properties[prop]
	
	return { 'required': required, 'properties': properties }

if 'contributes' in package and 'debuggers' in package['contributes']:
	for debugger in package['contributes']['debuggers']:
		dtype = debugger['type']
		
		if dtype in config_base:
			debugger['configurationAttributes'] = {}

			if 'launch' in config_base[dtype]:
				attrs = make_config(dtype, 'launch')
				debugger['configurationAttributes']['launch'] = attrs
			
			if 'attach' in config_base[dtype]:
				attrs = make_config(dtype, 'attach')
				debugger['configurationAttributes']['attach'] = attrs
	
# print json.dumps(package, indent=4, sort_keys=True)

with open('package.json', 'w') as fp:
	json.dump(package, fp, indent=4, sort_keys=True)

