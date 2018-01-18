import { MI2DebugSession } from './mibase';
import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, Thread, StackFrame, Scope, Source, Handles } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { MI2 } from "./backend/mi2/mi2";
import { hexFormat } from './frontend/utils';
import { TelemetryEvent } from './common';

export class GDBDebugSession extends MI2DebugSession {
	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		response.body.supportsHitConditionalBreakpoints = true;
		response.body.supportsConfigurationDoneRequest = true;
		response.body.supportsConditionalBreakpoints = true;
		response.body.supportsFunctionBreakpoints = true;
		response.body.supportsEvaluateForHovers = true;
		response.body.supportsSetVariable = true;
		response.body.supportsRestartRequest = true;
		this.sendResponse(response);
	}

	protected customRequest(command: string, response: DebugProtocol.Response, args: any): void {
		switch(command) {
			case 'read-memory':
				this.readMemoryRequest(response, args['address'], args['length']);	
				break;
			case 'write-memory':
				this.writeMemoryRequest(response, args['address'], args['data']);
				break;
			case 'read-registers':
				this.readRegistersRequest(response);
				break;
			case 'read-register-list':
				this.readRegisterListRequest(response);
				break;
			case 'execute-command':
				let cmd = args['command'] as string;
				if(cmd.startsWith('-')) { cmd = cmd.substring(1); }
				else { cmd = `interpreter-exec console "${cmd}"`; }
				this.miDebugger.sendCommand(cmd).then(node => {
					response.body = node.resultRecords;
					this.sendResponse(response);
				}, error => {
					response.body = error;
					this.sendErrorResponse(response, 110, "Unable to execute command");
				});
				break;
			default:
				response.body = { 'error': 'Invalid command.' };
				this.sendResponse(response);
				break;
		}
	}

	protected readMemoryRequest(response: DebugProtocol.Response, startAddress: number, length: number) {
		let address = hexFormat(startAddress, 8);
		this.miDebugger.sendCommand(`data-read-memory-bytes ${address} ${length}`).then(node => {
			let startAddress = node.resultRecords.results[0][1][0][0][1];
			let endAddress = node.resultRecords.results[0][1][0][2][1];
			let data = node.resultRecords.results[0][1][0][3][1];
			let bytes = data.match(/[0-9a-f]{2}/g).map(b => parseInt(b, 16));
			response.body = {
				startAddress: startAddress,
				endAddress: endAddress,
				bytes: bytes
			};
			this.sendResponse(response);
		}, error => {
			response.body = { 'error': error };
			this.sendErrorResponse(response, 114, `Unable to read memory: ${error.toString()}`);
			this.sendEvent(new TelemetryEvent('error-reading-memory', { address: startAddress.toString(), length: length.toString() }, {}));
		});
	}

	protected writeMemoryRequest(response: DebugProtocol.Response, startAddress: number, data: string) {
		let address = hexFormat(startAddress, 8);
		this.miDebugger.sendCommand(`data-write-memory-bytes ${address} ${data}`).then(node => {
			this.sendResponse(response);
		}, error => {
			response.body = { 'error': error };
			this.sendErrorResponse(response, 114, `Unable to write memory: ${error.toString()}`);
			this.sendEvent(new TelemetryEvent('error-writing-memory', { address: startAddress.toString(), length: data.length.toString() }, {}));
		});
	}

	protected readRegistersRequest(response: DebugProtocol.Response) {
		this.miDebugger.sendCommand('data-list-register-values x').then(node => {
			if (node.resultRecords.resultClass == 'done') {
				let rv = node.resultRecords.results[0][1];
				response.body = rv.map(n => {
					let val = {};
					n.forEach(x => {
						val[x[0]] = x[1];
					});
					return val;
				});
			}
			else {
				response.body = {
					'error': 'Unable to parse response'
				}
			}
			this.sendResponse(response);	
		}, error => {
			response.body = { 'error': error };
			this.sendErrorResponse(response, 115, `Unable to read registers: ${error.toString()}`);
			this.sendEvent(new TelemetryEvent('error-reading-registers', {}, {}));
		});
	}

	protected readRegisterListRequest(response: DebugProtocol.Response) {
		this.miDebugger.sendCommand('data-list-register-names').then(node => {
			if (node.resultRecords.resultClass == 'done') {
				let registerNames;
				node.resultRecords.results.forEach(rr => {
					if (rr[0] == 'register-names') {
						registerNames = rr[1];
					}
				});
				response.body = registerNames;
			}
			else {
				response.body = { 'error': node.resultRecords.results };
			}
			this.sendResponse(response);
		}, error => {
			response.body = { 'error': error };
			this.sendErrorResponse(response, 116, `Unable to read register list: ${error.toString()}`);
			this.sendEvent(new TelemetryEvent('error-reading-register-list', {}, {}));
		});
	}

	public calculateSWOPortMask(configuration: any[]) {
		let mask: number = 0;
		configuration.forEach(c => {
			if (c.type == 'advanced') {
				for (let port of c.ports) {
					mask = (mask | (1 << port)) >>> 0;
				}
			}
			else {
				mask = (mask | (1 << c.port)) >>> 0;
			}
		});
		return mask;
	}
}
