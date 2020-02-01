import { Breakpoint, IBackend, Stack, Variable, VariableObject, MIError } from '../backend';
import * as ChildProcess from 'child_process';
import { EventEmitter } from 'events';
import { parseMI, MINode } from '../mi_parse';
import * as linuxTerm from '../linux/console';
import * as net from 'net';
import * as fs from 'fs';
import { posix } from 'path';
import * as nativePath from 'path';
const path = posix;

export function escape(str: string) {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const nonOutput = /^(?:\d*|undefined)[\*\+\=]|[\~\@\&\^]/;
const gdbMatch = /(?:\d*|undefined)\(gdb\)/;
const numRegex = /\d+/;

function couldBeOutput(line: string) {
    if (nonOutput.exec(line)) {
        return false;
    }
    return true;
}

const trace = false;

export class MI2 extends EventEmitter implements IBackend {
    public printCalls: boolean;
    public debugOutput: boolean;
    public procEnv: any;
    protected currentToken: number = 1;
    protected handlers: { [index: number]: (info: MINode) => any } = {};
    protected buffer: string;
    protected errbuf: string;
    protected process: ChildProcess.ChildProcess;
    protected stream;
    
    constructor(public application: string, public args: string[]) {
        super();
    }

    public connect(cwd: string, executable: string, commands: string[]): Thenable<any> {
        if (!nativePath.isAbsolute(executable)) {
            executable = nativePath.join(cwd, executable);
        }
            
        return new Promise((resolve, reject) => {
            const args = [...this.args, executable];
            this.process = ChildProcess.spawn(this.application, args, { cwd: cwd, env: this.procEnv });
            this.process.stdout.on('data', this.stdout.bind(this));
            this.process.stderr.on('data', this.stderr.bind(this));
            this.process.on('exit', (() => { this.emit('quit'); }).bind(this));
            this.process.on('error', ((err) => { this.emit('launcherror', err); }).bind(this));

            const asyncPromise = this.sendCommand('gdb-set target-async on', true);
            const promises = commands.map((c) => this.sendCommand(c));
            promises.push(asyncPromise);
            
            Promise.all(promises).then(() => {
                this.emit('debug-ready');
                resolve();
            }, reject);
        });
    }

    private stdout(data) {
        if (trace) {
            this.log('stderr', 'stdout: ' + data);
        }
        if (typeof data === 'string') {
            this.buffer += data;
        }
        else {
            this.buffer += data.toString('utf8');
        }
        const end = this.buffer.lastIndexOf('\n');
        if (end !== -1) {
            this.onOutput(this.buffer.substr(0, end));
            this.buffer = this.buffer.substr(end + 1);
        }
        if (this.buffer.length) {
            if (this.onOutputPartial(this.buffer)) {
                this.buffer = '';
            }
        }
    }

    private stderr(data) {
        if (typeof data === 'string') {
            this.errbuf += data;
        }
        else {
            this.errbuf += data.toString('utf8');
        }
        const end = this.errbuf.lastIndexOf('\n');
        if (end !== -1) {
            this.onOutputStderr(this.errbuf.substr(0, end));
            this.errbuf = this.errbuf.substr(end + 1);
        }
        if (this.errbuf.length) {
            this.logNoNewLine('stderr', this.errbuf);
            this.errbuf = '';
        }
    }

    private onOutputStderr(lines) {
        lines = lines.split('\n') as string[];
        lines.forEach((line) => {
            this.log('stderr', line);
        });
    }

    private onOutputPartial(line) {
        if (couldBeOutput(line)) {
            this.logNoNewLine('stdout', line);
            return true;
        }
        return false;
    }

    private onOutput(lines) {
        lines = lines.split('\n') as string[];
        lines.forEach((line) => {
            if (couldBeOutput(line)) {
                if (!gdbMatch.exec(line)) {
                    this.log('stdout', line);
                }
            }
            else {
                const parsed = parseMI(line);
                if (this.debugOutput) {
                    this.log('log', 'GDB -> App: ' + JSON.stringify(parsed));
                }
                let handled = false;
                if (parsed.token !== undefined) {
                    if (this.handlers[parsed.token]) {
                        this.handlers[parsed.token](parsed);
                        delete this.handlers[parsed.token];
                        handled = true;
                    }
                }
                if (!handled && parsed.resultRecords && parsed.resultRecords.resultClass === 'error') {
                    this.log('stderr', parsed.result('msg') || line);
                }
                if (parsed.outOfBandRecord) {
                    parsed.outOfBandRecord.forEach((record) => {
                        if (record.isStream) {
                            this.log(record.type, record.content);
                        }
                        else {
                            if (record.type === 'exec') {
                                this.emit('exec-async-output', parsed);
                                if (record.asyncClass === 'running') {
                                    this.emit('running', parsed);
                                }
                                else if (record.asyncClass === 'stopped') {
                                    const reason = parsed.record('reason');
                                    if (trace) {
                                        this.log('stderr', 'stop: ' + reason);
                                    }
                                    if (reason === 'breakpoint-hit') {
                                        this.emit('breakpoint', parsed);
                                    }
                                    else if (reason === 'end-stepping-range') {
                                        this.emit('step-end', parsed);
                                    }
                                    else if (reason === 'function-finished') {
                                        this.emit('step-out-end', parsed);
                                    }
                                    else if (reason === 'signal-received') {
                                        this.emit('signal-stop', parsed);
                                    }
                                    else if (reason === 'exited-normally') {
                                        this.emit('exited-normally', parsed);
                                    }
                                    else if (reason === 'exited') { // exit with error code != 0
                                        this.log('stderr', 'Program exited with code ' + parsed.record('exit-code'));
                                        this.emit('exited-normally', parsed);
                                    }
                                    else {
                                        this.log('console', 'Not implemented stop reason (assuming exception): ' + reason);
                                        this.emit('stopped', parsed);
                                    }
                                    this.emit('generic-stopped', parsed);
                                }
                                else {
                                    this.log('log', JSON.stringify(parsed));
                                }
                            }
                            else if (record.type === 'notify') {
                                let tid: undefined | string;
                                let gid: undefined | string;
                                for (const item of record.output) {
                                    if (item[0] === 'id') {
                                        tid = item[1];
                                    } else if (item[0] === 'group-id') {
                                        gid = item[1];
                                    }
                                }
                                if (record.asyncClass === 'thread-created') {
                                    this.emit('thread-created', { threadId: parseInt(tid), threadGroupId: gid });
                                }
                                else if (record.asyncClass === 'thread-exited') {
                                    this.emit('thread-exited', { threadId: parseInt(tid), threadGroupId: gid });
                                }
                                else if (record.asyncClass === 'thread-selected') {
                                    this.emit('thread-selected', { threadId: parseInt(tid) });
                                }
                                else if (record.asyncClass === 'thread-group-exited') {
                                    this.emit('thread-group-exited', { threadGroupId: tid });
                                }
                            }
                        }
                    });
                    handled = true;
                }
                if (parsed.token === undefined && parsed.resultRecords === undefined && parsed.outOfBandRecord.length === 0) {
                    handled = true;
                }
                if (!handled) {
                    this.log('log', 'Unhandled: ' + JSON.stringify(parsed));
                }
            }
        });
    }

    private tryKill() {
        const proc = this.process;
        try {
            process.kill(-proc.pid);
        }
        catch (e) {
            this.log('log', `kill failed for ${-proc.pid}` + e);
        }
    }
    
    public async stop() {
        if (trace) {
            this.log('stderr', 'stop');
        }
        const proc = this.process;
        const to = setTimeout(() => { this.tryKill(); }, 1000);
        this.process.on('exit', (code) => { clearTimeout(to); });
        // Disconnect first. Not doing so and exiting will cause an unwanted detach if the
        // program is in paused state
        await this.sendCommand('target-disconnect');
        this.sendRaw('-gdb-exit');
    }

    public async detach() {
        if (trace) {
            this.log('stderr', 'detach');
        }
        await this.sendCommand('target-detach');
        this.stop();
    }

    public interrupt(arg: string = ''): Thenable<boolean> {
        if (trace) {
            this.log('stderr', 'interrupt ' + arg);
        }
        return new Promise((resolve, reject) => {
            this.sendCommand(`exec-interrupt ${arg}`).then((info) => {
                resolve(info.resultRecords.resultClass === 'done');
            }, reject);
        });
    }

    public continue(threadId: number): Thenable<boolean> {
        if (trace) {
            this.log('stderr', 'continue');
        }
        return new Promise((resolve, reject) => {
            this.sendCommand(`exec-continue --thread ${threadId}`).then((info) => {
                resolve(info.resultRecords.resultClass === 'running');
            }, reject);
        });
    }

    public next(threadId: number, instruction?: boolean): Thenable<boolean> {
        if (trace) {
            this.log('stderr', 'next');
        }
        return new Promise((resolve, reject) => {
            const baseCmd = instruction ? 'exec-next-instruction' : 'exec-next';
            this.sendCommand(`${baseCmd} --thread ${threadId}`).then((info) => {
                resolve(info.resultRecords.resultClass === 'running');
            }, reject);
        });
    }

    public step(threadId: number, instruction?: boolean): Thenable<boolean> {
        if (trace) {
            this.log('stderr', 'step');
        }
        return new Promise((resolve, reject) => {
            const baseCmd = instruction ? 'exec-step-instruction' : 'exec-step';
            this.sendCommand(`${baseCmd} --thread ${threadId}`).then((info) => {
                resolve(info.resultRecords.resultClass === 'running');
            }, reject);
        });
    }

    public stepOut(threadId: number): Thenable<boolean> {
        if (trace) {
            this.log('stderr', 'stepOut');
        }
        return new Promise((resolve, reject) => {
            this.sendCommand(`exec-finish --thread ${threadId}`).then((info) => {
                resolve(info.resultRecords.resultClass === 'running');
            }, reject);
        });
    }

    public restart(commands: string[]): Thenable<boolean> {
        if (trace) {
            this.log('stderr', 'restart');
        }
        return this._sendCommandSequence(commands);
    }

    public postStart(commands: string[]): Thenable<boolean> {
        if (trace) {
            this.log('stderr', 'post-start');
        }
        return this._sendCommandSequence(commands);
    }

    private _sendCommandSequence(commands: string[]): Thenable<boolean> {
        return new Promise((resolve, reject) => {
            const nextCommand = ((commands: string[]) => {
                if (commands.length === 0) {
                    resolve(true);
                } else {
                    const command = commands[0];
                    this.sendCommand(command).then((r) => { nextCommand(commands.slice(1)); }, reject);
                }
            }).bind(this);

            nextCommand(commands);
        });
    }

    public changeVariable(name: string, rawValue: string): Thenable<any> {
        if (trace) {
            this.log('stderr', 'changeVariable');
        }
        return this.sendCommand('gdb-set var ' + name + '=' + rawValue);
    }

    public setBreakPointCondition(bkptNum, condition): Thenable<any> {
        if (trace) {
            this.log('stderr', 'setBreakPointCondition');
        }
        return this.sendCommand('break-condition ' + bkptNum + ' ' + condition);
    }

    public addBreakPoint(breakpoint: Breakpoint): Promise<Breakpoint> {
        if (trace) {
            this.log('stderr', 'addBreakPoint');
        }
        return new Promise((resolve, reject) => {
            let location = '';
            if (breakpoint.countCondition) {
                if (breakpoint.countCondition[0] === '>') {
                    location += '-i ' + numRegex.exec(breakpoint.countCondition.substr(1))[0] + ' ';
                }
                else {
                    const match = numRegex.exec(breakpoint.countCondition)[0];
                    if (match.length !== breakpoint.countCondition.length) {
                        // tslint:disable-next-line:max-line-length
                        this.log('stderr', 'Unsupported break count expression: \'' + breakpoint.countCondition + '\'. Only supports \'X\' for breaking once after X times or \'>X\' for ignoring the first X breaks');
                        location += '-t ';
                    }
                    else if (parseInt(match) !== 0) {
                        location += '-t -i ' + parseInt(match) + ' ';
                         }
                }
            }

            if (breakpoint.raw) {
                location += '*' + escape(breakpoint.raw);
            }
            else {
                location += '"' + escape(breakpoint.file) + ':' + breakpoint.line + '"';
            }
            
            this.sendCommand(`break-insert ${location}`).then((result) => {
                if (result.resultRecords.resultClass === 'done') {
                    const bkptNum = parseInt(result.result('bkpt.number'));
                    breakpoint.number = bkptNum;

                    if (breakpoint.condition) {
                        this.setBreakPointCondition(bkptNum, breakpoint.condition).then((result) => {
                            if (result.resultRecords.resultClass === 'done') {
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

    public removeBreakpoints(breakpoints: number[]): Promise<boolean> {
        if (trace) {
            this.log('stderr', 'removeBreakPoint');
        }
        return new Promise((resolve, reject) => {
            if (breakpoints.length === 0) {
                resolve(true);
            }
            else {
                const cmd = 'break-delete ' + breakpoints.join(' ');
                this.sendCommand(cmd).then((result) => {
                    resolve(result.resultRecords.resultClass === 'done');
                }, reject);
            }
        });
    }

    public getFrame(thread: number, frame: number): Thenable<Stack> {
        return new Promise((resolve, reject) => {
            const command = `stack-info-frame --thread ${thread} --frame ${frame}`;

            this.sendCommand(command).then((result) => {
                const frame = result.result('frame');
                const level = MINode.valueOf(frame, 'level');
                const addr = MINode.valueOf(frame, 'addr');
                const func = MINode.valueOf(frame, 'func');
                const file = MINode.valueOf(frame, 'file');
                const fullname = MINode.valueOf(frame, 'fullname');
                let line = 0;
                const linestr = MINode.valueOf(frame, 'line');
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

    public getStack(threadId: number, startLevel: number, maxLevels: number): Thenable<Stack[]> {
        if (trace) {
            this.log('stderr', 'getStack');
        }
        return new Promise((resolve, reject) => {
            this.sendCommand(`stack-list-frames --thread ${threadId} ${startLevel} ${maxLevels}`).then((result) => {
                const stack = result.result('stack');
                const ret: Stack[] = [];
                stack.forEach((element) => {
                    const level = MINode.valueOf(element, '@frame.level');
                    const addr = MINode.valueOf(element, '@frame.addr');
                    const func = MINode.valueOf(element, '@frame.func');
                    const filename = MINode.valueOf(element, '@frame.file');
                    const file = MINode.valueOf(element, '@frame.fullname');
                    let line = 0;
                    const lnstr = MINode.valueOf(element, '@frame.line');
                    if (lnstr) { line = parseInt(lnstr); }
                    const from = parseInt(MINode.valueOf(element, '@frame.from'));
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

    public async getStackVariables(thread: number, frame: number): Promise<Variable[]> {
        if (trace) {
            this.log('stderr', 'getStackVariables');
        }

        const result = await this.sendCommand(`stack-list-variables --thread ${thread} --frame ${frame} --simple-values`);
        const variables = result.result('variables');
        const ret: Variable[] = [];
        for (const element of variables) {
            const key = MINode.valueOf(element, 'name');
            const value = MINode.valueOf(element, 'value');
            const type = MINode.valueOf(element, 'type');
            ret.push({
                name: key,
                valueStr: value,
                type: type,
                raw: element
            });
        }
        return ret;
    }

    public examineMemory(from: number, length: number): Thenable<any> {
        if (trace) {
            this.log('stderr', 'examineMemory');
        }
        return new Promise((resolve, reject) => {
            this.sendCommand('data-read-memory-bytes 0x' + from.toString(16) + ' ' + length).then((result) => {
                resolve(result.result('memory[0].contents'));
            }, reject);
        });
    }

    // Pass negative threadId/frameId to specify no context or current context
    public evalExpression(name: string, threadId: number, frameId: number): Thenable<any> {
        if (trace) {
            this.log('stderr', 'evalExpression');
        }
        return new Promise((resolve, reject) => {
            const thFr = MI2.getThreadFrameStr(threadId, frameId);
            this.sendCommand(`data-evaluate-expression ${thFr} ` + name).then((result) => {
                resolve(result);
            }, reject);
        });
    }

    public static FORMAT_SPEC_MAP = {
        b: 'binary',
        d: 'decimal',
        h: 'hexadecimal',
        o: 'octal',
        n: 'natural',
        x: 'hexadecimal'
    };

    public async varCreate(expression: string, name: string = '-', scope: string = '@'): Promise<VariableObject> {
        if (trace) {
            this.log('stderr', 'varCreate');
        }
        let fmt = null;
        expression = expression.trim();
        if (/,[bdhonx]$/i.test(expression)) {
            fmt = expression.substring(expression.length - 1).toLocaleLowerCase();
            expression = expression.substring(0, expression.length - 2);
        }
        expression = expression.replace(/"/g, '\\"');

        const createResp = await this.sendCommand(`var-create ${name} ${scope} "${expression}"`);
        let overrideVal = null;
        if (fmt && name !== '-') {
            const formatResp = await this.sendCommand(`var-set-format ${name} ${MI2.FORMAT_SPEC_MAP[fmt]}`);
            overrideVal = formatResp.result('value');
        }

        let result = createResp.result('');
        if (overrideVal) {
            result = result.map((r: string[]) => r[0] === 'value' ?  ['value', overrideVal] : r);
        }
        return new VariableObject(result);
    }

    public async varEvalExpression(name: string): Promise<MINode> {
        if (trace) {
            this.log('stderr', 'varEvalExpression');
        }
        return this.sendCommand(`var-evaluate-expression ${name}`);
    }

    public async varListChildren(name: string, flattenAnonymous: boolean): Promise<VariableObject[]> {
        if (trace) {
            this.log('stderr', 'varListChildren');
        }
        // TODO: add `from` and `to` arguments
        const res = await this.sendCommand(`var-list-children --all-values ${name}`);
        const children = res.result('children') || [];
        const omg: VariableObject[] = [];
        for (const item of children) {
            const child = new VariableObject(item[1]);
            if (flattenAnonymous && child.exp.startsWith('<anonymous ')) {
                omg.push(... await this.varListChildren(child.name, flattenAnonymous));
            } else {
                omg.push(child);
            }
        }
        return omg;
    }

    public static getThreadFrameStr(threadId: number, frameId: number): string {
        const th = threadId > 0 ? `--thread ${threadId} ` : '';
        const fr = frameId >= 0 ? `--frame ${frameId}` : '';
        return th + fr;
    }

    // Pass negative threadId/frameId to specify no context or current context
    public async varUpdate(name: string = '*', threadId: number, frameId: number): Promise<MINode> {
        if (trace) {
            this.log('stderr', 'varUpdate');
        }
        return this.sendCommand(`var-update ${MI2.getThreadFrameStr(threadId, frameId)} --all-values ${name}`);
    }

    // Pass negative threadId/frameId to specify no context or current context
    public async varAssign(name: string, rawValue: string, threadId: number, frameId: number): Promise<MINode> {
        if (trace) {
            this.log('stderr', 'varAssign');
        }
        return this.sendCommand(`var-assign ${MI2.getThreadFrameStr(threadId, frameId)} ${name} ${rawValue}`);
    }

    public logNoNewLine(type: string, msg: string) {
        this.emit('msg', type, msg);
    }

    public log(type: string, msg: string) {
        this.emit('msg', type, msg[msg.length - 1] === '\n' ? msg : (msg + '\n'));
    }

    public sendUserInput(command: string): Thenable<any> {
        if (command.startsWith('-')) {
            return this.sendCommand(command.substr(1));
        }
        else {
            return this.sendCommand(`interpreter-exec console "${command}"`);
        }
    }

    public sendRaw(raw: string) {
        if (this.printCalls || trace) {
            this.log('log', raw);
        }
        if (raw.includes('undefined')) {
            console.log(raw);
        }
        this.process.stdin.write(raw + '\n');
    }

    public getCurrentToken(): number {
        return this.currentToken;
    }

    public sendCommand(command: string, suppressFailure: boolean = false): Thenable<MINode> {
        const sel = this.currentToken++;
        return new Promise((resolve, reject) => {
            this.handlers[sel] = (node: MINode) => {
                if (node && node.resultRecords && node.resultRecords.resultClass === 'error') {
                    if (suppressFailure) {
                        this.log('stderr', `WARNING: Error executing command '${command}'`);
                        resolve(node);
                    }
                    else {
                        reject(new MIError(node.result('msg') || 'Internal error', command));
                    }
                }
                else {
                    resolve(node);
                }
            };
            this.sendRaw(sel + '-' + command);
        });
    }

    public isReady(): boolean {
        return !!this.process;
    }
}
