export interface Breakpoint {
	file: string;
	line: number;
	condition: string;
}

export interface Stack {
	level: number;
	address: string;
	function: string;
	fileName: string;
	file: string;
	line: number;
}

export interface IBackend {
	load(cwd: string, target: string): Thenable<any>;
	attach(cwd: string, executable: string, target: string): Thenable<any>;
	connect(cwd: string, executable: string, target: string): Thenable<any>;
	start(): Thenable<boolean>;
	stop();
	detach();
	interrupt(): Thenable<boolean>;
	continue(): Thenable<boolean>;
	next(): Thenable<boolean>;
	step(): Thenable<boolean>;
	stepOut(): Thenable<boolean>;
	loadBreakPoints(breakpoints: Breakpoint[]): Thenable<[boolean, Breakpoint][]>;
	addBreakPoint(breakpoint: Breakpoint): Thenable<[boolean, Breakpoint]>;
	removeBreakPoint(breakpoint: Breakpoint): Thenable<boolean>;
	clearBreakPoints(): Thenable<any>;
	getStack(maxLevels: number): Thenable<Stack[]>;
	getStackVariables(thread: number, frame: number): Thenable<[string, string][]>;
	evalExpression(name: string): Thenable<any>;
	isReady(): boolean;
}