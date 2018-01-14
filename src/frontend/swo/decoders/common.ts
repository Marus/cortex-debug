export interface SWOProcessor {
	port: number;
	format: string;

	processMessage(buffer: Buffer);
	dispose();
}