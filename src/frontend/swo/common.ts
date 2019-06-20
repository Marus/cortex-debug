export interface SWODecoderConfig {
    type: string;
}

export interface SWOBasicDecoderConfig extends SWODecoderConfig {
    port: number;
}

export interface SWOConsoleDecoderConfig extends SWOBasicDecoderConfig {
    label: string;
    encoding: string;
    showOnStartup: boolean;
}

export interface SWOBinaryDecoderConfig extends SWOBasicDecoderConfig {
    encoding: string;
    scale: number;
    label: string;
}

export interface SWOGraphDecoderConfig extends SWOBasicDecoderConfig {
    encoding: string;
    scale: number;
    graphId: string;
}

export interface SWOAdvancedDecoderConfig extends SWODecoderConfig {
    decoder: string;
    config: any;
    ports: number[];
}

export interface GraphConfiguration {
    type: string;
    label: string;
}

export interface TimeseriesGraphConfiguration extends GraphConfiguration {
    minimum: number;
    maximum: number;
    timespan: number;
    plots: Array<{
        graphId: string,
        label: string,
        color: string
    }>;
}

export interface XYGraphConfiguration extends GraphConfiguration {
    xPort: number;
    yPort: number;
    xMinimum: number;
    xMaximum: number;
    yMinimum: number;
    yMaximum: number;
    initialX: number;
    initialY: number;
    timespan: number;
    xGraphId: string;
    yGraphId: string;
}

export interface GrapherMessage {
    timestamp?: number;
    type: 'configure' | 'status' | 'data' | 'program-counter' | 'init';
}

export interface GrapherStatusMessage extends GrapherMessage {
    status: 'stopped' | 'terminated' | 'continued';
}

export interface GrapherDataMessage extends GrapherMessage {
    id: string;
    data: number;
}

export interface GrapherProgramCounterMessage extends GrapherMessage {
    function: string;
    counter: number;
}

export interface GrapherConfigurationMessage extends GrapherMessage {
    graphs: [GraphConfiguration];
    status: 'stopped' | 'terminated' | 'continued';
}

export interface AdvancedDecoder {
    init(
        config: SWOAdvancedDecoderConfig,
        outputData: (output: string) => void,
        graphData: (data: number, id: string) => void
    ): void;
    typeName(): string;
    outputLabel(): string;
    softwareEvent(port: number, data: Buffer): void;
    synchronized(): void;
    lostSynchronization(): void;
}

export enum PacketType {
    HARDWARE = 1,
    SOFTWARE,
    TIMESTAMP
}

export enum TimestampType {
    CURRENT,
    DELAYED,
    EVENT_DELAYED,
    EVENT_TIME_DELAYED
}

export interface TimestampPacket {
    type: TimestampType;
    timestamp: number;
}

export interface Packet {
    type: PacketType;
    port: number;
    size: number;
    data: Buffer;
}
