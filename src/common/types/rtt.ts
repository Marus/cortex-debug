import { AdvancedDecoderConfig, BasicDecoderConfig, BinaryDecoderConfig, ConsoleDecoderConfig, GraphDecoderConfig } from './decoder';

export enum TerminalInputMode {
    COOKED = 'cooked',
    RAW = 'raw',
    RAWECHO = 'rawecho',
    DISABLED = 'disabled'
}

export interface RTTCommonDecoderOpts {
    noclear: boolean;   // do not clear screen buffer on connect
    logfile: string;    // log IO to file
}

export interface RTTBasicDecoderOpts extends RTTCommonDecoderOpts, BasicDecoderConfig {
    tcpPort: string;  // [hostname:]port
}

export interface RTTCommonTerminalDecoderOpts extends RTTBasicDecoderOpts {
    label: string;      // label for window
    prompt: string;     // Prompt to use
    noprompt: boolean;  // disable prompt
    inputmode: TerminalInputMode;
}

export interface RTTConsoleDecoderOpts extends RTTBasicDecoderOpts, RTTCommonTerminalDecoderOpts, ConsoleDecoderConfig {
    type: 'console';
}

export interface RTTBinaryDecoderOpts extends RTTBasicDecoderOpts, RTTCommonTerminalDecoderOpts, BinaryDecoderConfig {
    type: 'binary';
}

export type RTTTerminalDecoderOpts = RTTBinaryDecoderOpts | RTTConsoleDecoderOpts;

export interface RTTGraphDecoderOpts extends RTTBasicDecoderOpts, GraphDecoderConfig {
    type: 'graph';
}

export interface RTTAdvancedDecoderOpts extends RTTCommonDecoderOpts, AdvancedDecoderConfig {
    type: 'advanced';
    tcpPorts: string[];
}

export type RTTDecoderOpts = RTTConsoleDecoderOpts | RTTBinaryDecoderOpts | RTTGraphDecoderOpts | RTTAdvancedDecoderOpts;

export interface RTTConfiguration {
    enabled: boolean;
    address?: string;
    searchSize?: number;
    searchId?: string;
    clearSearch?: boolean;
    polling_interval?: number;
    rtt_start_retry?: number;
    decoders: RTTDecoderOpts[];
}
