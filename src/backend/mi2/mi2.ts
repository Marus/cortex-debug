import { Breakpoint, IBackend, Stack, SSHArguments, Variable } from "../backend"
import * as ChildProcess from "child_process"
import { EventEmitter } from "events"
import { parseMI, MINode } from '../mi_parse';
import * as linuxTerm from '../linux/console';
import * as net from "net"
import * as fs from "fs"
import { posix } from "path"
import * as nativePath from "path"
let path = posix;
var Client = require("ssh2").Client;

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
	constructor(public application: string, public preargs: string[], public extraargs: string[], public procEnv: any) {
		super();
	}

	load(cwd: string, target: string, procArgs: string, separateConsole: string): Thenable<any> {
		if (!nativePath.isAbsolute(target))
			target = nativePath.join(cwd, target);
		return new Promise((resolve, reject) => {
			this.isSSH = false;
			let args = this.preargs.concat(this.extraargs || []);
			this.process = ChildProcess.spawn(this.application, args, { cwd: cwd, env: this.procEnv });
			this.process.stdout.on("data", this.stdout.bind(this));
			this.process.stderr.on("data", this.stderr.bind(this));
			this.process.on("exit", (() => { this.emit("quit"); }).bind(this));
			this.process.on("error", ((err) => { this.emit("launcherror", err); }).bind(this));
			let promises = this.initCommands(target, cwd);
			if (procArgs && procArgs.length)
				promises.push(this.sendCommand("exec-arguments " + procArgs));
			if (process.platform == "win32") {
				if (separateConsole !== undefined)
					promises.push(this.sendCommand("gdb-set new-console on"))
				Promise.all(promises).then(() => {
					this.emit("debug-ready");
					resolve();
				}, reject);
			}
			else {
				if (separateConsole !== undefined) {
					linuxTerm.spawnTerminalEmulator(separateConsole).then(tty => {
						promises.push(this.sendCommand("inferior-tty-set " + tty));
						Promise.all(promises).then(() => {
							this.emit("debug-ready");
							resolve();
						}, reject);
					});
				}
				else {
					Promise.all(promises).then(() => {
						this.emit("debug-ready");
						resolve();
					}, reject);
				}
			}
		});
	}

	ssh(args: SSHArguments, cwd: string, target: string, procArgs: string, separateConsole: string, attach: boolean): Thenable<any> {
		return new Promise((resolve, reject) => {
			this.isSSH = true;
			this.sshReady = false;
			this.sshConn = new Client();

			if (separateConsole !== undefined)
				this.log("stderr", "WARNING: Output to terminal emulators are not supported over SSH");

			if (args.forwardX11) {
				this.sshConn.on("x11", (info, accept, reject) => {
					var xserversock = new net.Socket();
					xserversock.on("error", (err) => {
						this.log("stderr", "Could not connect to local X11 server! Did you enable it in your display manager?\n" + err);
					});
					xserversock.on("connect", () => {
						let xclientsock = accept();
						xclientsock.pipe(xserversock).pipe(xclientsock);
					});
					xserversock.connect(args.x11port, args.x11host);
				});
			}

			let connectionArgs: any = {
				host: args.host,
				port: args.port,
				username: args.user
			};

			if (args.keyfile) {
				if (require("fs").existsSync(args.keyfile))
					connectionArgs.privateKey = require("fs").readFileSync(args.keyfile);
				else {
					this.log("stderr", "SSH key file does not exist!");
					this.emit("quit");
					reject();
					return;
				}
			} else {
				connectionArgs.password = args.password;
			}

			this.sshConn.on("ready", () => {
				this.log("stdout", "Running " + this.application + " over ssh...");
				let execArgs: any = {};
				if (args.forwardX11) {
					execArgs.x11 = {
						single: false,
						screen: args.remotex11screen
					};
				}
				let sshCMD = this.application + " " + this.preargs.join(" ");
				if (args.bootstrap) sshCMD = args.bootstrap + " && " + sshCMD;
				if (attach)
					sshCMD += " -p " + target;
				this.sshConn.exec(sshCMD, execArgs, (err, stream) => {
					if (err) {
						this.log("stderr", "Could not run " + this.application + " over ssh!");
						this.log("stderr", err.toString());
						this.emit("quit");
						reject();
						return;
					}
					this.sshReady = true;
					this.stream = stream;
					stream.on("data", this.stdout.bind(this));
					stream.stderr.on("data", this.stderr.bind(this));
					stream.on("exit", (() => {
						this.emit("quit");
						this.sshConn.end();
					}).bind(this));
					let promises = this.initCommands(target, cwd, true, attach);
					promises.push(this.sendCommand("environment-cd \"" + escape(cwd) + "\""));
					if (procArgs && procArgs.length && !attach)
						promises.push(this.sendCommand("exec-arguments " + procArgs));
					Promise.all(promises).then(() => {
						this.emit("debug-ready")
						resolve();
					}, reject);
				});
			}).on("error", (err) => {
				this.log("stderr", "Could not run " + this.application + " over ssh!");
				this.log("stderr", err.toString());
				this.emit("quit");
				reject();
			}).connect(connectionArgs);
		});
	}

	protected initCommands(target: string, cwd: string, ssh: boolean = false, attach: boolean = false) {
		if (ssh) {
			if (!path.isAbsolute(target))
				target = path.join(cwd, target);
		}
		else {
			if (!nativePath.isAbsolute(target))
				target = nativePath.join(cwd, target);
		}
		var cmds = [
			this.sendCommand("gdb-set target-async on", true),
			this.sendCommand("environment-directory \"" + escape(cwd) + "\"", true)
		];
		if (!attach)
			cmds.push(this.sendCommand("file-exec-and-symbols \"" + escape(target) + "\""));
		return cmds;
	}

	attach(cwd: string, executable: string, target: string): Thenable<any> {
		return new Promise((resolve, reject) => {
			let args = [];
			if (executable && !nativePath.isAbsolute(executable))
				executable = nativePath.join(cwd, executable);
			if (!executable)
				executable = "-p";
			var isExtendedRemote = false;
			if (target.startsWith("extended-remote")) {
				isExtendedRemote = true;
				args = this.preargs;
			} else
				args = args.concat([executable, target], this.preargs);
			this.process = ChildProcess.spawn(this.application, args, { cwd: cwd, env: this.procEnv });
			this.process.stdout.on("data", this.stdout.bind(this));
			this.process.stderr.on("data", this.stderr.bind(this));
			this.process.on("exit", (() => { this.emit("quit"); }).bind(this));
			this.process.on("error", ((err) => { this.emit("launcherror", err); }).bind(this));
			var commands = [
				this.sendCommand("gdb-set target-async on"),
				this.sendCommand("environment-directory \"" + escape(cwd) + "\"")
			];
			if (isExtendedRemote) {
				commands.push(this.sendCommand("target-select " + target));
				commands.push(this.sendCommand("file-symbol-file \"" + escape(executable) + "\""));
			}
			Promise.all(commands).then(() => {
				this.emit("debug-ready")
				resolve();
			}, reject);
		});
	}

	connect(cwd: string, executable: string, target: string): Thenable<any> {
		return new Promise((resolve, reject) => {
			let args = [];
			if (executable && !nativePath.isAbsolute(executable))
				executable = nativePath.join(cwd, executable);
			if (executable)
				args = args.concat([executable], this.preargs);
			else
				args = this.preargs;
			this.process = ChildProcess.spawn(this.application, args, { cwd: cwd, env: this.procEnv });
			this.process.stdout.on("data", this.stdout.bind(this));
			this.process.stderr.on("data", this.stderr.bind(this));
			this.process.on("exit", (() => { this.emit("quit"); }).bind(this));
			this.process.on("error", ((err) => { this.emit("launcherror", err); }).bind(this));
			Promise.all([
				this.sendCommand("gdb-set target-async on"),
				this.sendCommand("environment-directory \"" + escape(cwd) + "\""),
				this.sendCommand("target-select remote " + target)
			]).then(() => {
				this.emit("debug-ready")
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
		return new Promise((resolve, reject) => {
			this.once("ui-break-done", () => {
				this.log("console", "Running executable");
				this.sendCommand("exec-run").then((info) => {
					if (info.resultRecords.resultClass == "running")
						resolve();
					else
						reject();
				}, reject);
			});
		});
	}

	stop() {
		if (this.isSSH) {
			let proc = this.stream;
			let to = setTimeout(() => {
				proc.signal("KILL");
			}, 1000);
			this.stream.on("exit", function (code) {
				clearTimeout(to);
			})
			this.sendRaw("-gdb-exit");
		}
		else {
			let proc = this.process;
			let to = setTimeout(() => {
				process.kill(-proc.pid);
			}, 1000);
			this.process.on("exit", function (code) {
				clearTimeout(to);
			});
			this.sendRaw("-gdb-exit");
		}
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

	continue(reverse: boolean = false): Thenable<boolean> {
		if (trace)
			this.log("stderr", "continue");
		return new Promise((resolve, reject) => {
			this.sendCommand("exec-continue" + (reverse ? " --reverse" : "")).then((info) => {
				resolve(info.resultRecords.resultClass == "running");
			}, reject);
		});
	}

	next(reverse: boolean = false): Thenable<boolean> {
		if (trace)
			this.log("stderr", "next");
		return new Promise((resolve, reject) => {
			this.sendCommand("exec-next" + (reverse ? " --reverse" : "")).then((info) => {
				resolve(info.resultRecords.resultClass == "running");
			}, reject);
		});
	}

	step(reverse: boolean = false): Thenable<boolean> {
		if (trace)
			this.log("stderr", "step");
		return new Promise((resolve, reject) => {
			this.sendCommand("exec-step" + (reverse ? " --reverse" : "")).then((info) => {
				resolve(info.resultRecords.resultClass == "running");
			}, reject);
		});
	}

	stepOut(reverse: boolean = false): Thenable<boolean> {
		if (trace)
			this.log("stderr", "stepOut");
		return new Promise((resolve, reject) => {
			this.sendCommand("exec-finish" + (reverse ? " --reverse" : "")).then((info) => {
				resolve(info.resultRecords.resultClass == "running");
			}, reject);
		});
	}

	changeVariable(name: string, rawValue: string): Thenable<any> {
		if (trace)
			this.log("stderr", "changeVariable");
		return this.sendCommand("gdb-set var " + name + "=" + rawValue);
	}

	loadBreakPoints(breakpoints: Breakpoint[]): Thenable<[boolean, Breakpoint][]> {
		if (trace)
			this.log("stderr", "loadBreakPoints");
		let promisses = [];
		breakpoints.forEach(breakpoint => {
			promisses.push(this.addBreakPoint(breakpoint));
		});
		return Promise.all(promisses);
	}

	setBreakPointCondition(bkptNum, condition): Thenable<any> {
		if (trace)
			this.log("stderr", "setBreakPointCondition");
		return this.sendCommand("break-condition " + bkptNum + " " + condition);
	}

	addBreakPoint(breakpoint: Breakpoint): Thenable<[boolean, Breakpoint]> {
		if (trace)
			this.log("stderr", "addBreakPoint");
		return new Promise((resolve, reject) => {
			if (this.breakpoints.has(breakpoint))
				return resolve(false);
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
				location += '"' + escape(breakpoint.raw) + '"';
			else
				location += '"' + escape(breakpoint.file) + ":" + breakpoint.line + '"';
			this.sendCommand("break-insert -f " + location).then((result) => {
				if (result.resultRecords.resultClass == "done") {
					let bkptNum = parseInt(result.result("bkpt.number"));
					let newBrk = {
						file: result.result("bkpt.file"),
						line: parseInt(result.result("bkpt.line")),
						condition: breakpoint.condition
					};
					if (breakpoint.condition) {
						this.setBreakPointCondition(bkptNum, breakpoint.condition).then((result) => {
							if (result.resultRecords.resultClass == "done") {
								this.breakpoints.set(newBrk, bkptNum);
								resolve([true, newBrk]);
							} else {
								resolve([false, null]);
							}
						}, reject);
					}
					else {
						this.breakpoints.set(newBrk, bkptNum);
						resolve([true, newBrk]);
					}
				}
				else {
					reject(result);
				}
			}, reject);
		});
	}

	removeBreakPoint(breakpoint: Breakpoint): Thenable<boolean> {
		if (trace)
			this.log("stderr", "removeBreakPoint");
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
		if (trace)
			this.log("stderr", "clearBreakPoints");
		return new Promise((resolve, reject) => {
			this.sendCommand("break-delete").then((result) => {
				if (result.resultRecords.resultClass == "done") {
					this.breakpoints.clear();
					resolve(true);
				}
				else resolve(false);
			}, () => {
				resolve(false);
			});
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
					if (lnstr)
						line = parseInt(lnstr);
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

	getStackVariables(thread: number, frame: number): Thenable<Variable[]> {
		if (trace)
			this.log("stderr", "getStackVariables");
		return new Promise((resolve, reject) => {
			this.sendCommand("stack-list-variables --thread " + thread + " --frame " + frame + " --simple-values").then((result) => {
				let variables = result.result("variables");
				let ret: Variable[] = [];
				variables.forEach(element => {
					const key = MINode.valueOf(element, "name");
					const value = MINode.valueOf(element, "value");
					const type = MINode.valueOf(element, "type");
					ret.push({
						name: key,
						valueStr: value,
						type: type,
						raw: element
					});
				});
				resolve(ret);
			}, reject);
		});
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
			this.sendRaw(command);
			return Promise.resolve(undefined);
		}
	}

	sendRaw(raw: string) {
		if (this.printCalls)
			this.log("log", raw);
		if (this.isSSH)
			this.stream.write(raw + "\n");
		else
			this.process.stdin.write(raw + "\n");
	}

	sendCommand(command: string, suppressFailure: boolean = false): Thenable<MINode> {
		let sel = this.currentToken++;
		return new Promise((resolve, reject) => {
			this.handlers[sel] = (node: MINode) => {
				if (node && node.resultRecords && node.resultRecords.resultClass === "error") {
					if (suppressFailure) {
						this.log("stderr", "WARNING: Error executing command '" + command + "'");
						resolve(node);
					}
					else
						reject((node.result("msg") || "Internal error") + " (from " + command + ")");
				}
				else
					resolve(node);
			};
			this.sendRaw(sel + "-" + command);
		});
	}

	isReady(): boolean {
		return this.isSSH ? this.sshReady : !!this.process;
	}

	printCalls: boolean;
	debugOutput: boolean;
	protected isSSH: boolean;
	protected sshReady: boolean;
	protected currentToken: number = 1;
	protected handlers: { [index: number]: (info: MINode) => any } = {};
	protected breakpoints: Map<Breakpoint, Number> = new Map();
	protected buffer: string;
	protected errbuf: string;
	protected process: ChildProcess.ChildProcess;
	protected stream;
	protected sshConn;
}
