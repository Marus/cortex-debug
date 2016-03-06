import { MI2DebugSession } from './mibase';
import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, Thread, StackFrame, Scope, Source, Handles } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { MI2_LLDB } from "./backend/mi2/mi2lldb";
import { SSHArguments } from './backend/backend';

export interface LaunchRequestArguments {
	cwd: string;
	target: string;
	arguments: string;
	autorun: string[];
	ssh: SSHArguments;
	printCalls: boolean;
}

export interface AttachRequestArguments {
	cwd: string;
	target: string;
	executable: string;
	autorun: string[];
	printCalls: boolean;
}

class LLDBDebugSession extends MI2DebugSession {
	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		response.body.supportsConfigurationDoneRequest = true;
		response.body.supportsEvaluateForHovers = true; // Assume working in future releases
		response.body.supportsFunctionBreakpoints = true; // TODO: Implement in future release
		this.sendResponse(response);
		this.miDebugger = new MI2_LLDB("lldb-mi", []);
		this.initDebugger();
	}

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
		this.quit = false;
		this.attached = false;
		this.needContinue = false;
		this.isSSH = false;
		this.started = false;
		this.crashed = false;
		this.miDebugger.printCalls = !!args.printCalls;
		if (args.ssh !== undefined) {
			if (args.ssh.forwardX11 === undefined)
				args.ssh.forwardX11 = true;
			if (args.ssh.port === undefined)
				args.ssh.port = 22;
			if (args.ssh.x11port === undefined)
				args.ssh.x11port = 6000;
			if (args.ssh.x11host === undefined)
				args.ssh.x11host = "localhost";
			if (args.ssh.remotex11screen === undefined)
				args.ssh.remotex11screen = 0;
			this.isSSH = true;
			this.trimCWD = args.cwd.replace(/\\/g, "/");
			this.switchCWD = args.ssh.cwd;
			this.miDebugger.ssh(args.ssh, args.ssh.cwd, args.target, args.arguments, undefined).then(() => {
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
		else {
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
	}

	protected attachRequest(response: DebugProtocol.AttachResponse, args: AttachRequestArguments): void {
		this.quit = false;
		this.attached = true;
		this.needContinue = true;
		this.isSSH = false;
		this.miDebugger.printCalls = !!args.printCalls;
		this.miDebugger.attach(args.cwd, args.executable, args.target).then(() => {
			if (args.autorun)
				args.autorun.forEach(command => {
					this.miDebugger.sendUserInput(command);
				});
			this.sendResponse(response);
		});
	}
}

DebugSession.run(LLDBDebugSession);