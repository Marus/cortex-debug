import { Event } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';

export class AdapterOutputEvent extends Event implements DebugProtocol.Event {
	body: {
		type: string,
		content: string
	};
	event: string;

	constructor(content: string, type: string) {
		super('adapter-output', { content: content, type: type });
	}
}

export class SWOConfigureEvent extends Event implements DebugProtocol.Event {
	body: {
		type: string,
		port: number,
		path: string
	};
	event: string;

	constructor(type: string, params: any) {
		let body = { type: type, ...params };
		super('swo-configure', body);
	}
}

export function makeObjectFromArrays(arrays: any[]) {
	let obj = {};
	arrays.forEach((arr, index) => {
		let key = arr[0];
		let value = arr[1];
		obj[key] = value;
	});
	return obj;
}

export class TelemetryEvent extends Event implements DebugProtocol.Event {
	body: {
		event: string,
		parameters: { [key: string]: string },
		measures: { [key: string]: number }
	};
	event: string;

	constructor(event: string, parameters: { [key: string]: string }, measures: { [key: string]: number }) {
		let body = { event: event, parameters: parameters, measures: measures };
		super('record-telemetry-event', body);
	}
}