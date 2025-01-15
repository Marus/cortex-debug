import { EventEmitter } from 'events';
import { TcpPortScanner } from './common/util/tcpportscanner';
import { GDBServer } from './backend/server';
import { ConfigurationArguments, RTTConfiguration } from '@common/types';
import { RTTConfigureEvent } from '@common/events';

export function genDownloadCommands(config: ConfigurationArguments, preLoadCmds: string[]) {
    if (Array.isArray(config?.loadFiles)) {
        if (config.loadFiles.length === 0) {
            return [];
        } else {
            const ret = [...preLoadCmds];
            for (const f of config.loadFiles) {
                const tmp = f.replace(/\\/g, '/');
                ret.push(`file-exec-file "${tmp}"`, 'target-download');
            }
            return ret;
        }
    }
    return [...preLoadCmds, 'target-download'];
}

export class RTTServerHelper {
    // Channel numbers previously used on the localhost
    public rttLocalPortMap: {[channel: number]: string} = {};
    public allocDone = false;

    // For openocd, you cannot have have duplicate ports and neither can
    // a multiple clients connect to the same channel. Perhaps in the future
    // it wil
    public allocateRTTPorts(cfg: RTTConfiguration, startPort: number = 60000): Promise<any> {
        this.allocDone = true;
        if (!cfg || !cfg.enabled || !cfg.decoders || cfg.decoders.length === 0) {
            return Promise.resolve();
        }

        // Remember that you can have duplicate decoder ports. ie, multiple decoders looking at the same port
        // while mostly not allowed, it could be in the future. Handle it here but disallow on a case by case
        // basis depending on the gdb-server type
        const dummy = '??';
        for (const dec of cfg.decoders) {
            if (dec.type === 'advanced') {
                dec.tcpPorts = [];
                for (const p of dec.ports) {
                    this.rttLocalPortMap[p] = dummy;
                }
            } else {
                this.rttLocalPortMap[dec.port] = dummy;
            }
        }

        const count = Object.keys(this.rttLocalPortMap).length;
        const portFinderOpts = { min: startPort, max: startPort + 2000, retrieve: count, consecutive: false };
        return TcpPortScanner.findFreePorts(portFinderOpts, GDBServer.LOCALHOST).then((ports) => {
            for (const dec of cfg.decoders) {
                if (dec.type === 'advanced') {
                    dec.tcpPorts = [];
                    for (const p of dec.ports) {
                        let str = this.rttLocalPortMap[p];
                        if (str === dummy) {
                            str = ports.shift().toString();
                            this.rttLocalPortMap[p] = str;
                        }
                        dec.tcpPorts.push(str);
                    }
                } else {
                    let str = this.rttLocalPortMap[dec.port];
                    if (str === dummy) {
                        str = ports.shift().toString();
                        this.rttLocalPortMap[dec.port] = str;
                    }
                    dec.tcpPort = str;
                }
            }
        });
    }

    public emitConfigures(cfg: RTTConfiguration, obj: EventEmitter): boolean {
        let ret = false;
        if (cfg.enabled) {
            for (const dec of cfg.decoders) {
                if ((dec.type === 'advanced' && dec.tcpPorts) || (dec.type !== 'advanced' && dec.tcpPort)) {
                    obj.emit('event', new RTTConfigureEvent({
                        type: 'socket',
                        decoder: dec
                    }));
                    ret = true;
                }
            }
        }
        return ret;
    }
}

export function createPortName(procNum: number, prefix: string = 'gdbPort'): string {
    return prefix + ((procNum === 0) ? '' : procNum.toString());
}

export function calculatePortMask(decoders: any[]) {
    if (!decoders) { return 0; }

    let mask: number = 0;
    decoders.forEach((d) => {
        if (d.type === 'advanced') {
            for (const port of d.ports) {
                mask = (mask | (1 << port)) >>> 0;
            }
        }
        else {
            mask = (mask | (1 << d.port)) >>> 0;
        }
    });
    return mask;
}
