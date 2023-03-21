import { SWORTTSource } from './common';
import { EventEmitter } from 'events';
import * as net from 'net';
import { parseHostPort } from '../../../common';
import * as vscode from 'vscode';
import { TextDecoder } from 'util';
import { setFlagsFromString } from 'v8';

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
    public start(timeout = (1000 * 60 * 5)): Promise<void> {
        let retry = true;
        const start = Date.now();
        const obj = parseHostPort(this.tcpPort);
        return new Promise((resolve, reject) => {
            this.timer = setInterval(() => {
                if (!retry) {
                    // Last attempt is still ongoing. It hasn't failed or succeeded
                    return;
                }
                retry = false;
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
                        const delta = Date.now() - start;
                        if (delta > timeout) {
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
                            retry = true;
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

enum PeHeaderType {
    TX_COMMAND = 0,
    RX_COMMAND = 1,
    RX_STREAM = 7
}

class PeMicroHeader {
    // Headers are 32 bytes separated into 8 uint32 (big endian)
    // All of the data is reverse-engineered.
    // There are no public documents that I can find on this stream configuration
    // Byte[0] - Unknown Seems to always be 1
    // Byte[1] - Unknown Seems to always be 1
    // Byte[2] - Semi-Unknown. Possibly direction data type
    //         - Seems to be 0 when command is sent to the PeMicro.
    //         - 1 when its a command response and 7 when its SWO stream
    // Byte[3] - Sequence number. Increasing number used to match request response
    // Byte[4] - Total Length. Length = header size + data size
    // Byte[5] - Unknown Seems to always be 0. Possibly reserved?
    // Byte[6] - Unknown Seems to always be 0. Possibly reserved?
    // Byte[7] - Unknown Seems to always be 0. Possibly reserved?

    public type: PeHeaderType;
    public dataLength: number;
    public sequence: number;

    public static get headerLength() {
        return 32;
    }

    public static fromValues(type: PeHeaderType, sequence: number, dataLength: number): PeMicroHeader {
        const cls = new PeMicroHeader();
        cls.type = type;
        cls.sequence = sequence;
        cls.dataLength = dataLength;
        return cls;
    }

    public static fromBuffer(buffer: Buffer): PeMicroHeader {
        const cls = new PeMicroHeader();
        const header = new Uint32Array(8);
        for (let i = 0; i < 8; i++) {
            header[i] = buffer.readUInt32BE(i * 4);
        }
        // Check to see if the header is valid. If its not we might have gotten out of sync.
        if (header[0] !== 1 || header[1] !== 1) {
            throw new Error('Invalid PeMicro header start');
        }
        cls.type = header[2];
        cls.sequence = header[3];
        const messageLength = header[4];
        if (messageLength < PeMicroHeader.headerLength)
        {
            throw new Error('Message length smaller than header');
        }
        cls.dataLength = messageLength - PeMicroHeader.headerLength;
        if (header[5] !== 0 || header[6] !== 0 || header[7] !== 0) {
            throw new Error('Invalid PeMicro header end');
        }
        return cls;
    }

    public getTxString(): string {
        const header = Buffer.alloc(32);
        header.writeUInt32BE(1, 0 * 4); // No idea seems to always be 1
        header.writeUInt32BE(1, 1 * 4); // No idea seems to always be 1
        header.writeUInt32BE(PeHeaderType.TX_COMMAND, 2 * 4); // packet type
        header.writeUInt32BE(this.sequence, 3 * 4); // Sequence number
        header.writeUInt32BE(PeMicroHeader.headerLength + this.dataLength, 4 * 4); // Size
        header.writeUInt32BE(0, 5 * 4); // No idea seems to always be 0
        header.writeUInt32BE(0, 6 * 4); // No idea seems to always be 0
        header.writeUInt32BE(0, 7 * 4); // No idea seems to always be 0
        const decoder = new TextDecoder();
        return decoder.decode(header);
    }
}

enum PeState {
    INIT = 1,
    CREATE_PIPE,
    CONFIGURE_SWO,
    RESUME_PIPE,
    RECEIVING,
    RESERVED
}

export class PeMicroSocketSource extends SocketSWOSource {
    private sequence = 0;
    private state: PeState = PeState.INIT;

    private createPipe(): void {
        const createPipe = {
            control: {
                '00000001': {
                    command: 'createPipe',
                    apiversion: '1'
                }
            }
        };
        this.write(JSON.stringify(createPipe));
    }

    private configureSWO(): void {
        const configureSWO = {
            control: {
                '00000001': {
                    command: 'configureSWOStream',
                    streamEnabled: 'true',
                    itmStimulusPortEnable: '-1',
                    postCNTEventEnable: 'false',
                    pcSamplingEnable: 'false',
                    postCNTClockRate: 'false',
                    localTimestamps: 'false',
                    localTSClock: 'false',
                    localTSPrescale: '0',
                    globalTSFrequency: '0',
                    CPI: 'false',
                    SLEEP: 'false',
                    FOLD: 'false',
                    EXCOVER: 'false',
                    LSU: 'false',
                    EXCTRC: 'false',
                    SYNC: '0'
                }
            }
        };
        this.write(JSON.stringify(configureSWO));
    }

    private resumePipe(): void {
        const resumePipe = {
            control: {
                '00000001': {
                    command: 'resumePipe'
                }
            }
        };
        this.write(JSON.stringify(resumePipe));
    }

    constructor(tcpPort: string) {
        super(tcpPort);
        this.on('connected', () => {
            // When we connect we need to start a sequence of commands to configure the SWO stream.
            // It starts with create pipe and is continued in the data callback
            this.state = PeState.CREATE_PIPE;
            this.createPipe();
        });
    }

    protected processData(buffer: Buffer): void {
        let offset = 0;
        // PeMicro streams data in packets. Each packet has a 32 byte header, followed by the data
        // It only sends one packet per TCP packet, but this interface concatenates TCP packets
        // So we may need to process multiple in one callback
        while ((buffer.length - offset) >= PeMicroHeader.headerLength) {
            try {
                const header = PeMicroHeader.fromBuffer(buffer.subarray(offset, Math.min(offset + PeMicroHeader.headerLength, buffer.length)));
                // skip over header
                offset = offset + PeMicroHeader.headerLength;
                switch (this.state) {
                    case PeState.CREATE_PIPE: {
                        if (header.type === PeHeaderType.RX_COMMAND) {
                            const response = JSON.parse(buffer.subarray(offset, Math.min(offset + header.dataLength, buffer.length)).toString());
                            if (response.control['00000001'].result === 0) {
                                this.configureSWO();
                                this.state = PeState.CONFIGURE_SWO;
                            }
                        }
                        break;
                    }
                    case PeState.CONFIGURE_SWO: {
                        if (header.type === PeHeaderType.RX_COMMAND) {
                            const response = JSON.parse(buffer.subarray(offset, Math.min(offset + header.dataLength, buffer.length)).toString());
                            if (response.control['00000001'].result === 0) {
                                this.resumePipe();
                                this.state = PeState.RESUME_PIPE;
                            }
                        }
                        break;
                    }
                    case PeState.RESUME_PIPE: {
                        if (header.type === PeHeaderType.RX_COMMAND) {
                            const response = JSON.parse(buffer.subarray(offset, Math.min(offset + header.dataLength, buffer.length)).toString());
                            if (response.control['00000001'].result === 0) {
                                this.state = PeState.RECEIVING;
                            }
                        }
                        break;
                    }
                    case PeState.RECEIVING: {
                        if (header.type === PeHeaderType.RX_STREAM) {
                            this.emit('data', buffer.subarray(offset, Math.min(offset + header.dataLength, buffer.length)));
                        }
                        break;
                    }
                }
                offset = offset + header.dataLength;
            } catch (err) {
                console.log(err.message);
                // If we couldn't decode the header, just discard the data.
                // Its probably garbage or out of sync, so upstream would be confused anyway
            }
            
        }
    }

    public write(data) {
        try {
            const header = PeMicroHeader.fromValues(PeHeaderType.TX_COMMAND, this.sequence, data.length);
            this.client.write(header.getTxString() + data);
            this.sequence = this.sequence + 1;
        }
        catch (e) {
            throw e;
        }
    }
}
