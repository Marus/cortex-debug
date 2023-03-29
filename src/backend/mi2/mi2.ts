import { IBackend, Stack, Variable, VariableObject, MIError,
    OurInstructionBreakpoint, OurDataBreakpoint, OurSourceBreakpoint } from '../backend';
import * as ChildProcess from 'child_process';
import { EventEmitter } from 'events';
import { parseMI, MINode } from '../mi_parse';
import { posix } from 'path';
import * as os from 'os';
import { ServerConsoleLog } from '../server';
import { hexFormat } from '../../frontend/utils';
import { ADAPTER_DEBUG_MODE } from '../../common';
const path = posix;

export interface ReadMemResults {
    startAddress: string;
    endAddress: string;
    data: string;
}

export function parseReadMemResults(node: MINode): ReadMemResults {
    const startAddress = node.resultRecords.results[0][1][0][0][1];
    const endAddress = node.resultRecords.results[0][1][0][2][1];
    const data = node.resultRecords.results[0][1][0][3][1];
    const ret: ReadMemResults = {
        startAddress: startAddress,
        endAddress: endAddress,
        data: data
    };
    return ret;
}

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
    public debugOutput: ADAPTER_DEBUG_MODE;
    public procEnv: any;
    protected currentToken: number = 1;
    protected nextTokenComing = 1;          // This will be the next token output from gdb
    protected handlers: { [index: number]: (info: MINode) => any } = {};
    protected needOutput: { [index: number]: '' } = {};
    protected buffer: string = '';
    protected errbuf: string = '';
    protected process: ChildProcess.ChildProcess;
    protected stream;
    protected firstStop: boolean = true;
    protected exited: boolean = false;
    public gdbMajorVersion: number | undefined;
    public gdbMinorVersion: number | undefined;
    public status: 'running' | 'stopped' | 'none' = 'none';
    public pid: number = -1;
    protected lastContinueSeqId = -1;
    protected actuallyStarted = false;
    protected isExiting = false;
    // public gdbVarsPromise: Promise<MINode> = null;

    constructor(public application: string, public args: string[]) {
        super();
    }

    public start(cwd: string, init: string[]): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            this.process = ChildProcess.spawn(this.application, this.args, { cwd: cwd, env: this.procEnv });
            this.pid = this.process.pid;
            this.process.stdout.on('data', this.stdout.bind(this));
            this.process.stderr.on('data', this.stderr.bind(this));
            this.process.on('exit', (code: number, signal: string) => {
                this.onExit(code, signal);
            });
            this.process.on('error', this.onError.bind(this));
            this.process.on('spawn', () => {
                ServerConsoleLog(`GDB started ppid=${process.pid} pid=${this.process.pid}`, this.process.pid);
            });

            let timeout = setTimeout(() => {
                this.gdbStartError();
                reject(new Error('Could not start gdb, no response from gdb'));
                timeout = undefined;
            }, 5000);

            const swallOutput = this.debugOutput ? false : true;
            let v;
            try {
                v = await this.sendCommand('gdb-version', false, true, swallOutput);
                if (timeout) {
                    clearTimeout(timeout);
                } else {
                    return;
                }
            }
            catch (e) {
                reject(e);
                return;
            }
            this.actuallyStarted = true;
            this.parseVersionInfo(v.output);
            if ((this.gdbMajorVersion !== undefined) && (this.gdbMajorVersion < 9)) {
                this.isExiting = true;
                const ver = this.gdbMajorVersion ? this.gdbMajorVersion.toString() : 'Unknown';
                const msg = `ERROR: GDB major version should be >= 9, yours is ${ver}`;
                this.log('stderr', msg);
                this.sendRaw('-gdb-exit');
                // reject(new Error(msg));
                resolve();
                return;
            }
            const asyncCmd = 'gdb-set mi-async on';
            const promises = [asyncCmd, ...init].map((c) => this.sendCommand(c));
            Promise.all(promises).then(() => {
                /*
                gdb crashes or runs out of memory with the following
                if (this.gdbMajorVersion >= 9) {
                    this.gdbVarsPromise = new Promise((resolve) => {
                        this.sendCommand('symbol-info-variables', false, false, true).then((x) => {
                            resolve(x);
                        }, (e) => {
                            reject(e);
                        });
                    });
                }
                */
                resolve();
            }, reject);
        });
    }

    private onError(err) {
        this.emit('launcherror', err);
    }

    private parseVersionInfo(str: string) {
        const regex = RegExp(/^GNU gdb.*\s(\d+)\.(\d+)[^\r\n]*/gm);
        const match = regex.exec(str);
        if (match !== null) {
            str = str.substr(0, match.index);
            this.gdbMajorVersion = parseInt(match[1]);
            this.gdbMinorVersion = parseInt(match[2]);
        }
        if (str) {
            this.log('console', str);
        }
        if (match === null) {
            this.log('log', 'ERROR: Could not determine gdb-version number (regex failed). We need version >= 9. Please report this problem.');
            this.log('log', '    This can result in silent failures');
        }
    }

    public connect(commands: string[]): Thenable<any> {
        return new Promise<void>((resolve, reject) => {
            const promises = commands.map((c) => this.sendCommand(c));
            Promise.all(promises).then(() => {
                this.emit('debug-ready');
                resolve();
            }, reject);
        });
    }

    private onExit(code: number, signal: string) {
        this.gdbStartError();
        ServerConsoleLog('GDB: exited', this.pid);
        if (this.process) {
            this.process = null;
            this.exited = true;
            // Unless we are the ones initiating the quitting,
            const codestr = code === null || code === undefined ? 'none' : code.toString();
            const sigstr = signal ? `, signal: ${signal}` : '';
            const how = this.exiting ? '' : ((code || signal) ? ' unexpectedly' : '');
            const msg = `GDB session ended${how}. exit-code: ${codestr}${sigstr}\n`;
            this.emit('quit', how ? 'stderr' : 'stdout', msg);
        }
    }

    private gdbStartError() {
        if (!this.actuallyStarted) {
            this.log('log', 'Error: Unable to start GDB even after 5 seconds or it couldn\'t even start ' +
                'Make sure you can start gdb from the command-line and run any command like "echo hello".\n');
            this.log('log', '    If you cannot, it is most likely because "libncurses" or "python" is not installed. Some GDBs require these\n');
        }
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
                if (this.debugOutput && (this.debugOutput !== ADAPTER_DEBUG_MODE.NONE)) {
                    if ((this.debugOutput === ADAPTER_DEBUG_MODE.RAW) || (this.debugOutput === ADAPTER_DEBUG_MODE.BOTH)) {
                        this.log('log', '-> ' + line);
                    }
                    if (this.debugOutput !== ADAPTER_DEBUG_MODE.RAW) {
                        this.log('log', 'GDB -> App: ' + JSON.stringify(parsed));
                    }
                }
                if (parsed.token !== undefined) {
                    if (this.needOutput[parsed.token] !== undefined) {
                        parsed.output = this.needOutput[parsed.token];
                    }
                    this.nextTokenComing = parsed.token + 1;
                }
                let handled = false;
                if (parsed.token !== undefined && parsed.resultRecords) {
                    if (this.handlers[parsed.token]) {
                        this.handlers[parsed.token](parsed);
                        delete this.handlers[parsed.token];
                        handled = true;
                    } else if (parsed.token === this.lastContinueSeqId) {
                        // This is the situation where the last continue actually fails but is initially reported
                        // having worked. See if we can gracefully handle it. See #561
                        this.status = 'stopped';
                        this.log('stderr', `GDB Error? continue command is reported as error after initially succeeding. token '${parsed.token}'`);
                        this.emit('continue-failed', parsed);
                    } else {
                        this.log('stderr', `Internal Error? Multiple results or no handler for query token '${parsed.token}'`);
                    }
                }
                if (!handled && parsed.resultRecords && parsed.resultRecords.resultClass === 'error') {
                    this.log('stderr', parsed.result('msg') || line);
                }
                if (parsed.outOfBandRecord) {
                    parsed.outOfBandRecord.forEach((record) => {
                        if (record.isStream) {
                            if ((record.type === 'console') && (this.needOutput[this.nextTokenComing] !== undefined)) {
                                this.needOutput[this.nextTokenComing] += record.content;
                            } else {
                                this.log(record.type, record.content);
                            }
                        }
                        else {
                            if (record.type === 'exec') {
                                this.emit('exec-async-output', parsed);
                                if (record.asyncClass === 'running') {
                                    this.status = 'running';
                                    if (this.debugOutput) {
                                        this.log('log', `mi2.status = ${this.status}`);
                                    }
                                    this.emit('running', parsed);
                                }
                                else if (record.asyncClass === 'stopped') {
                                    this.status = 'stopped';
                                    if (this.debugOutput) {
                                        this.log('log', `mi2.status = ${this.status}`);
                                    }
                                    const reason = parsed.record('reason');
                                    if (trace) {
                                        this.log('stderr', 'stop: ' + reason);
                                    }
                                    if (reason === 'breakpoint-hit') {
                                        this.emit('breakpoint', parsed);
                                    }
                                    else if (reason && (reason as string).includes('watchpoint-trigger')) {
                                        this.emit('watchpoint', parsed);
                                    }
                                    else if (reason && (reason as string).includes('watchpoint-scope')) {
                                        // When a local variable goes out of scope
                                        this.emit('watchpoint-scope', parsed);
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
                                        if ((reason === undefined) && this.firstStop) {
                                            this.log('console', 'Program stopped, probably due to a reset and/or halt issued by debugger');
                                            this.emit('stopped', parsed, 'entry');
                                        } else {
                                            this.log('console', 'Not implemented stop reason (assuming exception): ' + reason || 'Unknown reason');
                                            this.emit('stopped', parsed);
                                        }
                                    }
                                    this.firstStop = false;
                                    this.emit('generic-stopped', parsed);
                                }
                                else {
                                    this.log('log', JSON.stringify(parsed));
                                }
                            }
                            else if (record.type === 'notify') {
                                let tid: undefined | string;
                                let gid: undefined | string;
                                let fid: undefined | string;
                                for (const item of record.output) {
                                    if (item[0] === 'id') {
                                        tid = item[1];
                                    } else if (item[0] === 'group-id') {
                                        gid = item[1];
                                    } else if (item[0] === 'frame') {
                                        fid = item[1];  // for future use, available for thread-selected
                                    }
                                }
                                if (record.asyncClass === 'thread-created') {
                                    this.emit('thread-created', { threadId: parseInt(tid), threadGroupId: gid });
                                }
                                else if (record.asyncClass === 'thread-exited') {
                                    this.emit('thread-exited', { threadId: parseInt(tid), threadGroupId: gid });
                                }
                                else if (record.asyncClass === 'thread-selected') {
                                    this.emit('thread-selected', { threadId: parseInt(tid), frameId: fid });
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
        if (!this.exited && this.process) {
            const proc = this.process;
            try {
                ServerConsoleLog('GDB kill()', this.pid);
                process.kill(-proc.pid);
            }
            catch (e) {
                this.log('log', `kill failed for ${-proc.pid}` + e);
                this.onExit(-1, '');      // Process already died or quit. Cleanup
            }
        }
    }
    
    // stop() can get called twice ... once by the disconnect sequence and once by the server existing because
    // we called disconnect. And the sleeps don't help that cause
    private exiting = false;
    public async stop() {
        if (trace) {
            this.log('stderr', 'stop');
        }
        if (!this.exited && !this.exiting) {
            this.exiting = true;            // We won't unset this
            // With JLink all of these catches, timeouts occur one time or the other. Two back to back runs don't produce
            // the same program flow. Sometimes, we get all the way to a proper gdb-exit without any timers expiring and
            // everything working. Very next run totally erratic. Openocd has its own issues
            let timer;
            const startKillTimeout = (ms: number) => {
                if (timer) { clearTimeout(timer); }
                timer = setTimeout(() => {
                    if (timer && !this.exited) {
                        ServerConsoleLog('GDB Kill timer expired for a disconnect+exit, so forcing a kill', this.pid);
                        this.tryKill();
                    }
                    timer = undefined;
                }, ms);
            };
            const destroyTimer = () => {
                if (timer) {
                    clearTimeout(timer);
                    timer = undefined;
                }
            };
            this.process.on('exit', (code) => { destroyTimer(); });
            // Disconnect first. Not doing so and exiting will cause an unwanted detach if the
            // program is in paused state
            try {
                startKillTimeout(500);
                await new Promise((res) => setTimeout(res, 100));       // For some people delay was needed. Doesn't hurt I guess
                await this.sendCommand('target-disconnect');            // Yes, this can fail
            }
            catch (e) {
                if (this.exited) {
                    ServerConsoleLog('GDB already exited during a target-disconnect', this.pid);
                    destroyTimer();
                    return;
                }
                ServerConsoleLog(`target-disconnect failed with exception: ${e}. Proceeding to gdb-exit` + e, this.pid);
            }

            startKillTimeout(350);                                  // Reset timer for a smaller timeout
            await new Promise((res) => setTimeout(res, 250));       // For some people delay was needed. Doesn't hurt I guess
            if (this.exited) {
                // This occurs sometimes after a successful disconnect.
                ServerConsoleLog('gdb already exited before an exit was requested', this.pid);
                return;
            }
            this.sendRaw('-gdb-exit');
        }
    }

    public detach() {
        if (trace) {
            this.log('stderr', 'detach');
        }
        let to = setTimeout(() => {
            if (to) {
                ServerConsoleLog('target-detach hung: target probably running, thats okay, continue to stop()', this.pid);
                to = null;
                this.stop();
            }
        }, 100);

        // Following can hang if no response, or fail because the target is still running. Yes,
        // we sometimes detach when target is still running. This also causes unhandled rejection
        // warning/error from Node, so handle rejections.
        this.sendCommand('target-detach').then(() => {
            if (to) {
                clearTimeout(to);
                to = null;
            }
            this.stop();
        }, (e) => {
            if (to) {
                clearTimeout(to);
                to = null;
            }
            ServerConsoleLog('target-detach failed: target probably running, thats okay, continue to stop()', this.pid);
            this.stop();
        });
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

    public goto(filename: string, line: number): Thenable<boolean> {
        if (trace) {
            this.log('stderr', 'goto');
        }
        return new Promise((resolve, reject) => {
            const target: string = '"' + (filename ? escape(filename) + ':' : '') + line.toString() + '"';
            this.sendCommand('break-insert -t ' + target).then(() => {
                this.sendCommand('exec-jump ' + target).then((info) => {
                    resolve(info.resultRecords.resultClass === 'running');
                }, reject);
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

    private setBreakPointCondition(bkptNum, condition): Thenable<any> {
        if (trace) {
            this.log('stderr', 'setBreakPointCondition');
        }
        return this.sendCommand('break-condition ' + bkptNum + ' ' + condition);
    }

    public addBreakPoint(breakpoint: OurSourceBreakpoint): Promise<OurSourceBreakpoint> {
        if (trace) {
            this.log('stderr', 'addBreakPoint');
        }
        return new Promise((resolve, reject) => {
            let bkptArgs = '';
            if (breakpoint.hitCondition) {
                if (breakpoint.hitCondition[0] === '>') {
                    bkptArgs += '-i ' + numRegex.exec(breakpoint.hitCondition.substr(1))[0] + ' ';
                }
                else {
                    const match = numRegex.exec(breakpoint.hitCondition)[0];
                    if (match.length !== breakpoint.hitCondition.length) {
                        // tslint:disable-next-line:max-line-length
                        this.log('stderr', 'Unsupported break count expression: \'' + breakpoint.hitCondition + '\'. Only supports \'X\' for breaking once after X times or \'>X\' for ignoring the first X breaks');
                        bkptArgs += '-t ';
                    }
                    else if (parseInt(match) !== 0) {
                        bkptArgs += '-t -i ' + parseInt(match) + ' ';
                    }
                }
            }

            if (breakpoint.condition) {
                bkptArgs += `-c "${breakpoint.condition}" `;
            }

            if (breakpoint.raw) {
                bkptArgs += '*' + escape(breakpoint.raw);
            }
            else {
                bkptArgs += '"' + escape(breakpoint.file) + ':' + breakpoint.line + '"';
            }

            const cmd = breakpoint.logMessage ? 'dprintf-insert' : 'break-insert';
            if (breakpoint.logMessage) {
                bkptArgs += ' ' + breakpoint.logMessage;
            }
            
            this.sendCommand(`${cmd} ${bkptArgs}`).then((result) => {
                if (result.resultRecords.resultClass === 'done') {
                    const bkptNum = parseInt(result.result('bkpt.number'));
                    const line = result.result('bkpt.line');
                    const addr = result.result('bkpt.addr');
                    breakpoint.line = line ? parseInt(line) : breakpoint.line;
                    breakpoint.number = bkptNum;
                    if (addr) {
                        breakpoint.address = addr;
                    }

                    if (breakpoint.file === undefined) {
                        const file = result.result('bkpt.fullname') || result.record('bkpt.file');
                        breakpoint.file = file ? file : undefined;
                    }
                    resolve(breakpoint);
                }
                else {
                    reject(new MIError(result.result('msg') || 'Internal error', `Setting breakpoint at ${bkptArgs}`));
                }
            }, reject);
        });
    }

    public addInstrBreakPoint(breakpoint: OurInstructionBreakpoint): Promise<OurInstructionBreakpoint> {
        if (trace) {
            this.log('stderr', 'addBreakPoint');
        }
        return new Promise((resolve, reject) => {
            let bkptArgs = '';
            if (breakpoint.condition) {
                bkptArgs += `-c "${breakpoint.condition}" `;
            }

            bkptArgs += '*' + hexFormat(breakpoint.address);
            
            this.sendCommand(`break-insert ${bkptArgs}`).then((result) => {
                if (result.resultRecords.resultClass === 'done') {
                    const bkptNum = parseInt(result.result('bkpt.number'));
                    breakpoint.number = bkptNum;
                    resolve(breakpoint);
                }
                else {
                    reject(new MIError(result.result('msg') || 'Internal error', `Setting breakpoint at ${bkptArgs}`));
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

    public addDataBreakPoint(breakpoint: OurDataBreakpoint): Promise<OurDataBreakpoint> {
        if (trace) {
            this.log('stderr', 'addBreakPoint');
        }
        return new Promise((resolve, reject) => {
            let bkptArgs = '';
            if (breakpoint.hitCondition) {
                if (breakpoint.hitCondition[0] === '>') {
                    bkptArgs += '-i ' + numRegex.exec(breakpoint.hitCondition.substr(1))[0] + ' ';
                }
                else {
                    const match = numRegex.exec(breakpoint.hitCondition)[0];
                    if (match.length !== breakpoint.hitCondition.length) {
                        // tslint:disable-next-line:max-line-length
                        this.log('stderr', 'Unsupported break count expression: \'' + breakpoint.hitCondition + '\'. Only supports \'X\' for breaking once after X times or \'>X\' for ignoring the first X breaks');
                        bkptArgs += '-t ';
                    }
                    else if (parseInt(match) !== 0) {
                        bkptArgs += '-t -i ' + parseInt(match) + ' ';
                    }
                }
            }

            bkptArgs += breakpoint.dataId;
            const aType = breakpoint.accessType === 'read' ? '-r' : (breakpoint.accessType === 'readWrite' ? '-a' : '');
            this.sendCommand(`break-watch ${aType} ${bkptArgs}`).then((result) => {
                if (result.resultRecords.resultClass === 'done') {
                    const bkptNum = parseInt(result.result('hw-awpt.number') || result.result('hw-rwpt.number') || result.result('wpt.number'));
                    breakpoint.number = bkptNum;

                    if (breakpoint.condition) {
                        this.setBreakPointCondition(bkptNum, breakpoint.condition).then((result) => {
                            if (result.resultRecords.resultClass === 'done') {
                                resolve(breakpoint);
                            } else {
                                reject(new MIError(result.result('msg') || 'Internal error', 'Setting breakpoint condition'));
                            }
                        },
                        (reason) => {
                            // Just delete the breakpoint we just created as the condition creation failed
                            this.sendCommand(`break-delete ${bkptNum}`).then((x) => {}, (e) => {});
                            reject(reason);     // Use this reason as reason for failing to create the breakpoint
                        });
                    } else {
                        resolve(breakpoint);
                    }
                }
                else {
                    reject(new MIError(result.result('msg') || 'Internal error', `Setting breakpoint at ${bkptArgs}`));
                }
            }, reject);
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

    public getStackDepth(threadId: number): Thenable<number> {
        if (trace) {
            this.log('stderr', 'getStackDepth');
        }
        return new Promise((resolve, reject) => {
            this.sendCommand(`stack-info-depth --thread ${threadId} 1000`).then((result) => {
                const depth = result.result('depth');
                const ret = parseInt(depth);
                resolve(ret);
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

        try {
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
            return Promise.resolve(ret);
        }
        catch (e) {
            return Promise.reject(e);
        }
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

    public async varCreate(
        parent: number, expression: string, name: string = '-', scope: string = '@',
        threadId?: number, frameId?: number): Promise<VariableObject> {
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

        const thFr = ((scope === '*') && (threadId !== undefined) && (frameId !== undefined)) ? `--thread ${threadId} --frame ${frameId}` : '';
        const createResp = await this.sendCommand(`var-create ${thFr} ${name} ${scope} "${expression}"`);
        let overrideVal = null;
        if (fmt && name !== '-') {
            const formatResp = await this.sendCommand(`var-set-format ${name} ${MI2.FORMAT_SPEC_MAP[fmt]}`);
            overrideVal = formatResp.result('value');
        }

        let result = createResp.result('');
        if (overrideVal) {
            result = result.map((r: string[]) => r[0] === 'value' ?  ['value', overrideVal] : r);
        }
        return new VariableObject(parent, result);
    }

    public async varEvalExpression(name: string): Promise<MINode> {
        if (trace) {
            this.log('stderr', 'varEvalExpression');
        }
        return this.sendCommand(`var-evaluate-expression ${name}`);
    }

    public async varListChildren(parent: number, name: string): Promise<VariableObject[]> {
        if (trace) {
            this.log('stderr', 'varListChildren');
        }
        // TODO: add `from` and `to` arguments
        const res = await this.sendCommand(`var-list-children --all-values ${name}`);
        const keywords = ['private', 'protected', 'public'];
        const children = res.result('children') || [];
        const omg: VariableObject[] = [];
        for (const item of children) {
            const child = new VariableObject(parent, item[1]);
            if (child.exp.startsWith('<anonymous ')) {
                omg.push(... await this.varListChildren(parent, child.name));
            } else if (keywords.find((x) => x === child.exp)) {
                omg.push(... await this.varListChildren(parent, child.name));
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
        if (!this.process?.stdin) {
            // Already closed, should we throw an exception?
            return;
        }
        if (this.debugOutput || trace) {
            this.log('log', raw);
        }
        this.process.stdin.write(raw + '\n');   // Sometimes, process is already null
    }

    public getCurrentToken(): number {
        return this.currentToken;
    }

    public isRunning(): boolean {
        if (this.isExiting) {
            return false;
        }
        return !!this.process;
    }

    public sendOneCommand(args: SendCommaindIF): Thenable<MINode> {
        const sel = this.currentToken++;
        return new Promise((resolve, reject) => {
            const errReport = (arg: MINode | Error) => {
                const nd = arg as MINode;
                if (args.suppressFailure && nd) {
                    this.log('stderr', `WARNING: Error executing command '${args.command}'`);
                    resolve(nd);
                } else if (!nd) {
                    reject(new MIError(arg ? arg.toString() : 'Unknown error', args.command));
                } else {
                    try {
                        const msg = nd.result('msg');
                        reject(new MIError(msg || 'Internal error', args.command));
                    }
                    catch (e) {
                        console.log(`Huh? ${e}`);
                        reject(new MIError(e.toString(), args.command));
                    }
                }
            };
            if (args.swallowStdout) {
                this.needOutput[sel] = '';
            }
            const save = this.debugOutput;
            if (args.forceNoDebug && this.debugOutput) {
                this.log('log', `Suppressing output for '${sel}-${args.command}'`);
                // We need to be more sophisticated than this. There could be other commands in flight
                // We should do this how we do the swallowStdout
                this.debugOutput = undefined;
            }
            this.handlers[sel] = (node: MINode) => {
                this.debugOutput = save;
                if (args.swallowStdout) {
                    delete this.needOutput[sel];
                }
                if (node.resultRecords.resultClass === 'error') {
                    errReport(node);
                }
                else {
                    resolve(node);
                }
            };
            if (args.command.startsWith('exec-continue')) {
                this.lastContinueSeqId = sel;
            }
            try {
                this.sendRaw(sel + '-' + args.command);
            }
            catch (e) {
                this.debugOutput = save;
                errReport(e);
            }
        });
    }

    private commandQueue: SendCommaindIF[] = [];
    private commandQueueBusy = false;
    public sendCommand(command: string, suppressFailure = false, swallowStdout = false, forceNoDebug = false): Thenable<MINode> {
        // We queue these requests as there can be a flood of them. Especially if you have two variables or same name back to back
        // the second can fail because we are still in the process of creating that variable (update, fail, then create). Sources
        // for requests are from RTOS viewers, watch windows and hover. Even a watch window can have duplicates.
        return new Promise(async (resolve, reject) => {
            const args: SendCommaindIF = {
                command: command,
                suppressFailure: suppressFailure,
                swallowStdout: swallowStdout,
                forceNoDebug: forceNoDebug,
                resolve: resolve,
                reject: reject
            };
            this.commandQueue.push(args);
            while (!this.commandQueueBusy && (this.commandQueue.length > 0)) {
                this.commandQueueBusy = true;
                const obj = this.commandQueue.shift();
                try {
                    const result = await this.sendOneCommand(obj);
                    obj.resolve(result);
                }
                catch (e) {
                    obj.reject(e);
                }
                this.commandQueueBusy = false;
            }
        });
    }

}

interface SendCommaindIF {
    command: string;
    suppressFailure: boolean;
    swallowStdout: boolean;
    forceNoDebug: boolean;
    resolve: any;
    reject: any;
}
