export interface SWODecoderConfig {
	type: string;
}

export interface SWOBasicDecoderConfig extends SWODecoderConfig {
	port: number;
}

export interface SWOConsoleDecoderConfig extends SWOBasicDecoderConfig {
	label: string;
	encoding: string;
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
	ports: number[]
}

export interface GraphConfiguration {
	type: string;
	label: string;
}

export interface RealtimeGraphConfiguration extends GraphConfiguration {
	minimum: number;
	maximum: number;
	plots: {
		graphId: number,
		label: string,
		color: string
	}[];
}

export interface XYGraphConfiguration extends GraphConfiguration {
	xPort: number;
	yPort: number;
	xMinimum: number;
	xMaximum: number;
	yMinimum: number;
	yMaximum: number;
}

export interface WebsocketMessage {
	type: string;
}

export interface WebsocketDataMessage extends WebsocketMessage {
	timestamp: number;
	data: number;
	id: string;
}

export interface WebsocketProgramCounterMessage extends WebsocketMessage {
	timestamp: number;
	counter: number;
	function: string;
}

export interface WebsocketStatusMessage extends WebsocketMessage {
	status: string;
}

export interface AdvancedDecoder {
	name: string;

	processData(buffer: Buffer): void;
	outputLabel(): string;
}

export enum PacketType {
	HARDWARE = 1,
	SOFTWARE,
	TIMESTAMP
};

export enum TimestampType {
	CURRENT,
	DELAYED,
	EVENT_DELAYED,
	EVENT_TIME_DELAYED
};

export interface TimestampPacket {
	type: TimestampType,
	timestamp: number;
}

export interface Packet {
	type: PacketType;
	port: number;
	size: number;
	data: Buffer;
}