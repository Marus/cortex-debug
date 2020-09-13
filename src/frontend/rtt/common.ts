export interface RTTDecoderConfig {
    type: string;
}

export interface RTTBasicDecoderConfig extends RTTDecoderConfig {
    channel: number;
}

export interface RTTConsoleDecoderConfig extends RTTBasicDecoderConfig {
    label: string;
    encoding: string;
    showOnStartup: boolean;
    timestamp: boolean;
}
