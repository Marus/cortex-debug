import { MI2DebugSession } from './mibase';
import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, Thread, StackFrame, Scope, Source, Handles } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { MI2_Mago } from "./backend/mi2/mi2mago";
import { SSHArguments } from './backend/backend';

export interface LaunchRequestArguments {
	cwd: string;
	target: string;
	magomipath: string;
	arguments: string;
	autorun: string[];
	printCalls: boolean;
	showDevDebugOutput: boolean;
}

export interface AttachRequestArguments {
	cwd: string;
	target: string;
	magomipath: string;
	executable: string;
	autorun: string[];
	printCalls: boolean;
	showDevDebugOutput: boolean;
}

class MagoDebugSession extends MI2DebugSession {
	public constructor(debuggerLinesStartAt1: boolean, isServer: boolean = false) {
		super(debuggerLinesStartAt1, isServer, 0);
	}

	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		response.body.supportsConfigurationDoneRequest = true;
		response.body.supportsConditionalBreakpoints = true;
		response.body.supportsFunctionBreakpoints = true;
		response.body.supportsEvaluateForHovers = true;
		this.sendResponse(response);
	}

	getThreadID() {
		return 0;
	}

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
		this.miDebugger = new MI2_Mago(args.magomipath || "mago-mi", ["-q"]);
		this.initDebugger();
		this.quit = false;
		this.attached = false;
		this.needContinue = false;
		this.isSSH = false;
		this.started = false;
		this.crashed = false;
		this.debugReady = false;
		this.miDebugger.printCalls = !!args.printCalls;
		this.miDebugger.debugOutput = !!args.showDevDebugOutput;
		this.miDebugger.load(args.cwd, args.target, args.arguments, undefined).then(() => {
			if (args.autorun)
				args.autorun.forEach(command => {
					this.miDebugger.sendUserInput(command);
				});
			setTimeout(() => {
				this.miDebugger.emit("ui-break-done");
			}, 50);
			this.sendResponse(response);
			this.miDebugger.start().then(() => {
				this.started = true;
				if (this.crashed)
					this.handlePause(undefined);
			});
		});
	}

	protected attachRequest(response: DebugProtocol.AttachResponse, args: AttachRequestArguments): void {
		this.miDebugger = new MI2_Mago(args.magomipath || "mago-mi", []);
		this.initDebugger();
		this.quit = false;
		this.attached = true;
		this.needContinue = true;
		this.isSSH = false;
		this.debugReady = false;
		this.miDebugger.printCalls = !!args.printCalls;
		this.miDebugger.debugOutput = !!args.showDevDebugOutput;
		this.miDebugger.attach(args.cwd, args.executable, args.target).then(() => {
			if (args.autorun)
				args.autorun.forEach(command => {
					this.miDebugger.sendUserInput(command);
				});
			this.sendResponse(response);
		});
	}
}

DebugSession.run(MagoDebugSession);