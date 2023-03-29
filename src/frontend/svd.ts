import { PeripheralRegisterNode } from './views/nodes/peripheralregisternode';
import { PeripheralClusterNode, PeripheralOrClusterNode } from './views/nodes/peripheralclusternode';
import { PeripheralNode } from './views/nodes/peripheralnode';
import { parseInteger, parseDimIndex } from './utils';
import { PeripheralFieldNode, EnumerationMap, EnumeratedValue } from './views/nodes/peripheralfieldnode';
import * as vscode from 'vscode';

import * as xml2js from 'xml2js';
import * as fs from 'fs';

export enum AccessType {
    ReadOnly = 1,
    ReadWrite,
    WriteOnly
}

const ACCESS_TYPE_MAP = {
    'read-only': AccessType.ReadOnly,
    'write-only': AccessType.WriteOnly,
    'read-write': AccessType.ReadWrite,
    'writeOnce': AccessType.WriteOnly,
    'read-writeOnce': AccessType.ReadWrite
};

export class SVDParser {
    private static enumTypeValuesMap = {};
    private static peripheralRegisterMap = {};
    private static gapThreshold: number = 16;

    public static parseSVD(
        session: vscode.DebugSession, path: string, gapThreshold: number): Promise<PeripheralNode[]> {
        SVDParser.gapThreshold = gapThreshold;
        SVDParser.enumTypeValuesMap = {};
        SVDParser.peripheralRegisterMap = {};
        return new Promise((resolve, reject) => {
            fs.readFile(path, 'utf8', (err, data) => {
                if (err) {
                    reject(err);
                    return;
                }

                xml2js.parseString(data, (err, result) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const peripheralMap = {};
                    const defaultOptions = {
                        accessType: AccessType.ReadWrite,
                        size: 32,
                        resetValue: 0x0
                    };

                    if (result.device.resetValue) {
                        defaultOptions.resetValue = parseInteger(result.device.resetValue[0]);
                    }
                    if (result.device.size) {
                        defaultOptions.size = parseInteger(result.device.size[0]);
                    }
                    if (result.device.access) {
                        defaultOptions.accessType = ACCESS_TYPE_MAP[result.device.access[0]];
                    }

                    result.device.peripherals[0].peripheral.forEach((element) => {
                        const name = element.name[0];
                        peripheralMap[name] = element;
                    });

                    // tslint:disable-next-line:forin
                    for (const key in peripheralMap) {
                        const element = peripheralMap[key];
                        if (element.$ && element.$.derivedFrom) {
                            const base = peripheralMap[element.$.derivedFrom];
                            peripheralMap[key] = {...base, ...element};
                        }
                    }

                    const peripherials = [];
                    // tslint:disable-next-line:forin
                    for (const key in peripheralMap) {
                        try {
                            peripherials.push(SVDParser.parsePeripheral(session, peripheralMap[key], defaultOptions));
                        }
                        catch (msg) {
                            reject(msg);
                        }
                    }

                    peripherials.sort(PeripheralNode.compare);

                    for (const p of peripherials) {
                        p.collectRanges([]);
                    }
                    
                    resolve(peripherials);
                });
            });
        });
    }

    private static cleanupDescription(input: string): string {
        return input.replace('\r', '').replace(/\n\s*/g, ' ');
    }

    private static parseFields(fieldInfo: any[], parent: PeripheralRegisterNode): PeripheralFieldNode[] {
        const fields: PeripheralFieldNode[] = [];

        if (fieldInfo == null) {
            return fields;
        }

        fieldInfo.map((f) => {
            let offset;
            let width;
            const description = this.cleanupDescription(f.description ? f.description[0] : '');

            if (f.bitOffset && f.bitWidth) {
                offset = parseInteger(f.bitOffset[0]);
                width = parseInteger(f.bitWidth[0]);
            }
            else if (f.bitRange) {
                let range = f.bitRange[0];
                range = range.substring(1, range.length - 1);
                range = range.split(':');
                const end = parseInteger(range[0]);
                const start = parseInteger(range[1]);

                width = end - start + 1;
                offset = start;
            }
            else if (f.msb && f.lsb) {
                const msb = parseInteger(f.msb[0]);
                const lsb = parseInteger(f.lsb[0]);

                width = msb - lsb + 1;
                offset = lsb;
            }
            else {
                // tslint:disable-next-line:max-line-length
                throw new Error(`Unable to parse SVD file: field ${f.name[0]} must have either bitOffset and bitWidth elements, bitRange Element, or msb and lsb elements.`);
            }

            let valueMap: EnumerationMap = null;
            if (f.enumeratedValues) {
                valueMap = {};
                const eValues = f.enumeratedValues[0];
                if (eValues.$ && eValues.$.derivedFrom) {
                    const found = SVDParser.enumTypeValuesMap[eValues.$.derivedFrom];
                    if (!found) {
                        throw new Error(`Invalid derivedFrom=${eValues.$.derivedFrom} for enumeratedValues of field ${f.name[0]}`);
                    }
                    valueMap = found;
                }
                else if (eValues) {
                    if (eValues.enumeratedValue) {
                        eValues.enumeratedValue.map((ev) => {
                            if (ev.value && ev.value.length > 0) {
                                const evname = ev.name[0];
                                const evdesc = this.cleanupDescription(ev.description ? ev.description[0] : '');
                                const val = ev.value[0].toLowerCase();
                                const evvalue = parseInteger(val);
                                
                                valueMap[evvalue] = new EnumeratedValue(evname, evdesc, evvalue);
                            }
                        });
                    }

                    // According to the SVD spec/schema, I am not sure any scope applies. Seems like everything is in a global name space
                    // No make sense but how I am interpreting it for now. Easy to make it scope based but then why allow referencing
                    // other peripherals. Global scope it is. Overrides dups from previous definitions!!!
                    if (eValues.name && eValues.name[0]) {
                        let evName = eValues.name[0];
                        for (const prefix of [null, f.name[0], parent.name, parent.parent.name]) {
                            evName = prefix ? prefix + '.' + evName : evName;
                            SVDParser.enumTypeValuesMap[evName] = valueMap;
                        }
                    }
                }
            }

            const baseOptions: any = {
                name: f.name[0],
                description: description,
                offset: offset,
                width: width,
                enumeration: valueMap
            };

            if (f.access) {
                baseOptions.accessType = ACCESS_TYPE_MAP[f.access[0]];
            }

            if (f.dim) {
                if (!f.dimIncrement) { throw new Error(`Unable to parse SVD file: field ${f.name[0]} has dim element, with no dimIncrement element.`); }

                const count = parseInteger(f.dim[0]);
                const increment = parseInteger(f.dimIncrement[0]);
                let index = [];
                if (f.dimIndex) {
                    index = parseDimIndex(f.dimIndex[0], count);
                }
                else {
                    for (let i = 0; i < count; i++) { index.push(`${i}`); }
                }

                const namebase: string = f.name[0];
                const offsetbase = offset;
                
                for (let i = 0; i < count; i++) {
                    const name = namebase.replace('%s', index[i]);
                    fields.push(new PeripheralFieldNode(parent, { ...baseOptions, name: name, offset: offsetbase + (increment * i) }));
                }
            }
            else {
                fields.push(new PeripheralFieldNode(parent, { ...baseOptions }));
            }
        });

        return fields;
    }

    private static parseRegisters(regInfoOrig: any[], parent: PeripheralNode | PeripheralClusterNode): PeripheralRegisterNode[] {
        const regInfo = [...regInfoOrig];      // Make a shallow copy,. we will work on this
        const registers: PeripheralRegisterNode[] = [];

        const localRegisterMap = {};
        for (const r of regInfo) {
            const nm = r.name[0];
            localRegisterMap[nm] = r;
            SVDParser.peripheralRegisterMap[parent.name + '.' + nm] = r;
        }

        // It is wierd to iterate this way but it can handle forward references, are they legal? not sure
        // Or we could have done this work in the loop above. Not the best way, but it is more resilient to
        // concatenate elements and re-parse. We are patching at XML level rather than object level
        let ix = 0;
        for (const r of regInfo) {
            const derivedFrom = r.$ ? r.$.derivedFrom : '';
            if (derivedFrom) {
                const nm = r.name[0];
                const from = localRegisterMap[derivedFrom] || SVDParser.peripheralRegisterMap[derivedFrom];
                if (!from) {
                    throw new Error(`SVD error: Invalid 'derivedFrom' "${derivedFrom}" for register "${nm}"`);
                }
                // We are supposed to preserve all but the addressOffseet, but the following should work
                const combined = {...from, ...r};
                delete combined.$.derivedFrom;          // No need to keep this anymore
                combined.$._derivedFrom = derivedFrom;  // Save a backup for debugging
                localRegisterMap[nm] = combined;
                SVDParser.peripheralRegisterMap[parent.name + '.' + nm] = combined;
                regInfo[ix] = combined;
            }
            ix++;
        }

        for (const r of regInfo) {
            const baseOptions: any = {};
            if (r.access) {
                baseOptions.accessType = ACCESS_TYPE_MAP[r.access[0]];
            }
            if (r.size) {
                baseOptions.size = parseInteger(r.size[0]);
            }
            if (r.resetValue) {
                baseOptions.resetValue = parseInteger(r.resetValue[0]);
            }

            if (r.dim) {
                if (!r.dimIncrement) { throw new Error(`Unable to parse SVD file: register ${r.name[0]} has dim element, with no dimIncrement element.`); }

                const count = parseInteger(r.dim[0]);
                const increment = parseInteger(r.dimIncrement[0]);
                let index = [];
                if (r.dimIndex) {
                    index = parseDimIndex(r.dimIndex[0], count);
                }
                else {
                    for (let i = 0; i < count; i++) { index.push(`${i}`); }
                }

                const namebase: string = r.name[0];
                const descbase: string = this.cleanupDescription(r.description ? r.description[0] : '');
                const offsetbase = parseInteger(r.addressOffset[0]);

                for (let i = 0; i < count; i++) {
                    const name = namebase.replace('%s', index[i]);
                    const description = descbase.replace('%s', index[i]);

                    const register = new PeripheralRegisterNode(parent, {
                        ...baseOptions,
                        name: name,
                        description: description,
                        addressOffset: offsetbase + (increment * i)
                    });
                    if (r.fields && r.fields.length === 1) {
                        SVDParser.parseFields(r.fields[0].field, register);
                    }
                    registers.push(register);
                }
            }
            else {
                const description = this.cleanupDescription(r.description ? r.description[0] : '');
                const register = new PeripheralRegisterNode(parent, {
                    ...baseOptions,
                    name: r.name[0],
                    description: description,
                    addressOffset: parseInteger(r.addressOffset[0])
                });
                if (r.fields && r.fields.length === 1) {
                    SVDParser.parseFields(r.fields[0].field, register);
                }
                registers.push(register);
            }
        }

        registers.sort((a, b) => {
            if (a.offset < b.offset) { return -1; }
            else if (a.offset > b.offset) { return 1; }
            else { return 0; }
        });

        return registers;
    }

    private static parseClusters(clusterInfo: any, parent: PeripheralOrClusterNode): PeripheralClusterNode[] {
        const clusters: PeripheralClusterNode[] = [];

        if (!clusterInfo) { return []; }

        clusterInfo.forEach((c) => {
            const baseOptions: any = {};
            if (c.access) {
                baseOptions.accessType = ACCESS_TYPE_MAP[c.access[0]];
            }
            if (c.size) {
                baseOptions.size = parseInteger(c.size[0]);
            }
            if (c.resetValue) {
                baseOptions.resetValue = parseInteger(c.resetValue);
            }

            if (c.dim) {
                if (!c.dimIncrement) { throw new Error(`Unable to parse SVD file: cluster ${c.name[0]} has dim element, with no dimIncrement element.`); }

                const count = parseInteger(c.dim[0]);
                const increment = parseInteger(c.dimIncrement[0]);

                let index = [];
                if (c.dimIndex) {
                    index = parseDimIndex(c.dimIndex[0], count);
                }
                else {
                    for (let i = 0; i < count; i++) { index.push(`${i}`); }
                }

                const namebase: string = c.name[0];
                const descbase: string = this.cleanupDescription(c.description ? c.description[0] : '');
                const offsetbase = parseInteger(c.addressOffset[0]);

                for (let i = 0; i < count; i++) {
                    const name = namebase.replace('%s', index[i]);
                    const description = descbase.replace('%s', index[i]);
                    const cluster = new PeripheralClusterNode(parent, {
                        ...baseOptions,
                        name: name,
                        description: description,
                        addressOffset: offsetbase + (increment * i)
                    });
                    if (c.register) {
                        SVDParser.parseRegisters(c.register, cluster);
                    }
                    if (c.cluster) {
                        SVDParser.parseClusters(c.cluster, cluster);
                    }
                    clusters.push(cluster);
                }

            }
            else {
                const description = this.cleanupDescription(c.description ? c.description[0] : '');
                const cluster = new PeripheralClusterNode(parent, {
                    ...baseOptions,
                    name: c.name[0],
                    description: description,
                    addressOffset: parseInteger(c.addressOffset[0])
                });
                if (c.register) {
                    SVDParser.parseRegisters(c.register, cluster);
                    clusters.push(cluster);
                }
                if (c.cluster) {
                    SVDParser.parseClusters(c.cluster, cluster);
                    clusters.push(cluster);
                }
            }

        });

        return clusters;
    }

    private static parsePeripheral(
        session: vscode.DebugSession,
        p: any, defaults: { accessType: AccessType, size: number, resetValue: number }): PeripheralNode {
        let totalLength = 0;
        if (p.addressBlock) {
            for (const ab of p.addressBlock) {
                const offset = parseInteger(ab.offset[0]);
                const size = parseInteger(ab.size[0]);
                totalLength = Math.max(totalLength, offset + size);
            }
        }
        
        const options: any = {
            name: p.name[0],
            baseAddress: parseInteger(p.baseAddress ? p.baseAddress[0] : 0),
            description: this.cleanupDescription(p.description ? p.description[0] : ''),
            totalLength: totalLength
        };

        if (p.access) { options.accessType = ACCESS_TYPE_MAP[p.access[0]]; }
        if (p.size) { options.size = parseInteger(p.size[0]); }
        if (p.resetValue) { options.resetValue = parseInteger(p.resetValue[0]); }
        if (p.groupName) { options.groupName = p.groupName[0]; }
        
        const peripheral = new PeripheralNode(session, SVDParser.gapThreshold, options);

        if (p.registers) {
            if (p.registers[0].register) {
                SVDParser.parseRegisters(p.registers[0].register, peripheral);
            }
            if (p.registers[0].cluster) {
                SVDParser.parseClusters(p.registers[0].cluster, peripheral);
            }
        }

        return peripheral;
    }
}
