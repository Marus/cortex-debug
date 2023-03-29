import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import { SWOConsoleProcessor } from './decoders/console';
import { SWOBinaryProcessor } from './decoders/binary';
import { SWORTTGraphProcessor } from './decoders/graph';
import { SWORTTDecoder } from './decoders/common';
import { SWORTTSource } from './sources/common';
import { SWODecoderConfig, GraphConfiguration, SWOAdvancedDecoderConfig,
    SWOBinaryDecoderConfig, SWOConsoleDecoderConfig, SWOGraphDecoderConfig,
    SWOBasicDecoderConfig, GrapherMessage, GrapherStatusMessage,
    GrapherProgramCounterMessage} from './common';
import { SWORTTAdvancedProcessor } from './decoders/advanced';
import { EventEmitter } from 'events';
import { PacketType, Packet } from './common';
import { parseUnsigned } from './decoders/utils';
import { SymbolInformation } from '../../symbols';
import { getNonce, RTTCommonDecoderOpts } from '../../common';
import { SocketRTTSource, SocketSWOSource } from './sources/socket';

const RingBuffer = require('ringbufferjs');

enum Status {
    IDLE = 1,
    UNSYNCED,
    TIMESTAMP,
    HARDWARE_EVENT,
    SOFTWARE_EVENT,
    RESERVED
}

const LENGTH_MASK = 0b00000011;
const OVERFLOW_MASK = 0b01110000;
const HARDWARE_MASK = 0b00000100;
const PORT_MASK = 0b11111000;
const TIMESTAMP_MASK = 0b00001111;

class ITMDecoder extends EventEmitter {
    private syncBuffer = new RingBuffer(6);
    private status: Status = Status.IDLE;
    
    private rxCount: number = 0;
    private rxBuffer: Buffer;
    private rxPort: number;
    private rxTargetLength: number;
    private rxPacketType: PacketType;
    private timestamp: number = 0;

    constructor() {
        super();
        
        this.syncBuffer.enq(0xFF);
        this.syncBuffer.enq(0xFF);
        this.syncBuffer.enq(0xFF);
        this.syncBuffer.enq(0xFF);
        this.syncBuffer.enq(0xFF);
        this.syncBuffer.enq(0xFF);
        // Prefill the sync buffer
    }

    private resetRxPacket(port: number, length: number, type: PacketType) {
        this.rxBuffer = Buffer.alloc(length, 0);

        this.rxTargetLength = length;
        this.rxPacketType = type;
        this.rxPort = port;
        this.rxCount = 0;
    }

    private rxWriteByte(byte: number): boolean {
        if (this.rxCount < this.rxBuffer.length) {
            this.rxBuffer.writeUInt8(byte, this.rxCount);
            this.rxCount++;
        }
        return this.rxCount === this.rxTargetLength;
    }

    private getRxPacket(): Packet {
        return {
            type: this.rxPacketType,
            port: this.rxPort,
            size: this.rxCount,
            data: this.rxBuffer
        };
    }

    private checkSync(byte: number) {
        this.syncBuffer.enq(byte);
        const bytes: number[] = this.syncBuffer.peekN(6);
        return (bytes[5] === 0x80 && bytes[4] === 0x00 && bytes[3] === 0x00 && bytes[2] === 0x00 && bytes[1] === 0x00 && bytes[0] === 0x00);
    }

    public processByte(byte: number) {
        let newStatus: Status = this.status;

        if (this.checkSync(byte)) { // check for completed sync
            newStatus = Status.IDLE;
            this.emit('synchronized');
        }
        else {
            switch (this.status) {
                case Status.IDLE:
                    if (byte === 0x00) { break; } // Sync Packet
                    else if (byte === 0b01110000) { this.emit('overflow'); }
                    else if ((byte & TIMESTAMP_MASK) === 0x00) {
                        this.timestamp = 0;
                        this.resetRxPacket(-1, 5, PacketType.TIMESTAMP);
                        this.rxWriteByte(byte);
                                                
                        if (byte & 0x80) {
                            newStatus = Status.TIMESTAMP;
                        }
                        else {
                            this.emit('timestamp', this.getRxPacket());
                        }
                    }
                    else if ((byte & LENGTH_MASK) !== 0x00) {
                        let count = byte & 0x03;
                        if (count === 3) { count = 4; }

                        const port = (byte & PORT_MASK) >>> 3;
                        
                        if ((byte & HARDWARE_MASK) !== 0) {
                            this.resetRxPacket(port, count, PacketType.HARDWARE);
                            newStatus = Status.HARDWARE_EVENT;
                        }
                        else {
                            this.resetRxPacket(port, count, PacketType.SOFTWARE);
                            newStatus = Status.SOFTWARE_EVENT;
                        }
                    }
                    else {
                        newStatus = Status.RESERVED;
                        this.emit('lost-synchronization');
                    }
                    break;
                case Status.TIMESTAMP:
                    const receivedMax = this.rxWriteByte(byte);
                    // Check if the continuation bit is false.
                    // This indicates the last byte in a timestamp
                    if ((byte & 0x80) === 0x00) {
                        this.emit('timestamp', this.getRxPacket());
                        newStatus = Status.IDLE;
                    } else if (receivedMax) {
                        // A timestamp is at most 5 packets. If we didn't see the continuation bit false, something has gone wrong
                        // This often happens with PeMicro because it starts sending garbage after a clock change.
                        // In theory we should go to UNSYNCED, but that leads to never recovering.
                        // Going back to IDLE allows recovery when it stops sending garbage
                        newStatus = Status.IDLE;
                    }
                    break;
                case Status.UNSYNCED:
                    break;
                case Status.SOFTWARE_EVENT:
                    if (this.rxWriteByte(byte)) {
                        this.emit('software-event', this.getRxPacket());
                        newStatus = Status.IDLE;
                    }
                    break;
                case Status.HARDWARE_EVENT:
                    if (this.rxWriteByte(byte)) {
                        this.emit('hardware-event', this.getRxPacket());
                        newStatus = Status.IDLE;
                    }
                    break;
                case Status.RESERVED:
                    if ((byte & 0x80) === 0x00) {
                        newStatus = Status.IDLE;
                    }
                    break;
            }
        }

        this.status = newStatus;
    }
}

interface ConfigurationArguments {
    executable: string;
    swoConfig: {
        enabled: boolean,
        decoders: SWODecoderConfig[]
    };
    rttConfig: {
        enabled: boolean,
        decoders: RTTCommonDecoderOpts[]
    };
    graphConfig: GraphConfiguration[];
}

class SWOWebview {
    private viewPanel: vscode.WebviewPanel;
    private currentStatus: 'stopped' | 'terminated' | 'continued' = 'stopped';
    private now: Date;

    constructor(private extensionPath: string, public graphs: GraphConfiguration[]) {
        this.now = new Date();
        const time = this.now.toTimeString();

        const showOptions = { preserveFocus: true, viewColumn: vscode.ViewColumn.Beside };
        const viewOptions: vscode.WebviewOptions & vscode.WebviewPanelOptions = {
            retainContextWhenHidden: true,
            enableFindWidget: false,
            enableCommandUris: false,
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(path.join(extensionPath, 'dist'))]
        };

        const title = `SWO/RTT Graphs [${time}]`;
        this.viewPanel = vscode.window.createWebviewPanel('cortex-debug.grapher', title, showOptions, viewOptions);
        this.viewPanel.webview.onDidReceiveMessage((msg) => { this.onMessage(msg); });
        this.viewPanel.webview.html = this.getHTML();
    }

    private getHTML() {
        const onDiskPath = vscode.Uri.file(path.join(this.extensionPath, 'dist', 'grapher.bundle.js'));
        const scriptUri = this.viewPanel.webview.asWebviewUri(onDiskPath);
        
        const nonce = getNonce();

        let html = fs.readFileSync(path.join(this.extensionPath, 'resources', 'grapher.html'), { encoding: 'utf8', flag: 'r' });
        html = html.replace(/\$\{nonce\}/g, nonce).replace(/\$\{scriptUri\}/g, scriptUri.toString());

        return html;
    }

    private processors: Array<SWORTTGraphProcessor | SWORTTAdvancedProcessor> = [];
    public registerProcessors(processor: SWORTTGraphProcessor | SWORTTAdvancedProcessor): void {
        processor.on('message', this.sendMessage.bind(this));
        this.processors.push(processor);
    }

    public clearProcessors(): void {
        this.processors = [];
    }

    private lastId: number = 0;
    public sendMessage(message: GrapherMessage): void {
        message.timestamp = new Date().getTime();
        this.viewPanel.webview.postMessage(message);
    }

    private onMessage(message: GrapherMessage) {
        if (message.type === 'init') {
            const message = { type: 'configure', graphs: this.graphs, status: this.currentStatus };
            this.viewPanel.webview.postMessage(message);
        }
    }
}

export class SWORTTCoreBase {
    protected webview: SWOWebview = null;

    public debugSessionTerminated() {
        if (this.webview) {
            const message: GrapherStatusMessage = { type: 'status', status: 'terminated' };
            this.webview.sendMessage(message);
        }
    }

    public debugStopped() {
        if (this.webview) {
            const message: GrapherStatusMessage = { type: 'status', status: 'stopped' };
            this.webview.sendMessage(message);
        }
    }

    public debugContinued() {
        if (this.webview) {
            const message: GrapherStatusMessage = { type: 'status', status: 'continued' };
            this.webview.sendMessage(message);
        }
    }
    
}

export class SWOCore extends SWORTTCoreBase {
    private processors: SWORTTDecoder[] = [];
    private connected: boolean = false;
    private itmDecoder: ITMDecoder;
    private functionSymbols: SymbolInformation[];

    constructor(private session: vscode.DebugSession, private source: SWORTTSource, args: ConfigurationArguments, extensionPath: string) {
        super();
        this.itmDecoder = new ITMDecoder();
        session.customRequest('load-function-symbols').then((result) => {
            this.functionSymbols = result.functionSymbols;
        }, (error) => {
            this.functionSymbols = [];
        });
        
        if (this.source.connected) { this.connected = true; }
        else { this.source.on('connected', () => { this.connected = true; }); }
        this.source.on('data', this.handleData.bind(this));
        this.source.on('disconnected', this.handleDisconnected.bind(this));

        if (args.graphConfig.length >= 1) {
            this.webview = new SWOWebview(extensionPath, args.graphConfig);
        }
        
        args.swoConfig.decoders.forEach((conf) => {
            let processor;

            switch (conf.type) {
                case 'console':
                    this.processors.push(new SWOConsoleProcessor(conf as SWOConsoleDecoderConfig));
                    break;
                case 'binary':
                    this.processors.push(new SWOBinaryProcessor(conf as SWOBinaryDecoderConfig));
                    break;
                case 'graph':
                    processor = new SWORTTGraphProcessor(conf as SWOGraphDecoderConfig);
                    if (this.webview) { this.webview.registerProcessors(processor); }
                    this.processors.push(processor);
                    break;
                case 'advanced':
                    try {
                        processor = new SWORTTAdvancedProcessor(conf as SWOAdvancedDecoderConfig);
                        if (this.webview) { this.webview.registerProcessors(processor); }
                        this.processors.push(processor);
                    }
                    catch (e) {
                        vscode.window.showErrorMessage(`Error Initializing Advanced Decoder: ${e.toString()}`);
                    }
                    break;
                default:
                    break;
            }
        });

        this.itmDecoder.on('software-event', this.processPacket.bind(this));
        this.itmDecoder.on('hardware-event', this.processPacket.bind(this));
        this.itmDecoder.on('synchronized', this.synchronized.bind(this));
        this.itmDecoder.on('lost-synchronization', this.lostSynchronization.bind(this));
        this.itmDecoder.on('timestamp', this.processTimestampPacket.bind(this));
        this.itmDecoder.on('overflow', this.overflow.bind(this));
    }

    private handleDisconnected(data: Buffer) {
        for (const p of this.processors) {
            p.close();
        }
        this.processors = [];
        this.connected = false;
    }

    private handleData(data: Buffer) {
        for (let i = 0; i < data.length; i++) {
            const byte = data.readUInt8(i);
            this.itmDecoder.processByte(byte);
        }
    }

    private processPacket(packet: Packet) {
        if (packet.type === PacketType.SOFTWARE) {
            this.processors.forEach((p) => p.softwareEvent(packet));
        }
        else if (packet.type === PacketType.HARDWARE) {
            this.processors.forEach((p) => p.hardwareEvent(packet));
            if (packet.port === 2) {
                if (this.webview) {
                    const pc = parseUnsigned(packet.data);
                    const symbol = this.getFunctionAtAddress(pc);

                    const message: GrapherProgramCounterMessage = {
                        type: 'program-counter',
                        counter: pc,
                        function: symbol ? symbol.name : '**Unknown**'
                    };
                    this.webview.sendMessage(message);
                }
            }
            else {
                // tslint:disable-next-line:no-console
                console.log('Received Other Hardware Packet: ', packet);
            }
        }
    }

    private processTimestampPacket(packet: Packet) {
        let timestamp = 0;
        for (let i = 1; i < packet.size; i++) {
            timestamp = timestamp << 7;
            const bits = packet.data.readUInt8(i) & 0x7F;
            timestamp = timestamp | bits;
        }
    }

    private overflow() {}

    private lostSynchronization() {
        this.processors.forEach((p) => p.lostSynchronization());
    }

    private synchronized() {
        this.processors.forEach((p) => p.synchronized());
    }

    private calculatePortMask(configuration: SWODecoderConfig[]) {
        let mask: number = 0;
        configuration.forEach((c) => {
            if (c.type === 'advanced') {
                const ac = c as SWOAdvancedDecoderConfig;
                for (const port of ac.ports) {
                    mask = (mask | (1 << port)) >>> 0;
                }
            }
            else {
                const bc = c as SWOBasicDecoderConfig;
                mask = (mask | (1 << bc.port)) >>> 0;
            }
        });
        return mask;
    }

    public dispose() {
        this.processors.forEach((p) => p.dispose());
        this.processors = null;
        if (this.webview) {
            this.webview.clearProcessors();
        }
        this.connected = false;
    }

    public getFunctionAtAddress(address: number): SymbolInformation {
        const matches = this.functionSymbols.filter((s) => s.address <= address && (s.address + s.length) > address);
        if (!matches || matches.length === 0) { return undefined; }

        return matches[0];
    }
}

class RTTDecoder extends EventEmitter {
    public readonly buffer: Buffer;
    public connected = false;
    private bytesRead: number = 0;

    constructor(
        public readonly source: SocketSWOSource,
        public readonly port: number,       // Thisis the rtt channel
        public readonly bytesNeeded: number) {
        super();
        this.buffer = Buffer.alloc(bytesNeeded);

        if (this.source.connected) { this.connected = true; }
        else { this.source.on('connected', () => { this.connected = true; }); }

        this.source.on('data', this.onData.bind(this));
        this.source.on('disconnected', () => { this.connected = false; });
    }

    public onData(input: string | Buffer) {
        const data: Buffer = ((typeof input) === 'string') ? Buffer.from(input) : (input as Buffer) ;
        for (const elt of data) {
            this.buffer[this.bytesRead] = elt;
            this.bytesRead = this.bytesRead + 1;
            if (this.bytesRead === this.bytesNeeded) {
                const packet = {
                    type: PacketType.SOFTWARE,
                    port: this.port,
                    size: this.bytesRead,
                    data: Buffer.from(this.buffer)
                };
                this.emit('software-event', packet);
                this.bytesRead = 0;
            }
        }
    }

    public dispose() {}
}

export class RTTCore extends SWORTTCoreBase {
    private processors: SWORTTDecoder[] = [];
    protected decoders: RTTDecoder[] = [];

    constructor(private sources: {[channel: number]: SocketRTTSource}, args: ConfigurationArguments, extensionPath: string) {
        super();

        if (args.graphConfig.length >= 1) {
            this.webview = new SWOWebview(extensionPath, args.graphConfig);
        }

        args.rttConfig.decoders.forEach((conf) => {
            switch (conf.type) {
                case 'graph':
                    this.addRTTDecoder(this.sources[conf.port]);
                    const processor = new SWORTTGraphProcessor(conf as any as SWOGraphDecoderConfig);
                    if (this.webview) { this.webview.registerProcessors(processor); }
                    this.processors.push(processor);
                    break;
                case 'advanced':
                    try {
                        for (const p of conf.ports) {
                            this.addRTTDecoder(this.sources[p]);
                        }
                        const processor = new SWORTTAdvancedProcessor(conf as any as SWOAdvancedDecoderConfig);
                        if (this.webview) { this.webview.registerProcessors(processor); }
                        this.processors.push(processor);
                        break;
                    }
                    catch (e) {
                        vscode.window.showErrorMessage(`Error Initializing Advanced Decoder: ${e.toString()}`);
                    }
                default:
                    break;
            }
        });
    }

    private addRTTDecoder(src: SocketRTTSource) {
        if (src) {
            const dec = new RTTDecoder(src, src.channel, 4);
            dec.on('software-event', this.onPacket.bind(this));
            this.decoders.push(dec);
        }
        else {
            console.error('Null source?');
        }
    }

    private onPacket(packet: Packet) {
        for (const p of this.processors) {
            p.softwareEvent(packet);
        }
    }

    public dispose() {
        this.processors.forEach((p) => p.dispose());
        this.processors = null;
        if (this.webview) {
            this.webview.clearProcessors();
        }
    }
}
