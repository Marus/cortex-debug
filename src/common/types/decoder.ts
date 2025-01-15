export enum BinaryEncoding {
    UNSIGNED = 'unsigned',
    SIGNED = 'signed',
    Q1616 = 'q16.16',
    FLOAT = 'float'
}

export enum TextEncoding {
    UTF8 = 'utf8',
    UTF16LE = 'utf16le',
    ASCII = 'ascii',
    UCS2 = 'ucs2'
}

export interface CommonDecoderConfig {
    logfile: string;
}

export interface BasicDecoderConfig extends CommonDecoderConfig {
    port: number;
    number?: number;    // legacy port number property
}

export interface ConsoleDecoderConfig extends BasicDecoderConfig {
    label: string;
    encoding: TextEncoding;
    timestamp: boolean;
}

export interface BinaryDecoderConfig extends BasicDecoderConfig {
    encoding: BinaryEncoding;
    scale: number;
    label: string;
}

export interface GraphDecoderConfig extends BasicDecoderConfig {
    encoding: BinaryEncoding;
    scale: number;
    graphId: string;
}

export interface AdvancedDecoderConfig {
    decoder: string;
    config: any;
    ports: number[];
    number?: number;    // legacy port number property
}
