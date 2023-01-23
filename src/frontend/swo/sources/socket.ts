import { SWORTTSource } from './common';
import { EventEmitter } from 'events';
import * as net from 'net';
import { parseHostPort } from '../../../common';
import * as vscode from 'vscode';
import { TextDecoder } from 'util';

const TimerInterval = 250;
export class SocketSWOSource extends EventEmitter implements SWORTTSource {
    protected client: net.Socket = null;
    public connected: boolean = false;
    public connError: any = null;
    private timer: NodeJS.Timeout;
    public nTries = 1;

    constructor(public tcpPort: string) {
        super();
    }

    protected processData(buffer: Buffer): void {
        this.emit('data', buffer);
    }

    // Default wait time is about 5 minutes
    public start(maxTries = (1000 * 60 * 5) / TimerInterval): Promise<void> {
        const obj = parseHostPort(this.tcpPort);
        return new Promise((resolve, reject) => {
            this.timer = setInterval(() => {
                this.client = net.createConnection(obj, () => {
                    clearInterval(this.timer);
                    this.timer = undefined;
                    this.connected = true;
                    this.emit('connected');
                    console.log(`Connected SWO/RTT port ${this.tcpPort}, nTries = ${this.nTries}\n`);
                    resolve();
                });
                this.client.on('data', (buffer) => {
                    this.processData(buffer);
                    // this.emit('data', buffer);
                });
                this.client.on('end', () => {
                    this.dispose();
                });
                this.client.on('close', () => {
                    // This can happen because we are destroying ourselves although we never
                    // got connected.... the retry timer may still be running.
                    this.disposeClient();
                });
                this.client.on('error', (e) => {
                    const code: string = (e as any).code;
                    if ((code === 'ECONNRESET') && this.connected) {
                        // Server closed the connection. Done with this session, not in the normal way but we are done.
                        // Lot of people have issues on what to expect events end/close/error(ECONNRESET). Protect against
                        // all of them. This problem is wideley seen in various versions of NODE and OS dependent and not
                        // sure which doc/webpage/blog is the authoritative thing here.
                        this.dispose();
                    } else if (code === 'ECONNREFUSED') {
                        // We expect 'ECONNREFUSED' if the server has not yet started.
                        if (this.nTries > maxTries) {
                            (e as any).message = `Error: Failed to connect to port ${this.tcpPort} ${code}`;
                            console.log(`Failed ECONNREFUSED SWO/RTT port ${this.tcpPort}, nTries = ${this.nTries}`);
                            this.connError = e;
                            this.emit('error', e);
                            reject(e);
                            this.dispose();
                        } else {
                            if ((this.nTries % 10) === 0) {
                                console.log(`Trying SWO/RTT port ${this.tcpPort}, nTries = ${this.nTries}`);
                            }
                            this.nTries++;
                            this.disposeClient();
                        }
                    } else {
                        (e as any).message = `Error: Ignored unknown error on port ${this.tcpPort} ${code}`;
                        this.emit('error', e);
                        if (!this.connected) {
                            this.connError = e;
                            reject(e);
                        }
                        this.dispose();
                    }
                });
            }, TimerInterval);
        });
    }

    private disposeClient() {
        try {
            if (this.connected) {
                this.connected = false;
                this.emit('disconnected');
            }
            if (this.client) {
                const saved = this.client;
                this.client = null;
                saved.destroy();
            }
        }
        catch (e) {
            // For debug only
            console.log(`Socked destroy error ${e}`);
        }
    }

    public dispose() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        this.disposeClient();
    }
}

export class SocketRTTSource extends SocketSWOSource {
    constructor(tcpPort: string, public readonly channel: number) {
        super(tcpPort);
    }
    
    public write(data) {
        try {
            this.client.write(data);
        }
        catch (e) {
            throw e;
        }
    }
}

export class JLinkSocketRTTSource extends SocketRTTSource {
    constructor(tcpPort: string, public readonly channel: number) {
        super(tcpPort, channel);

        // When the TCP connection to the RTT port is established, send config commands
        // within 100ms to configure the RTT channel.  See
        // https://wiki.segger.com/RTT#SEGGER_TELNET_Config_String for more information
        // on the config string format.
        this.on('connected', () => {
            this.write(`$$SEGGER_TELNET_ConfigStr=RTTCh;${channel}$$`);
        });
    }
}

export class PeMicroSocketSource extends SocketSWOSource {
    private sequence = 0;
    private inputBuffer: Buffer = Buffer.alloc(0);

    constructor(tcpPort: string) {
        super(tcpPort);
        this.on('connected', () => {
            const createPipe = {
                "control": {
                    "00000001": {
                        "command": "createPipe",
                        "apiversion": "1"
                    }
                }
            };
            this.write(JSON.stringify(createPipe));
            this.client.once('data', (buffer) => {
                const configureSWO = {
                    "control": {
                        "00000001":{
                            "command":"configureSWOStream",
                            "streamEnabled":"true",
                            "itmStimulusPortEnable":"-1",
                            "postCNTEventEnable":"false",
                            "pcSamplingEnable":"false",
                            "postCNTClockRate":"false",
                            "localTimestamps":"false",
                            "localTSClock":"false",
                            "localTSPrescale":"0",
                            "globalTSFrequency":"0",
                            "CPI":"false",
                            "SLEEP":"false",
                            "FOLD":"false",
                            "EXCOVER":"false",
                            "LSU":"false",
                            "EXCTRC":"false",
                            "SYNC":"0"
                        }
                    }
                };
                // const configureSWO = {"control":{"00000001":{"command":"configureSWOStream","streamEnabled":"true","itmStimulusPortEnable":"-1","postCNTEventEnable":"false","pcSamplingEnable":"false","postCNTClockRate":"false","localTimestamps":"true","localTSClock":"false","localTSPrescale":"0","globalTSFrequency":"0","CPI":"false","SLEEP":"false","FOLD":"false","EXCOVER":"false","LSU":"false","EXCTRC":"false","SYNC":"0"}}};
                this.write(JSON.stringify(configureSWO));
                this.client.once('data', (buffer) => {
                    const resumePipe = {
                        "control": {
                            "00000001": {
                                "command": "resumePipe"
                            }
                        }
                    };
                    // const resumePipe = {"control":{"00000001":{"command":"resumePipe"}}};
                    this.write(JSON.stringify(resumePipe));
                });
            });
        });

        // this.client.on('data', (buffer) => {
        //     this.emit('data', buffer);
        // });
    }

    protected processData(buffer: Buffer): void {
        this.inputBuffer = Buffer.concat(this.inputBuffer, buffer);
        while(this.inputBuffer.length >= 32) {
            const view = new DataView(this.inputBuffer);
            var header = new Uint32Array(8);
            for(let i = 0; i < 8; i++) {
                header[i] = view.getUint32(i*4, false);
            }
            if(header[0] !== 1 || header[1] !== 1 ||header[2] !== 1) {
                this.inputBuffer = Buffer.alloc(0);
                return;
            }
            const sequence = header[3];
            const length = header[4];
            // Check to see if the header is valid. If its not we might have gotten out of sync.
            // If we are out of sync, just throw it way.
            

            // # skip first 3 words, seems to be fixed
            // # 00000001 00000001 00000001 ( no idea, maybe 3rd one is direction?)
            // # val = struct.unpack_from('>I', msg, 0)[0] # Seem to always be 1
            // # val = struct.unpack_from('>I', msg, 4)[0] # Seem to always be 1
            // # val = struct.unpack_from('>I', msg, 8)[0] # Seem to always be 1 (maybe direction?)
            // # Response sequence should match the request, but I'm not going to check
            // seq = struct.unpack_from('>I', msg, 12)[0]
            // length = struct.unpack_from('>I', msg, 16)[0]
            // # Skip the last in the header, seems to be fixed. Maybe reserved?
            // # val = struct.unpack_from('>I', msg, 20)[0] # Seem to always be 0
            // # val = struct.unpack_from('>I', msg, 24)[0] # Seem to always be 0
            // # val = struct.unpack_from('>I', msg, 28)[0] # Seem to always be 0

            // const view = new DataView(this.inputBuffer);
            // view.setUint32(0*4, 1, false); // No idea seems to always be 1
            // view.setUint32(1*4, 1, false); // No idea seems to always be 1
            // view.setUint32(2*4, 0, false); // (maybe direction?)
            // view.setUint32(3*4, this.sequence, false); // Sequence number
            // view.setUint32(4*4, 32 + data.length, false); // Size
            // view.setUint32(5*4, 0, false); // No idea seems to always be 0
            // view.setUint32(6*4, 0, false); // No idea seems to always be 0
            // view.setUint32(7*4, 0, false); // No idea seems to always be 0
            
            this.emit('data', buffer.subarray(32));
        }
    }

    public write(data) {
        try {
            // const header = new Uint32Array(8);
            const header = new Uint8Array(8*4)
            const view = new DataView(header.buffer);
            view.setUint32(0*4, 1, false); // No idea seems to always be 1
            view.setUint32(1*4, 1, false); // No idea seems to always be 1
            view.setUint32(2*4, 0, false); // (maybe direction?)
            view.setUint32(3*4, this.sequence, false); // Sequence number
            view.setUint32(4*4, 32 + data.length, false); // Size
            view.setUint32(5*4, 0, false); // No idea seems to always be 0
            view.setUint32(6*4, 0, false); // No idea seems to always be 0
            view.setUint32(7*4, 0, false); // No idea seems to always be 0

            let decoder = new TextDecoder();
            this.client.write(decoder.decode(header) + data)

            // const encoder = new TextEncoder('utf-8')
            // this.client.write(header + encoder.encode(data));

            // this.client.write(String.fromCharCode(header) + data);
            // this.client.write(data);
            this.sequence = this.sequence + 1
        }
        catch (e) {
            throw e;
        }
    }
}
