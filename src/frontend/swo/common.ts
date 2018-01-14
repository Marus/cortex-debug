export interface SWOPortConfig {
	type: string;
	number: number;
}

export interface SWOConsolePortConfig extends SWOPortConfig {
	label: string;
}

export interface SWOBinaryPortConfig extends SWOPortConfig {
	encoding: string;
	scale: number;
	label: string;
}

export interface SWOGraphPortConfig extends SWOPortConfig {
	encoding: string;
	scale: number;
	graphId: string;
}

export interface SWOAdvancedPortConfig extends SWOPortConfig {
	decoder: string;
	config: any;
}

export interface GraphConfiguration {
	type: string;
	label: string;
}

export interface RealtimeGraphConfiguration extends GraphConfiguration {
	minimum: number;
	maximum: number;
	ports: {
		number: number,
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

export interface WebsocketStatusMessage extends WebsocketMessage {
	status: string;
}

export interface AdvancedDecoder {
	name: string;

	processData(buffer: Buffer): void;
	outputLabel(): string;
}