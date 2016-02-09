import { Breakpoint, IBackend, Stack } from "../backend.ts"
import * as ChildProcess from "child_process"
import { EventEmitter } from "events"
import { parseMI, MINode } from '../mi_parse';

export class MI2 extends EventEmitter implements IBackend {
	constructor(public application: string, public preargs: string[]) {
		super();
	}

	load(cwd: string, target: string): Thenable<any> {
		return new Promise((resolve, reject) => {
			this.process = ChildProcess.spawn(this.application, this.preargs.concat([target]), { cwd: cwd });
			this.process.stdout.on("data", this.stdout.bind(this));
			this.process.stderr.on("data", this.stdout.bind(this));
			this.process.on("exit", (() => { this.emit("quit"); }).bind(this));
			Promise.all([
				this.sendCommand("gdb-set target-async on"),
				this.sendCommand("environment-directory \"" + cwd.replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"")
			]).then(resolve, reject);
		});
	}

	attach(cwd: string, executable: string, target: string): Thenable<any> {
		return new Promise((resolve, reject) => {
			let args = [];
			if (!executable)
				executable = "-p";
			args = args.concat([executable, target], this.preargs);
			this.process = ChildProcess.spawn(this.application, args, { cwd: cwd });
			this.process.stdout.on("data", this.stdout.bind(this));
			this.process.stderr.on("data", this.stdout.bind(this));
			this.process.on("exit", (() => { this.emit("quit"); }).bind(this));
			Promise.all([
				this.sendCommand("gdb-set target-async on"),
				this.sendCommand("environment-directory \"" + cwd.replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"")
			]).then(resolve, reject);
		});
	}

	connect(cwd: string, executable: string, target: string): Thenable<any> {
		return new Promise((resolve, reject) => {
			let args = [];
			if (executable)
				args = args.concat([executable], this.preargs);
			else
				args = this.preargs;
			this.process = ChildProcess.spawn(this.application, args, { cwd: cwd });
			this.process.stdout.on("data", this.stdout.bind(this));
			this.process.stderr.on("data", this.stdout.bind(this));
			this.process.on("exit", (() => { this.emit("quit"); }).bind(this));
			Promise.all([
				this.sendCommand("gdb-set target-async on"),
				this.sendCommand("environment-directory \"" + cwd.replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\""),
				this.sendCommand("target-select remote " + target)
			]).then(resolve, reject);
		});
	}

	stdout(data) {
		this.buffer += data.toString("utf8");
		let end = this.buffer.lastIndexOf('\n');
		if (end != -1) {
			this.onOutput(this.buffer.substr(0, end));
			this.buffer = this.buffer.substr(end + 1);
		}
	}

	onOutput(lines) {
		lines = <string[]>lines.split('\n');
		lines.forEach(line => {
			let parsed = parseMI(line);
			//this.log("log", JSON.stringify(parsed));
			let handled = false;
			if (parsed.token !== undefined) {
				if (this.handlers[parsed.token]) {
					this.handlers[parsed.token](parsed);
					delete this.handlers[parsed.token];
					handled = true;
				}
			}
			if (parsed.resultRecords && parsed.resultRecords.resultClass == "error") {
				this.log("log", "An error occured: " + parsed.result("msg"));
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
								if (parsed.record("reason") == "breakpoint-hit")
									this.emit("breakpoint", parsed);
								else if (parsed.record("reason") == "end-stepping-range")
									this.emit("step-end", parsed);
								else if (parsed.record("reason") == "function-finished")
									this.emit("step-out-end", parsed);
								else
									this.emit("stopped", parsed);
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
		});
	}

	start(): Thenable<boolean> {
		return new Promise((resolve, reject) => {
			this.log("console", "Running executable");
			this.sendCommand("exec-run").then((info) => {
				resolve(info.resultRecords.resultClass == "running");
			}, reject);
		});
	}

	stop() {
		let proc = this.process;
		let to = setTimeout(() => {
			process.kill(-proc.pid);
		}, 1000);
		this.process.on("exit", function(code) {
			clearTimeout(to);
		});
		this.sendRaw("-gdb-exit");
	}

	detach() {
		let proc = this.process;
		let to = setTimeout(() => {
			process.kill(-proc.pid);
		}, 1000);
		this.process.on("exit", function(code) {
			clearTimeout(to);
		});
		this.sendRaw("-target-detach");
	}

	interrupt(): Thenable<boolean> {
		return new Promise((resolve, reject) => {
			this.sendCommand("exec-interrupt").then((info) => {
				resolve(info.resultRecords.resultClass == "done");
			}, reject);
		});
	}

	continue(): Thenable<boolean> {
		return new Promise((resolve, reject) => {
			this.sendCommand("exec-continue").then((info) => {
				resolve(info.resultRecords.resultClass == "running");
			}, reject);
		});
	}

	next(): Thenable<boolean> {
		return new Promise((resolve, reject) => {
			this.sendCommand("exec-next").then((info) => {
				resolve(info.resultRecords.resultClass == "running");
			}, reject);
		});
	}

	step(): Thenable<boolean> {
		return new Promise((resolve, reject) => {
			this.sendCommand("exec-step").then((info) => {
				resolve(info.resultRecords.resultClass == "running");
			}, reject);
		});
	}

	stepOut(): Thenable<boolean> {
		return new Promise((resolve, reject) => {
			this.sendCommand("exec-finish").then((info) => {
				resolve(info.resultRecords.resultClass == "running");
			}, reject);
		});
	}

	loadBreakPoints(breakpoints: Breakpoint[]): Thenable<[boolean, Breakpoint][]> {
		let promisses = [];
		breakpoints.forEach(breakpoint => {
			promisses.push(this.addBreakPoint(breakpoint));
		});
		return Promise.all(promisses);
	}

	addBreakPoint(breakpoint: Breakpoint): Thenable<[boolean, Breakpoint]> {
		return new Promise((resolve, reject) => {
			if (this.breakpoints.has(breakpoint))
				return resolve(false);
			this.sendCommand("break-insert " + breakpoint.file + ":" + breakpoint.line).then((result) => {
				if (result.resultRecords.resultClass == "done") {
					let bkptNum = parseInt(result.result("bkpt.number"));
					let newBrk = {
						file: result.result("bkpt.file"),
						line: parseInt(result.result("bkpt.line")),
						condition: breakpoint.condition
					};
					if (breakpoint.condition) {
						this.sendCommand("break-condition " + bkptNum + " " + breakpoint.condition).then((result) => {
							if (result.resultRecords.resultClass == "done") {
								this.breakpoints.set(newBrk, bkptNum);
								resolve([true, newBrk]);
							} else {
								resolve([false, null]);
							}
						});
					}
					else {
						this.breakpoints.set(newBrk, bkptNum);
						resolve([true, newBrk]);
					}
				}
				else {
					resolve([false, null]);
				}
			});
		});
	}

	removeBreakPoint(breakpoint: Breakpoint): Thenable<boolean> {
		return new Promise((resolve, reject) => {
			if (!this.breakpoints.has(breakpoint))
				return resolve(false);
			this.sendCommand("break-delete " + this.breakpoints.get(breakpoint)).then((result) => {
				if (result.resultRecords.resultClass == "done") {
					this.breakpoints.delete(breakpoint);
					resolve(true);
				}
				else resolve(false);
			});
		});
	}

	clearBreakPoints(): Thenable<any> {
		return new Promise((resolve, reject) => {
			this.sendCommand("break-delete").then((result) => {
				if (result.resultRecords.resultClass == "done") {
					this.breakpoints.clear();
					resolve(true);
				}
				else resolve(false);
			});
		});
	}

	getStack(maxLevels: number): Thenable<Stack[]> {
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
					let line = parseInt(MINode.valueOf(element, "@frame.line"));
					let from = parseInt(MINode.valueOf(element, "@frame.from"));
					ret.push({
						address: addr,
						fileName: filename || "",
						file: file || from || "<unknown>",
						function: func,
						level: level,
						line: line
					});
				});
				resolve(ret);
			});
		});
	}

	getStackVariables(thread: number, frame: number): Thenable<[string, string][]> {
		return new Promise((resolve, reject) => {
			this.sendCommand("stack-list-variables --thread " + thread + " --frame " + frame + " --simple-values").then((result) => {
				let variables = result.result("variables");
				let ret: [string, string][] = [];
				variables.forEach(element => {
					const key = MINode.valueOf(element, "name");
					const value = MINode.valueOf(element, "value");
					ret.push([key, value]);
				});
				resolve(ret);
			}, reject);
		});
	}

	evalExpression(name: string): Thenable<any> {
		return new Promise((resolve, reject) => {
			this.sendCommand("data-evaluate-expression " + name).then((result) => {
				resolve(result);
			}, reject);
		});
	}

	log(type: string, msg: string) {
		this.emit("msg", type, msg[msg.length - 1] == '\n' ? msg : (msg + "\n"));
	}

	sendRaw(raw: string) {
		this.process.stdin.write(raw + "\n");
	}

	sendCommand(command: string): Thenable<MINode> {
		return new Promise((resolve, reject) => {
			this.handlers[this.currentToken] = (node: MINode) => {
				if (node.resultRecords && node.resultRecords.resultClass == "error") {
					let msg = node.result("msg") || "Internal error";
					this.log("stderr", "Failed to run command `" + command + "`: " + msg);
					reject(msg);
				}
				else
					resolve(node);
			};
			this.process.stdin.write(this.currentToken + "-" + command + "\n");
			this.currentToken++;
		});
	}

	isReady(): boolean {
		return !!this.process;
	}

	private currentToken: number = 1;
	private handlers: { [index: number]: (info: MINode) => any } = {};
	private breakpoints: Map<Breakpoint, Number> = new Map();
	private buffer: string;
	private process: ChildProcess.ChildProcess;
}