import { MI2_LLDB } from "./mi2lldb"
import { Stack } from "../backend"
import { MINode } from "../mi_parse"

export class MI2_Mago extends MI2_LLDB {
	getStack(maxLevels: number): Thenable<Stack[]> {
		return new Promise((resolve, reject) => {
			let command = "stack-list-frames";
			this.sendCommand(command).then((result) => {
				let stack = result.resultRecords.results;
				this.log("stdout", JSON.stringify(result.resultRecords.results.length));
				let ret: Stack[] = [];
				let remaining = [];
				let addToStack = (element) => {
					this.log("stdout", JSON.stringify(element));
					let level = MINode.valueOf(element, "frame.level");
					let addr = MINode.valueOf(element, "frame.addr");
					let func = MINode.valueOf(element, "frame.func");
					let filename = MINode.valueOf(element, "file");
					let file = MINode.valueOf(element, "fullname");
					let line = 0;
					let lnstr = MINode.valueOf(element, "line");
					if (lnstr)
						line = parseInt(lnstr);
					let from = parseInt(MINode.valueOf(element, "from"));
					ret.push({
						address: addr,
						fileName: filename || "",
						file: file || "<unknown>",
						function: func || from || "<unknown>",
						level: level,
						line: line
					});
				}
				stack.forEach(element => {
					if (element)
						if (element[0] == "stack") {
							addToStack(element[1]);
						} else remaining.push(element);
				});
				if (remaining.length)
					addToStack(remaining);
				resolve(ret);
			}, reject);
		});
	}
}