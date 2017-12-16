import * as vscode from "vscode";
import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { PeripheralTreeProvider, TreeNode, FieldNode, RecordType, BaseNode } from './peripheral';
export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider("debugmemory", new MemoryContentProvider()));
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.examineMemoryLocation", examineMemory));
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.getFileNameNoExt", () => {
	const peripheralProvider = new PeripheralTreeProvider(vscode.workspace.rootPath, ext.extensionPath);
	vscode.commands.registerCommand('cortexPerhiperals.refresh', () => console.log('Clicked Refresh'));
	vscode.commands.registerCommand('cortexPerhiperals.refreshNode', (node) => console.log('Refresh: ', node));
	vscode.commands.registerCommand('cortexPerhiperals.updateNode', (node: TreeNode) => {
		if(node.node.recordType == RecordType.Field) {
			let fn : FieldNode = node.node as FieldNode;
			fn.performUpdate().then(newval => {
				peripheralProvider._onDidChangeTreeData.fire();
				
			}, reason => {
			});
		}
	});
	vscode.commands.registerCommand('cortexPerhiperals.selectedNode', (node: BaseNode) => {
		if(node.recordType != RecordType.Field) {
			node.expanded = !node.expanded;
		}

		node.selected().then(updated => { if(updated) { peripheralProvider._onDidChangeTreeData.fire(); } }, error => { console.log('Error: ', error); });
	});
	
	context.subscriptions.push(vscode.window.registerTreeDataProvider('cortexPerhiperals', peripheralProvider));
		if (!vscode.window.activeTextEditor || !vscode.window.activeTextEditor.document || !vscode.window.activeTextEditor.document.fileName) {
			vscode.window.showErrorMessage("No editor with valid file name active");
			return;
		}
		var fileName = vscode.window.activeTextEditor.document.fileName;
		var ext = path.extname(fileName);
		return fileName.substr(0, fileName.length - ext.length);
	}));
	context.subscriptions.push(vscode.commands.registerCommand("code-debug.getFileBasenameNoExt", () => {
		if (!vscode.window.activeTextEditor || !vscode.window.activeTextEditor.document || !vscode.window.activeTextEditor.document.fileName) {
			vscode.window.showErrorMessage("No editor with valid file name active");
			return;
		}
		var fileName = path.basename(vscode.window.activeTextEditor.document.fileName);
		var ext = path.extname(fileName);
		return fileName.substr(0, fileName.length - ext.length);
	}));
}

var memoryLocationRegex = /^0x[0-9a-f]+$/;

function getMemoryRange(range: string) {
	if (!range)
		return undefined;
	range = range.replace(/\s+/g, "").toLowerCase();
	var index;
	if ((index = range.indexOf("+")) != -1) {
		var from = range.substr(0, index);
		var length = range.substr(index + 1);
		if (!memoryLocationRegex.exec(from))
			return undefined;
		if (memoryLocationRegex.exec(length))
			length = parseInt(length.substr(2), 16).toString();
		return "from=" + encodeURIComponent(from) + "&length=" + encodeURIComponent(length);
	}
	else if ((index = range.indexOf("-")) != -1) {
		var from = range.substr(0, index);
		var to = range.substr(index + 1);
		if (!memoryLocationRegex.exec(from))
			return undefined;
		if (!memoryLocationRegex.exec(to))
			return undefined;
		return "from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to);
	}
	else if (memoryLocationRegex.exec(range))
		return "at=" + encodeURIComponent(range);
	else return undefined;
}

function examineMemory() {
	let socketlists = path.join(os.tmpdir(), "code-debug-sockets");
	if (!fs.existsSync(socketlists)) {
		if (process.platform == "win32")
			return vscode.window.showErrorMessage("This command is not available on windows");
		else
			return vscode.window.showErrorMessage("No debugging sessions available");
	}
	fs.readdir(socketlists, (err, files) => {
		if (err) {
			if (process.platform == "win32")
				return vscode.window.showErrorMessage("This command is not available on windows");
			else
				return vscode.window.showErrorMessage("No debugging sessions available");
		}
		var pickedFile = (file) => {
			vscode.window.showInputBox({ placeHolder: "Memory Location or Range", validateInput: range => getMemoryRange(range) === undefined ? "Range must either be in format 0xF00-0xF01, 0xF100+32 or 0xABC154" : "" }).then(range => {
				vscode.commands.executeCommand("vscode.previewHtml", vscode.Uri.parse("debugmemory://" + file + "#" + getMemoryRange(range)));
			});
		};
		if (files.length == 1)
			pickedFile(files[0]);
		else if (files.length > 0)
			vscode.window.showQuickPick(files, { placeHolder: "Running debugging instance" }).then(file => pickedFile(file));
		else if (process.platform == "win32")
			return vscode.window.showErrorMessage("This command is not available on windows");
		else
			vscode.window.showErrorMessage("No debugging sessions available");
	});
}

class MemoryContentProvider implements vscode.TextDocumentContentProvider {
	provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): Thenable<string> {
		return new Promise((resolve, reject) => {
			var conn = net.connect(path.join(os.tmpdir(), "code-debug-sockets", uri.authority));
			var from, to;
			var highlightAt = -1;
			var splits = uri.fragment.split("&");
			if (splits[0].split("=")[0] == "at") {
				var loc = parseInt(splits[0].split("=")[1].substr(2), 16);
				highlightAt = 64;
				from = Math.max(loc - 64, 0);
				to = Math.max(loc + 768, 0);
			}
			else if (splits[0].split("=")[0] == "from") {
				from = parseInt(splits[0].split("=")[1].substr(2), 16);
				if (splits[1].split("=")[0] == "to") {
					to = parseInt(splits[1].split("=")[1].substr(2), 16);
				}
				else if (splits[1].split("=")[0] == "length") {
					to = from + parseInt(splits[1].split("=")[1]);
				}
				else return reject("Invalid Range");
			}
			else return reject("Invalid Range");
			if (to < from)
				return reject("Negative Range");
			conn.write("examineMemory " + JSON.stringify([from, to - from + 1]));
			conn.once("data", data => {
				var formattedCode = "";
				var hexString = data.toString();
				var x = 0;
				var asciiLine = "";
				var byteNo = 0;
				for (var i = 0; i < hexString.length; i += 2) {
					var digit = hexString.substr(i, 2);
					var digitNum = parseInt(digit, 16);
					if (digitNum >= 32 && digitNum <= 126)
						asciiLine += String.fromCharCode(digitNum);
					else
						asciiLine += ".";
					if (highlightAt == byteNo) {
						formattedCode += "<b>" + digit + "</b> ";
					} else
						formattedCode += digit + " ";
					if (++x > 16) {
						formattedCode += asciiLine + "\n";
						x = 0;
						asciiLine = "";
					}
					byteNo++;
				}
				if (x > 0) {
					for (var i = 0; i <= 16 - x; i++) {
						formattedCode += "   ";
					}
					formattedCode += asciiLine;
				}
				resolve("<h2>Memory Range from 0x" + from.toString(16) + " to 0x" + to.toString(16) + "</h2><code><pre>" + formattedCode + "</pre></code>");
				conn.destroy();
			});
		});
	}
}