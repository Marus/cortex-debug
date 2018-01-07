import { DebugSession, InitializedEvent, TerminatedEvent, ContinuedEvent, OutputEvent, Thread, ThreadEvent, StackFrame, Scope, Source, Handles, Event } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { Breakpoint, IBackend, Variable, VariableObject, MIError } from './backend/backend';
import { MINode } from './backend/mi_parse';
import { expandValue, isExpandable } from './backend/gdb_expansion';
import { MI2 } from './backend/mi2/mi2';
import { posix } from "path";
import { makeObjectFromArrays } from './common';
import * as systemPath from "path";
import * as net from "net";
import * as os from "os";
import * as fs from "fs";

let resolve = posix.resolve;
let relative = posix.relative;

class ExtendedVariable {
	constructor(public name, public options) {
	}
}

const STACK_HANDLES_START = 1000;
const VAR_HANDLES_START = 2000;

class CustomStoppedEvent extends Event implements DebugProtocol.Event {
	body: {
		reason: string,
		threadID: number
	};
	event: string;

	constructor(reason: string, threadID: number) {
		super('custom-stop', { reason: reason, threadID: threadID });
	}
}

class StoppedEvent extends Event implements DebugProtocol.Event {
	body: {
		reason: string;
		description?: string;
		threadId?: number;
		text?: string;
		allThreadsStopped?: boolean;
	};

	constructor(reason: string, threadId: number, allThreadsStopped: boolean) {
		super('stopped', {
			reason: reason,
			threadId: threadId,
			allThreadsStopped: allThreadsStopped
		});
	}
}

class CustomContinuedEvent extends Event implements DebugProtocol.Event {
	body: {
		threadID: number;
		allThreads: boolean;
	}
	event: string;

	constructor(threadID: number, allThreads: boolean = true) {
		super('custom-continued', { threadID: threadID, allThreads: allThreads });
	}
}

export class MI2DebugSession extends DebugSession {
	protected variableHandles = new Handles<string | VariableObject | ExtendedVariable>(VAR_HANDLES_START);
	protected variableHandlesReverse: { [id: string]: number } = {};
	protected quit: boolean;
	protected attached: boolean;
	protected needContinue: boolean;
	protected trimCWD: string;
	protected switchCWD: string;
	protected started: boolean;
	protected crashed: boolean;
	protected debugReady: boolean;
	protected miDebugger: MI2;
	protected currentThreadId: number = 0;
	protected commandServer: net.Server;

	public constructor(debuggerLinesStartAt1: boolean, isServer: boolean = false) {
		super(debuggerLinesStartAt1, isServer);
	}

	protected initDebugger() {
		this.miDebugger.on("launcherror", this.launchError.bind(this));
		this.miDebugger.on("quit", this.quitEvent.bind(this));
		this.miDebugger.on("exited-normally", this.quitEvent.bind(this));
		this.miDebugger.on("stopped", this.stopEvent.bind(this));
		this.miDebugger.on("msg", this.handleMsg.bind(this));
		this.miDebugger.on("breakpoint", this.handleBreakpoint.bind(this));
		this.miDebugger.on("step-end", this.handleBreak.bind(this));
		this.miDebugger.on("step-out-end", this.handleBreak.bind(this));
		this.miDebugger.on("signal-stop", this.handlePause.bind(this));
		this.miDebugger.on("running", this.handleRunning.bind(this));
		this.sendEvent(new InitializedEvent());
	}

	protected handleMsg(type: string, msg: string) {
		if (type == "target")
			type = "stdout";
		if (type == "log")
			type = "stderr";
		this.sendEvent(new OutputEvent(msg, type));
	}

	protected handleRunning(info: MINode) {
		this.sendEvent(new ContinuedEvent(this.currentThreadId, true));
		this.sendEvent(new CustomContinuedEvent(this.currentThreadId, true));
	}

	protected handleBreakpoint(info: MINode) {
		this.sendEvent(new StoppedEvent("breakpoint", this.currentThreadId, true));
		this.sendEvent(new CustomStoppedEvent("breakpoint", this.currentThreadId));
	}

	protected handleBreak(info: MINode) {
		this.sendEvent(new StoppedEvent("step", this.currentThreadId, true));
		this.sendEvent(new CustomStoppedEvent("step", this.currentThreadId));
	}

	protected handlePause(info: MINode) {
		this.sendEvent(new StoppedEvent("user request", this.currentThreadId, true));
		this.sendEvent(new CustomStoppedEvent("user request", this.currentThreadId));
	}

	protected stopEvent(info: MINode) {
		if (!this.started)
			this.crashed = true;
		if (!this.quit) {
			this.sendEvent(new StoppedEvent("exception", this.currentThreadId, true));
			this.sendEvent(new CustomStoppedEvent("exception", this.currentThreadId));
		}
	}

	protected quitEvent() {
		this.quit = true;
		this.sendEvent(new TerminatedEvent());
	}

	protected launchError(err: any) {
		this.handleMsg("stderr", "Could not start debugger process, does the program exist in filesystem?\n");
		this.handleMsg("stderr", err.toString() + "\n");
		this.quitEvent();
	}

	protected async setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments): Promise<void> {
		try {
			let name = args.name;
			if (args.variablesReference >= VAR_HANDLES_START) {
				const parent = this.variableHandles.get(args.variablesReference) as VariableObject;
				name = `${parent.name}.${name}`;
			}

			let res = await this.miDebugger.varAssign(name, args.value);
			response.body = {
				value: res.result("value")
			};
			this.sendResponse(response);
		}
		catch (err) {
			this.sendErrorResponse(response, 11, `Could not continue: ${err}`);
		};
	}

	protected setFunctionBreakPointsRequest(response: DebugProtocol.SetFunctionBreakpointsResponse, args: DebugProtocol.SetFunctionBreakpointsArguments): void {
		let cb = (() => {
			this.debugReady = true;
			let all = [];
			args.breakpoints.forEach(brk => {
				all.push(this.miDebugger.addBreakPoint({ raw: brk.name, condition: brk.condition, countCondition: brk.hitCondition }));
			});
			Promise.all(all).then(brkpoints => {
				let finalBrks = [];
				brkpoints.forEach(brkp => {
					if (brkp[0])
						finalBrks.push({ line: brkp[1].line });
				});
				response.body = {
					breakpoints: finalBrks
				};
				this.sendResponse(response);
			}, msg => {
				this.sendErrorResponse(response, 10, msg.toString());
			});
		}).bind(this);
		if (this.debugReady)
			cb();
		else
			this.miDebugger.once("debug-ready", cb);
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
		let cb = (() => {
			this.debugReady = true;
			this.miDebugger.clearBreakPoints().then(() => {
				let path = args.source.path;
				let all = [];
				args.breakpoints.forEach(brk => {
					all.push(this.miDebugger.addBreakPoint({ file: path, line: brk.line, condition: brk.condition, countCondition: brk.hitCondition }));
				});
				Promise.all(all).then(brkpoints => {
					let finalBrks = [];
					brkpoints.forEach(brkp => {
						if (brkp[0])
							finalBrks.push({ line: brkp[1].line, verified: true });
					});
					response.body = {
						breakpoints: finalBrks
					};
					this.sendResponse(response);
					
				}, msg => {
					this.sendErrorResponse(response, 9, msg.toString());
				});
			}, msg => {
				this.sendErrorResponse(response, 9, msg.toString());
			});
		}).bind(this);

		if (this.debugReady)
			cb();
		else
			this.miDebugger.once("debug-ready", cb);
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		this.miDebugger.sendCommand('thread-list-ids').then((node) => {
			let ids = node.result('thread-ids').map((ti) => ti[1]);
			let currentThread = node.result('current-thread-id');
			
			let promise : Thenable<any>;
			if(!currentThread) {
				promise = this.miDebugger.sendCommand(`thread-select ${ids[0]}`).then((node) => {
					this.currentThreadId = ids[0];
				});
			}
			else {
				this.currentThreadId = currentThread;
				promise = Promise.resolve(true);
			}

			promise.then(() => {
				Promise.all(ids.map((id) => this.miDebugger.sendCommand(`thread-info ${id}`)))
				.then((nodes) => {
					let threads = nodes.map((node: MINode) => {
						let th = node.result('threads').map((th) => makeObjectFromArrays(th));
						if (th && th.length == 1) {
							let ti = th[0];
							let id = ti['id'];
							let name = ti['target-id'];
							if(ti['details']) {
								name = ti['details'];
							}
							return new Thread(id, name);
						}
						else {
							return null;
						}
					});
					threads = threads.filter(t => t !== null);					

					response.body = { threads: threads };
					this.sendResponse(response);
				}, error => {
					this.sendErrorResponse(response, 100, `Unable to request thread info: ${error.toString()}`);
				});
			}, error => {
				this.sendErrorResponse(response, 100, `Unable to request thread info: ${error.toString()}`);
			});
		}, (error) => {
			this.sendErrorResponse(response, 100, `Unable to request thread info: ${error.toString()}`);
		});
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
		this.miDebugger.getStack(args.levels).then(stack => {
			let ret: StackFrame[] = [];
			stack.forEach(element => {
				let file = element.file;
				if (file) {
					ret.push(new StackFrame(element.level, element.function + "@" + element.address, new Source(element.fileName, file), element.line, 0));
				}
				else
					ret.push(new StackFrame(element.level, element.function + "@" + element.address, null, element.line, 0));
			});
			response.body = {
				stackFrames: ret
			};
			this.sendResponse(response);
		}, err => {
			this.sendErrorResponse(response, 12, `Failed to get Stack Trace: ${err.toString()}`)
		});
	}

	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		// FIXME: Does not seem to get called in january release
		if (this.needContinue) {
			this.miDebugger.continue().then(done => {
				this.sendResponse(response);
			}, msg => {
				this.sendErrorResponse(response, 2, `Could not continue: ${msg}`);
			});
		}
		else
			this.sendResponse(response);
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
		const scopes = new Array<Scope>();
		scopes.push(new Scope("Local", STACK_HANDLES_START + (parseInt(args.frameId as any) || 0), false));

		response.body = {
			scopes: scopes
		};
		this.sendResponse(response);
	}

	protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): Promise<void> {
		const variables: DebugProtocol.Variable[] = [];
		let id: number | string | VariableObject | ExtendedVariable;
		if (args.variablesReference < VAR_HANDLES_START) {
			id = args.variablesReference - STACK_HANDLES_START;
		}
		else {
			id = this.variableHandles.get(args.variablesReference);
		}

		let createVariable = (arg, options?) => {
			if (options)
				return this.variableHandles.create(new ExtendedVariable(arg, options));
			else
				return this.variableHandles.create(arg);
		};

		let findOrCreateVariable = (varObj: VariableObject): number => {
			let id: number;
			if (this.variableHandlesReverse.hasOwnProperty(varObj.name)) {
				id = this.variableHandlesReverse[varObj.name];
			}
			else {
				id = createVariable(varObj);
				this.variableHandlesReverse[varObj.name] = id;
			}
			return varObj.isCompound() ? id : 0;
		};

		if (typeof id == "number") {
			let stack: Variable[];
			try {
				stack = await this.miDebugger.getStackVariables(this.threadID, id);
				for (const variable of stack) {
					try {
						let varObjName = `var_${variable.name}`;
						let varObj: VariableObject;
						try {
							const changes = await this.miDebugger.varUpdate(varObjName);
							const changelist = changes.result("changelist");
							changelist.forEach((change) => {
								const name = MINode.valueOf(change, "name");
								const vId = this.variableHandlesReverse[varObjName];
								const v = this.variableHandles.get(vId) as any;
								v.applyChanges(change);
							});
							const varId = this.variableHandlesReverse[varObjName];
							varObj = this.variableHandles.get(varId) as any;
						}
						catch (err) {
							if (err instanceof MIError && err.message == "Variable object not found") {
								varObj = await this.miDebugger.varCreate(variable.name, varObjName);
								const varId = findOrCreateVariable(varObj);
								varObj.exp = variable.name;
								varObj.id = varId;
							}
							else {
								throw err;
							}
						}
						variables.push(varObj.toProtocolVariable());
					}
					catch (err) {
						variables.push({
							name: variable.name,
							value: `<${err}>`,
							variablesReference: 0
						});
					}
				}
				response.body = {
					variables: variables
				};
				this.sendResponse(response);
			}
			catch (err) {
				this.sendErrorResponse(response, 1, `Could not expand variable: ${err}`);
			}
		}
		else if (typeof id == "string") {
			// Variable members
			let variable;
			try {
				variable = await this.miDebugger.evalExpression(JSON.stringify(id));
				try {
					let expanded = expandValue(createVariable, variable.result("value"), id, variable);
					if (!expanded) {
						this.sendErrorResponse(response, 2, `Could not expand variable`);
					}
					else {
						if (typeof expanded[0] == "string")
							expanded = [
								{
									name: "<value>",
									value: prettyStringArray(expanded),
									variablesReference: 0
								}
							];
						response.body = {
							variables: expanded
						};
						this.sendResponse(response);
					}
				}
				catch (e) {
					this.sendErrorResponse(response, 2, `Could not expand variable: ${e}`);
				}
			}
			catch (err) {
				this.sendErrorResponse(response, 1, `Could not expand variable: ${err}`);
			}
		}
		else if (typeof id == "object") {
			if (id instanceof VariableObject) {
				// Variable members
				let children: VariableObject[];
				try {
					children = await this.miDebugger.varListChildren(id.name);
					const vars = children.map(child => {
						const varId = findOrCreateVariable(child);
						child.id = varId;
						return child.toProtocolVariable();
					});

					response.body = {
						variables: vars
					}
					this.sendResponse(response);
				}
				catch (err) {
					this.sendErrorResponse(response, 1, `Could not expand variable: ${err}`);
				}
			}
			else if (id instanceof ExtendedVariable) {
				let varReq = id;
				if (varReq.options.arg) {
					let strArr = [];
					let argsPart = true;
					let arrIndex = 0;
					let submit = () => {
						response.body = {
							variables: strArr
						};
						this.sendResponse(response);
					};
					let addOne = async () => {
						const variable = await this.miDebugger.evalExpression(JSON.stringify(`${varReq.name}+${arrIndex})`));
						try {
							let expanded = expandValue(createVariable, variable.result("value"), varReq.name, variable);
							if (!expanded) {
								this.sendErrorResponse(response, 15, `Could not expand variable`);
							}
							else {
								if (typeof expanded == "string") {
									if (expanded == "<nullptr>") {
										if (argsPart)
											argsPart = false;
										else
											return submit();
									}
									else if (expanded[0] != '"') {
										strArr.push({
											name: "[err]",
											value: expanded,
											variablesReference: 0
										});
										return submit();
									}
									strArr.push({
										name: `[${(arrIndex++)}]`,
										value: expanded,
										variablesReference: 0
									});
									addOne();
								}
								else {
									strArr.push({
										name: "[err]",
										value: expanded,
										variablesReference: 0
									});
									submit();
								}
							}
						}
						catch (e) {
							this.sendErrorResponse(response, 14, `Could not expand variable: ${e}`);
						}
					};
					addOne();
				}
				else
					this.sendErrorResponse(response, 13, `Unimplemented variable request options: ${JSON.stringify(varReq.options)}`);
			}
			else {
				response.body = {
					variables: id
				};
				this.sendResponse(response);
			}
		}
		else {
			response.body = {
				variables: variables
			};
			this.sendResponse(response);
		}
	}

	protected pauseRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this.miDebugger.interrupt(args.threadId).then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 3, `Could not pause: ${msg}`);
		});
	}


	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this.miDebugger.continue(args.threadId).then(done => {
			response.body = { allThreadsContinued: true };
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 2, `Could not continue: ${msg}`);
		});
	}

	protected stepInRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this.miDebugger.step(args.threadId).then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 4, `Could not step in: ${msg}`);
		});
	}

	protected stepOutRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this.miDebugger.stepOut(args.threadId).then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 5, `Could not step out: ${msg}`);
		});
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this.miDebugger.next(args.threadId).then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 6, `Could not step over: ${msg}`);
		});
	}

	protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): Promise<void> {
		let createVariable = (arg, options?) => {
			if (options)
				return this.variableHandles.create(new ExtendedVariable(arg, options));
			else
				return this.variableHandles.create(arg);
		};

		let findOrCreateVariable = (varObj: VariableObject): number => {
			let id: number;
			if (this.variableHandlesReverse.hasOwnProperty(varObj.name)) {
				id = this.variableHandlesReverse[varObj.name];
			}
			else {
				id = createVariable(varObj);
				this.variableHandlesReverse[varObj.name] = id;
			}
			return varObj.isCompound() ? id : 0;
		};

		if (args.context == 'watch') {
			// try {
			// 	var res = await this.miDebugger.evalExpression(args.expression);
			// 	response.body = {
			// 		variablesReference: 0,
			// 		result: res.result("value")
			// 	}
			// 	this.sendResponse(response);
			// }
			// catch(e) {
			// 	this.sendErrorResponse(response, 7, e.toString());
			// }

			try {
				let exp = args.expression;
				let varObjName = `watch_${exp}`;
				let varObj: VariableObject;
				try {
					const changes = await this.miDebugger.varUpdate(varObjName);
					const changelist = changes.result("changelist");
					changelist.forEach((change) => {
						const name = MINode.valueOf(change, "name");
						const vId = this.variableHandlesReverse[varObjName];
						const v = this.variableHandles.get(vId) as any;
						v.applyChanges(change);
					});
					const varId = this.variableHandlesReverse[varObjName];
					varObj = this.variableHandles.get(varId) as any;
					response.body = {
						result: varObj.value,
						variablesReference: varObj.id,
					}
				}
				catch (err) {
					if (err instanceof MIError && err.message == "Variable object not found") {
						varObj = await this.miDebugger.varCreate(exp, varObjName);
						const varId = findOrCreateVariable(varObj);
						varObj.exp = exp;
						varObj.id = varId;
						response.body = {
							result: varObj.value,
							variablesReference: varObj.id
						};
					}
					else {
						throw err;
					}
				}
				
				this.sendResponse(response);
			}
			catch (err) {
				response.body = {
					result: `<${err.toString()}>`,
					variablesReference: 0
				}
				this.sendErrorResponse(response, 7, err.toString());	
			}
		}
		else if (args.context == "hover") {
			try {
				var res = await this.miDebugger.evalExpression(args.expression);
				response.body = {
					variablesReference: 0,
					result: res.result('value')
				};
				this.sendResponse(response);
			}
			catch(e) {
				this.sendErrorResponse(response, 7, e.toString());
			}
		}
		else {
			this.miDebugger.sendUserInput(args.expression).then(output => {
				if (typeof output == "undefined")
					response.body = {
						result: "",
						variablesReference: 0
					};
				else
					response.body = {
						result: JSON.stringify(output),
						variablesReference: 0
					};
				this.sendResponse(response);
			}, msg => {
				this.sendErrorResponse(response, 8, msg.toString());
			});
		}
	}
}

function prettyStringArray(strings) {
	if (typeof strings == "object") {
		if (strings.length !== undefined)
			return strings.join(", ");
		else
			return JSON.stringify(strings);
	}
	else return strings;
}
