import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, Thread, StackFrame, Scope, Source, Handles } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { Breakpoint, IBackend } from './backend/backend'
import { MINode } from './backend/mi_parse'
import { expandValue, isExpandable } from './backend/gdb_expansion'
import { MI2 } from './backend/mi2/mi2'

export interface LaunchRequestArguments {
	cwd: string;
	target: string;
	autorun: string[];
}

export interface AttachRequestArguments {
	cwd: string;
	target: string;
	executable: string;
	remote: boolean;
	autorun: string[];
}

class MI2DebugSession extends DebugSession {
	private static THREAD_ID = 1;
	private gdbDebugger: MI2;
	private variableHandles = new Handles<any>();
	private quit: boolean;
	private attached: boolean;
	private needContinue: boolean;

	public constructor(debuggerLinesStartAt1: boolean, isServer: boolean = false) {
		super(debuggerLinesStartAt1, isServer);
	}

	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		response.body.supportsConfigurationDoneRequest = true;
		response.body.supportsEvaluateForHovers = true; // Assume working in future releases
		response.body.supportsFunctionBreakpoints = true; // TODO: Implement in future release
		this.sendResponse(response);
		this.gdbDebugger = new MI2("gdb", ["-q", "--interpreter=mi2"]);
		this.gdbDebugger.on("quit", this.quitEvent.bind(this));
		this.gdbDebugger.on("exited-normally", this.quitEvent.bind(this));
		this.gdbDebugger.on("stopped", this.stopEvent.bind(this));
		this.gdbDebugger.on("msg", this.handleMsg.bind(this));
		this.gdbDebugger.on("breakpoint", this.handleBreakpoint.bind(this));
		this.gdbDebugger.on("step-end", this.handleBreak.bind(this));
		this.gdbDebugger.on("step-out-end", this.handleBreak.bind(this));
		this.gdbDebugger.on("signal-stop", this.handlePause.bind(this));
		this.sendEvent(new InitializedEvent());
	}

	private handleMsg(type: string, msg: string) {
		if (type == "target")
			type = "stdout";
		if (type == "log")
			type = "stderr";
		this.sendEvent(new OutputEvent(msg, type));
	}

	private handleBreakpoint(info: MINode) {
		this.sendEvent(new StoppedEvent("breakpoint", MI2DebugSession.THREAD_ID));
	}

	private handleBreak(info: MINode) {
		this.sendEvent(new StoppedEvent("step", MI2DebugSession.THREAD_ID));
	}

	private handlePause(info: MINode) {
		this.sendEvent(new StoppedEvent("user request", MI2DebugSession.THREAD_ID));
	}

	private stopEvent(info: MINode) {
		if (!this.quit)
			this.sendEvent(new StoppedEvent("exception", MI2DebugSession.THREAD_ID));
	}

	private quitEvent() {
		this.quit = true;
		this.sendEvent(new TerminatedEvent());
	}

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
		this.quit = false;
		this.attached = false;
		this.needContinue = false;
		this.gdbDebugger.load(args.cwd, args.target).then(() => {
			args.autorun.forEach(command => {
				this.gdbDebugger.sendUserInput(command);
			});
			this.gdbDebugger.start().then(() => {
				this.sendResponse(response);
			});
		});
	}

	protected attachRequest(response: DebugProtocol.AttachResponse, args: AttachRequestArguments): void {
		this.quit = false;
		this.attached = !args.remote;
		this.needContinue = true;
		if (args.remote) {
			this.gdbDebugger.connect(args.cwd, args.executable, args.target).then(() => {
				args.autorun.forEach(command => {
					this.gdbDebugger.sendUserInput(command);
				});
				this.sendResponse(response);
			});
		}
		else {
			this.gdbDebugger.attach(args.cwd, args.executable, args.target).then(() => {
				args.autorun.forEach(command => {
					this.gdbDebugger.sendUserInput(command);
				});
				this.sendResponse(response);
			});
		}
	}

	protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
		if (this.attached)
			this.gdbDebugger.detach();
		else
			this.gdbDebugger.stop();
		this.sendResponse(response);
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
		this.gdbDebugger.clearBreakPoints().then(() => {
			let path = args.source.path;
			let all = [];
			args.breakpoints.forEach(brk => {
				all.push(this.gdbDebugger.addBreakPoint({ file: path, line: brk.line, condition: brk.condition }));
			});
			Promise.all(all).then(brkpoints => {
				response.body.breakpoints = brkpoints;
				this.sendResponse(response);
			});
		});
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		response.body = {
			threads: [
				new Thread(MI2DebugSession.THREAD_ID, "Thread 1")
			]
		};
		this.sendResponse(response);
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
		this.gdbDebugger.getStack(args.levels).then(stack => {
			let ret: StackFrame[] = [];
			stack.forEach(element => {
				ret.push(new StackFrame(element.level, element.function + "@" + element.address, new Source(element.fileName, element.file), element.line, 0));
			});
			response.body = {
				stackFrames: ret
			};
			this.sendResponse(response);
		});
	}

	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		// FIXME: Does not seem to get called in january release
		if (this.needContinue) {
			this.gdbDebugger.continue().then(done => {
				this.sendResponse(response);
			}, msg => {
				this.sendResponse(response);
				this.sendEvent(new OutputEvent(`Could not continue: ${msg}\n`, 'stderr'));
			});
		}
		else
			this.sendResponse(response);
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
		const scopes = new Array<Scope>();
		scopes.push(new Scope("Local", this.variableHandles.create("@frame:" + args.frameId), false));

		response.body = {
			scopes: scopes
		};
		this.sendResponse(response);
	}

	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
		const variables = [];
		const id = this.variableHandles.get(args.variablesReference);

		let createVariable = (arg) => {
			return this.variableHandles.create(arg);
		};

		if (typeof id == "string") {
			if (id.startsWith("@frame:")) {
				this.gdbDebugger.getStackVariables(1, 0).then(stack => {
					stack.forEach(variable => {
						if (variable[1] !== undefined) {
							let expanded = expandValue(createVariable, `{${variable[0]} = ${variable[1]}}`);
							if (!expanded)
								new OutputEvent("Could not expand " + variable[1] + "\n", "stderr");
							else if (typeof expanded[0] == "string")
								expanded = [
									{
										name: "<value>",
										value: prettyStringArray(expanded),
										variablesReference: 0
									}
								];
							variables.push(expanded[0]);
						} else
							variables.push({
								name: variable[0],
								value: "<unknown>",
								variablesReference: createVariable(variable[0])
							});
					});
					response.body = {
						variables: variables
					};
					this.sendResponse(response);
				});
			}
			else {
				// Variable members
				this.gdbDebugger.evalExpression(JSON.stringify(id)).then(variable => {
					let expanded = expandValue(createVariable, variable.result("value"));
					if (!expanded)
						this.sendEvent(new OutputEvent("Could not expand " + variable.result("value") + "\n", "stderr"));
					else if (typeof expanded[0] == "string")
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
				});
			}
		}
		else if (typeof id == "object") {
			response.body = {
				variables: id
			};
			this.sendResponse(response);
		}
		else {
			response.body = {
				variables: variables
			};
			this.sendResponse(response);
		}
	}

	protected pauseRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this.gdbDebugger.interrupt().then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendResponse(response);
			this.sendEvent(new OutputEvent(`Could not pause: ${msg}\n`, 'stderr'));
		});
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this.gdbDebugger.continue().then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendResponse(response);
			this.sendEvent(new OutputEvent(`Could not continue: ${msg}\n`, 'stderr'));
		});
	}

	protected stepInRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this.gdbDebugger.step().then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendResponse(response);
			this.sendEvent(new OutputEvent(`Could not step in: ${msg}\n`, 'stderr'));
		});
	}

	protected stepOutRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this.gdbDebugger.stepOut().then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendResponse(response);
			this.sendEvent(new OutputEvent(`Could not step out: ${msg}\n`, 'stderr'));
		});
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this.gdbDebugger.next().then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendResponse(response);
			this.sendEvent(new OutputEvent(`Could not step over: ${msg}\n`, 'stderr'));
		});
	}

	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
		this.handleMsg("console", "Evaluate (" + args.context + "): " + args.expression + "\n")
		if (args.context == "watch" || args.context == "hover")
			this.gdbDebugger.evalExpression(args.expression).then((res) => {
				response.body = {
					variablesReference: 0,
					result: res.result("value")
				}
				this.sendResponse(response);
			});
		else {
			this.gdbDebugger.sendUserInput(args.expression).then(output => {
				if (output)
					response.body.result = JSON.stringify(output);
				this.sendResponse(response);
			});
		}
	}
}

function prettyStringArray(strings: string[]) {
	return strings.join(", ");
}

DebugSession.run(MI2DebugSession);