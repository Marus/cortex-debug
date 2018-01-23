import { Breakpoint, IBackend, Stack, Variable, VariableObject, MIError } from "../backend"
import * as ChildProcess from "child_process"
import { EventEmitter } from "events"
import { parseMI, MINode } from '../mi_parse';
import * as linuxTerm from '../linux/console';
import * as net from "net"
import * as fs from "fs"
import { posix } from "path"
import * as nativePath from "path"
let path = posix;

export function escape(str: string) {
	return str.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

const nonOutput = /^(?:\d*|undefined)[\*\+\=]|[\~\@\&\^]/;
const gdbMatch = /(?:\d*|undefined)\(gdb\)/;
const numRegex = /\d+/;

function couldBeOutput(line: string) {
	if (nonOutput.exec(line))
		return false;
	return true;
}

const trace = false;

export class MI2 extends EventEmitter implements IBackend {
	constructor(public application: string, public args: string[]) {
		super();
	}

	connect(cwd: string, executable: string, commands: string[]): Thenable<any> {
		if (!nativePath.isAbsolute(executable))
			executable = nativePath.join(cwd, executable);
			
		return new Promise((resolve, reject) => {
			let args = [...this.args, executable];
			this.process = ChildProcess.spawn(this.application, args, { cwd: cwd, env: this.procEnv });
			this.process.stdout.on("data", this.stdout.bind(this));
			this.process.stderr.on("data", this.stderr.bind(this));
			this.process.on("exit", (() => { this.emit("quit"); }).bind(this));
			this.process.on("error", ((err) => { this.emit("launcherror", err); }).bind(this));

			var asyncPromise = this.sendCommand("gdb-set target-async on", true);
			let promises = commands.map(c => this.sendCommand(c));
			promises.push(asyncPromise);
			
			Promise.all(promises).then(() => {
				this.emit("debug-ready");
				resolve();
			}, reject);
		});
	}

	stdout(data) {
		if (trace)
			this.log("stderr", "stdout: " + data);
		if (typeof data == "string")
			this.buffer += data;
		else
			this.buffer += data.toString("utf8");
		let end = this.buffer.lastIndexOf('\n');
		if (end != -1) {
			this.onOutput(this.buffer.substr(0, end));
			this.buffer = this.buffer.substr(end + 1);
		}
		if (this.buffer.length) {
			if (this.onOutputPartial(this.buffer)) {
				this.buffer = "";
			}
		}
	}

	stderr(data) {
		if (typeof data == "string")
			this.errbuf += data;
		else
			this.errbuf += data.toString("utf8");
		let end = this.errbuf.lastIndexOf('\n');
		if (end != -1) {
			this.onOutputStderr(this.errbuf.substr(0, end));
			this.errbuf = this.errbuf.substr(end + 1);
		}
		if (this.errbuf.length) {
			this.logNoNewLine("stderr", this.errbuf);
			this.errbuf = "";
		}
	}

	onOutputStderr(lines) {
		lines = <string[]>lines.split('\n');
		lines.forEach(line => {
			this.log("stderr", line);
		});
	}

	onOutputPartial(line) {
		if (couldBeOutput(line)) {
			this.logNoNewLine("stdout", line);
			return true;
		}
		return false;
	}

	onOutput(lines) {
		lines = <string[]>lines.split('\n');
		lines.forEach(line => {
			if (couldBeOutput(line)) {
				if (!gdbMatch.exec(line))
					this.log("stdout", line);
			}
			else {
				let parsed = parseMI(line);
				if (this.debugOutput)
					this.log("log", "GDB -> App: " + JSON.stringify(parsed));
				let handled = false;
				if (parsed.token !== undefined) {
					if (this.handlers[parsed.token]) {
						this.handlers[parsed.token](parsed);
						delete this.handlers[parsed.token];
						handled = true;
					}
				}
				if (!handled && parsed.resultRecords && parsed.resultRecords.resultClass == "error") {
					this.log("stderr", parsed.result("msg") || line);
				}
				if (parsed.outOfBandRecord) {
					parsed.outOfBandRecord.forEach(record => {
						if (record.isStream) {
							this.log(record.type, record.content);
						} else {
							if (record.type == "exec") {
								this.emit("exec-async-output", parsed);
								if (record.asyncClass == "running")
									this.emit("running", parsed);
								else if (record.asyncClass == "stopped") {
									let reason = parsed.record("reason");
									if (trace)
										this.log("stderr", "stop: " + reason);
									if (reason == "breakpoint-hit")
										this.emit("breakpoint", parsed);
									else if (reason == "end-stepping-range")
										this.emit("step-end", parsed);
									else if (reason == "function-finished")
										this.emit("step-out-end", parsed);
									else if (reason == "signal-received")
										this.emit("signal-stop", parsed);
									else if (reason == "exited-normally")
										this.emit("exited-normally", parsed);
									else if (reason == "exited") { // exit with error code != 0
										this.log("stderr", "Program exited with code " + parsed.record("exit-code"));
										this.emit("exited-normally", parsed);
									}
									else {
										this.log("console", "Not implemented stop reason (assuming exception): " + reason);
										this.emit("stopped", parsed);
									}
								} else
									this.log("log", JSON.stringify(parsed));
							}
						}
					});
					handled = true;
				}
				if (parsed.token == undefined && parsed.resultRecords == undefined && parsed.outOfBandRecord.length == 0)
					handled = true;
				if (!handled)
					this.log("log", "Unhandled: " + JSON.stringify(parsed));
			}
		});
	}

	start(): Thenable<boolean> {
		return Promise.resolve(true);
	}

	stop() {
		let proc = this.process;
		let to = setTimeout(() => {
			process.kill(-proc.pid);
		}, 1000);
		this.process.on("exit", function (code) {
			clearTimeout(to);
		});
		this.sendRaw("-gdb-exit");
	}

	detach() {
		let proc = this.process;
		let to = setTimeout(() => {
			process.kill(-proc.pid);
		}, 1000);
		this.process.on("exit", function (code) {
			clearTimeout(to);
		});
		this.sendRaw("-target-detach");
	}

	interrupt(): Thenable<boolean> {
		if (trace)
			this.log("stderr", "interrupt");
		return new Promise((resolve, reject) => {
			this.sendCommand("exec-interrupt").then((info) => {
				resolve(info.resultRecords.resultClass == "done");
			}, reject);
		});
	}

	continue(): Thenable<boolean> {
		if (trace)
			this.log("stderr", "continue");
		return new Promise((resolve, reject) => {
			this.sendCommand("exec-continue").then((info) => {
				resolve(info.resultRecords.resultClass == "running");
			}, reject);
		});
	}

	next(instruction?: boolean): Thenable<boolean> {
		if (trace)
			this.log("stderr", "next");
		return new Promise((resolve, reject) => {
			this.sendCommand(instruction ? 'exec-next-instruction' : 'exec-next').then((info) => {
				resolve(info.resultRecords.resultClass == "running");
			}, reject);
		});
	}

	step(instruction?: boolean): Thenable<boolean> {
		if (trace)
			this.log("stderr", "step");
		return new Promise((resolve, reject) => {
			this.sendCommand(instruction ? 'exec-step-instruction' : 'exec-step').then((info) => {
				resolve(info.resultRecords.resultClass == "running");
			}, reject);
		});
	}

	stepOut(): Thenable<boolean> {
		if (trace)
			this.log("stderr", "stepOut");
		return new Promise((resolve, reject) => {
			this.sendCommand("exec-finish").then((info) => {
				resolve(info.resultRecords.resultClass == "running");
			}, reject);
		});
	}

	restart(commands: string[]): Thenable<boolean> {
		if(trace)
			this.log("stderr", "restart");
		return this._sendCommandSequence(commands);
	}

	_sendCommandSequence(commands: string[]) : Thenable<boolean> {
		return new Promise((resolve, reject) => {
			let nextCommand = ((commands: string[]) => {
				if(commands.length == 0) { resolve(true); }
				let command = commands[0];

				this.sendCommand(command).then(r => { nextCommand(commands.slice(1)); }, reject);
			}).bind(this);

			nextCommand(commands);
		});
	}

	changeVariable(name: string, rawValue: string): Thenable<any> {
		if (trace)
			this.log("stderr", "changeVariable");
		return this.sendCommand("gdb-set var " + name + "=" + rawValue);
	}

	setBreakPointCondition(bkptNum, condition): Thenable<any> {
		if (trace)
			this.log("stderr", "setBreakPointCondition");
		return this.sendCommand("break-condition " + bkptNum + " " + condition);
	}

	addBreakPoint(breakpoint: Breakpoint): Promise<Breakpoint> {
		if (trace)
			this.log("stderr", "addBreakPoint");
		return new Promise((resolve, reject) => {
			let location = "";
			if (breakpoint.countCondition) {
				if (breakpoint.countCondition[0] == ">")
					location += "-i " + numRegex.exec(breakpoint.countCondition.substr(1))[0] + " ";
				else {
					let match = numRegex.exec(breakpoint.countCondition)[0];
					if (match.length != breakpoint.countCondition.length) {
						this.log("stderr", "Unsupported break count expression: '" + breakpoint.countCondition + "'. Only supports 'X' for breaking once after X times or '>X' for ignoring the first X breaks");
						location += "-t ";
					}
					else if (parseInt(match) != 0)
						location += "-t -i " + parseInt(match) + " ";
				}
			}

			if (breakpoint.raw)
				location += '*' + escape(breakpoint.raw);
			else
				location += '"' + escape(breakpoint.file) + ":" + breakpoint.line + '"';
			
			this.sendCommand(`break-insert ${location}`).then((result) => {
				if (result.resultRecords.resultClass == "done") {
					let bkptNum = parseInt(result.result("bkpt.number"));
					breakpoint.number = bkptNum;

					if (breakpoint.condition) {
						this.setBreakPointCondition(bkptNum, breakpoint.condition).then((result) => {
							if (result.resultRecords.resultClass == "done") {
								resolve(breakpoint);
							} else {
								resolve(null);
							}
						}, reject);
					}
					else {
						resolve(breakpoint);
					}
				}
				else {
					resolve(null);
				}
			}, reject);
		});
	}

	removeBreakpoints(breakpoints: number[]): Promise<boolean> {
		if (trace)
			this.log("stderr", "removeBreakPoint");
		return new Promise((resolve, reject) => {
			if (breakpoints.length === 0) {
				resolve(true);
			}
			else {
				let cmd = 'break-delete ' + breakpoints.join(' ');
				this.sendCommand(cmd).then((result) => {
					resolve(result.resultRecords.resultClass == 'done');
				}, reject);
			}
		});
	}

	getFrame(thread: number, frame: number): Thenable<Stack> {
		return new Promise((resolve, reject) => {
			let command = `stack-info-frame --thread ${thread} --frame ${frame}`;

			this.sendCommand(command).then((result) => {
				let frame = result.result('frame');
				let level = MINode.valueOf(frame, 'level');
				let addr = MINode.valueOf(frame, 'addr');
				let func = MINode.valueOf(frame, 'func');
				let file = MINode.valueOf(frame, 'file');
				let fullname = MINode.valueOf(frame, 'fullname');
				let line = 0;
				let linestr = MINode.valueOf(frame, 'line');
				if (linestr) { line = parseInt(linestr); }

				resolve({
					address: addr,
					fileName: file,
					file: fullname,
					function: func,
					level: level,
					line: line
				});
			}, reject);
		});
	}

	getStack(maxLevels: number): Thenable<Stack[]> {
		if (trace)
			this.log("stderr", "getStack");
		return new Promise((resolve, reject) => {
			let command = "stack-list-frames";
			if (maxLevels) {
				command += " 0 " + maxLevels;
			}
			this.sendCommand(command).then((result) => {
				let stack = result.result("stack");
				let ret: Stack[] = [];
				stack.forEach(element => {
					let level = MINode.valueOf(element, "@frame.level");
					let addr = MINode.valueOf(element, "@frame.addr");
					let func = MINode.valueOf(element, "@frame.func");
					let filename = MINode.valueOf(element, "@frame.file");
					let file = MINode.valueOf(element, "@frame.fullname");
					let line = 0;
					let lnstr = MINode.valueOf(element, "@frame.line");
					if (lnstr) { line = parseInt(lnstr); }
					let from = parseInt(MINode.valueOf(element, "@frame.from"));
					ret.push({
						address: addr,
						fileName: filename,
						file: file,
						function: func || from,
						level: level,
						line: line
					});
				});
				resolve(ret);
			}, reject);
		});
	}

	async getStackVariables(thread: number, frame: number): Promise<Variable[]> {
		if (trace)
			this.log("stderr", "getStackVariables");

		const result = await this.sendCommand(`stack-list-variables --thread ${thread} --frame ${frame} --simple-values`);
		const variables = result.result("variables");
		let ret: Variable[] = [];
		for (const element of variables) {
			const key = MINode.valueOf(element, "name");
			const value = MINode.valueOf(element, "value");
			const type = MINode.valueOf(element, "type");
			ret.push({
				name: key,
				valueStr: value,
				type: type,
				raw: element
			});
		}
		return ret;
	}

	examineMemory(from: number, length: number): Thenable<any> {
		if (trace)
			this.log("stderr", "examineMemory");
		return new Promise((resolve, reject) => {
			this.sendCommand("data-read-memory-bytes 0x" + from.toString(16) + " " + length).then((result) => {
				resolve(result.result("memory[0].contents"));
			}, reject);
		});
	}

	evalExpression(name: string): Thenable<any> {
		if (trace)
			this.log("stderr", "evalExpression");
		return new Promise((resolve, reject) => {
			this.sendCommand("data-evaluate-expression " + name).then((result) => {
				resolve(result);
			}, reject);
		});
	}

	async varCreate(expression: string, name: string = "-"): Promise<VariableObject> {
		if (trace)
			this.log("stderr", "varCreate");
		const res = await this.sendCommand(`var-create ${name} @ "${expression}"`);
		return new VariableObject(res.result(""));
	}

	async varEvalExpression(name: string): Promise<MINode> {
		if (trace)
			this.log("stderr", "varEvalExpression");
		return this.sendCommand(`var-evaluate-expression ${name}`);
	}

	async varListChildren(name: string): Promise<VariableObject[]> {
		if (trace)
			this.log("stderr", "varListChildren");
		//TODO: add `from` and `to` arguments
		const res = await this.sendCommand(`var-list-children --all-values ${name}`);
		const children = res.result("children") || [];
		let omg: VariableObject[] = children.map(child => new VariableObject(child[1]));
		return omg;
	}

	async varUpdate(name: string = "*"): Promise<MINode> {
		if (trace)
			this.log("stderr", "varUpdate");
		return this.sendCommand(`var-update --all-values ${name}`)
	}

	async varAssign(name: string, rawValue: string): Promise<MINode> {
		if (trace)
			this.log("stderr", "varAssign");
		return this.sendCommand(`var-assign ${name} ${rawValue}`);
	}

	logNoNewLine(type: string, msg: string) {
		this.emit("msg", type, msg);
	}

	log(type: string, msg: string) {
		this.emit("msg", type, msg[msg.length - 1] == '\n' ? msg : (msg + "\n"));
	}

	sendUserInput(command: string): Thenable<any> {
		if (command.startsWith("-")) {
			return this.sendCommand(command.substr(1));
		}
		else {
			return this.sendCommand(`interpreter-exec console "${command}"`);
		}
	}

	sendRaw(raw: string) {
		if (this.printCalls)
			this.log("log", raw);
		this.process.stdin.write(raw + "\n");
	}

	sendCommand(command: string, suppressFailure: boolean = false): Thenable<MINode> {
		let sel = this.currentToken++;
		return new Promise((resolve, reject) => {
			this.handlers[sel] = (node: MINode) => {
				if (node && node.resultRecords && node.resultRecords.resultClass === "error") {
					if (suppressFailure) {
						this.log("stderr", `WARNING: Error executing command '${command}'`);
						resolve(node);
					}
					else
						reject(new MIError(node.result("msg") || "Internal error", command));
				}
				else
					resolve(node);
			};
			this.sendRaw(sel + "-" + command);
		});
	}

	isReady(): boolean {
		return !!this.process;
	}

	printCalls: boolean;
	debugOutput: boolean;
	public procEnv: any;
	protected currentToken: number = 1;
	protected handlers: { [index: number]: (info: MINode) => any } = {};
	protected buffer: string;
	protected errbuf: string;
	protected process: ChildProcess.ChildProcess;
	protected stream;
}
