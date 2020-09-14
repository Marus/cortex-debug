export interface RTTDecoder {
    format: string;

    data(buffer: Buffer);
    dispose();
}
