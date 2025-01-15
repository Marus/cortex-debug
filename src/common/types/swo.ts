import { AdvancedDecoderConfig, BinaryDecoderConfig, ConsoleDecoderConfig, GraphDecoderConfig } from './decoder';

export interface SWOConsoleDecoderConfig extends ConsoleDecoderConfig {
    type: 'console';
    showOnStartup: boolean;
}

export interface SWOBinaryDecoderConfig extends BinaryDecoderConfig {
    type: 'binary';
}

export interface SWOGraphDecoderConfig extends GraphDecoderConfig {
    type: 'graph';
}

export interface SWOAdvancedDecoderConfig extends AdvancedDecoderConfig {
    type: 'advanced';
}

export type SWODecoderConfig =
    SWOConsoleDecoderConfig |
    SWOBinaryDecoderConfig |
    SWOGraphDecoderConfig |
    SWOAdvancedDecoderConfig;

export interface SWOConfiguration {
    enabled: boolean;
    cpuFrequency: number;
    swoFrequency: number;
    decoders: SWODecoderConfig[];
    ports?: SWODecoderConfig[]; // legacy property
    profile?: boolean;
    source: string;
    swoPort?: string;
    swoPath?: string;
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
