import { MI2, escape } from "./mi2"
import { Breakpoint } from "../backend"
import * as ChildProcess from "child_process"
import { posix } from "path"
import * as nativePath from "path"
let path = posix;

export class MI2_LLDB extends MI2 {
	protected initCommands(target: string, cwd: string) {
		return [
			this.sendCommand("gdb-set target-async on"),
			this.sendCommand("file-exec-and-symbols \"" + escape(target) + "\"")
		];
	}

	attach(cwd: string, executable: string, target: string): Thenable<any> {
		return new Promise((resolve, reject) => {
			this.process = ChildProcess.spawn(this.application, this.preargs, { cwd: cwd });
			this.process.stdout.on("data", this.stdout.bind(this));
			this.process.stderr.on("data", this.stderr.bind(this));
			this.process.on("exit", (() => { this.emit("quit"); }).bind(this));
			Promise.all([
				this.sendCommand("gdb-set target-async on"),
				this.sendCommand("file-exec-and-symbols \"" + escape(executable) + "\""),
				this.sendCommand("target-attach " + target)
			]).then(() => {
				this.emit("debug-ready");
				resolve();
			}, reject);
		});
	}

	clearBreakPoints(): Thenable<any> {
		return new Promise((resolve, reject) => {
			let promises = [];
			for (let k in this.breakpoints.values) {
				promises.push(this.sendCommand("break-delete " + k).then((result) => {
					if (result.resultRecords.resultClass == "done") resolve(true);
					else resolve(false);
				}));
			}
			this.breakpoints.clear();
			Promise.all(promises).then(resolve, reject);
		});
	}

	setBreakPointCondition(bkptNum, condition): Thenable<any> {
		return this.sendCommand("break-condition " + bkptNum + " \"" + escape(condition) + "\" 1");
	}
}