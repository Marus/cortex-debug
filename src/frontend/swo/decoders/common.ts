export interface SWODecoder {
	format: string;

	processMessage(buffer: Buffer);
	dispose();
}