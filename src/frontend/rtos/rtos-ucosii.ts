import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as RTOSCommon from './rtos-common';
import { hexFormat } from '../utils';
import { HrTimer, toStringDecHexOctBin } from '../../common';

// We will have two rows of headers for FreeRTOS and the table below describes
// the columns headers for the two rows and the width of each column as a fraction
// of the overall space.
enum DisplayFields {
    ID,
    Address,
    TaskName,
    Status,
    Priority,
    StackStart,
    StackTop,
    StackEnd,
    StackSize,
    StackUsed,
    StackFree,
    StackPeak
}

const RTOSUCOS2Items: { [key: string]: RTOSCommon.DisplayItem } = {};
RTOSUCOS2Items[DisplayFields[DisplayFields.ID]] = { width: 1, headerRow1: '', headerRow2: 'ID' };
RTOSUCOS2Items[DisplayFields[DisplayFields.Address]] = { width: 3, headerRow1: 'Thread', headerRow2: 'Address' };
RTOSUCOS2Items[DisplayFields[DisplayFields.TaskName]] = { width: 4, headerRow1: '', headerRow2: 'Task Name' };
RTOSUCOS2Items[DisplayFields[DisplayFields.Status]] = { width: 3, headerRow1: '', headerRow2: 'Status' };
RTOSUCOS2Items[DisplayFields[DisplayFields.Priority]] = { width: 1.5, headerRow1: 'Prio', headerRow2: 'rity' };
RTOSUCOS2Items[DisplayFields[DisplayFields.StackStart]] = { width: 3, headerRow1: 'Stack', headerRow2: 'Start' };
RTOSUCOS2Items[DisplayFields[DisplayFields.StackTop]] = { width: 3, headerRow1: 'Stack', headerRow2: 'Top' };
RTOSUCOS2Items[DisplayFields[DisplayFields.StackEnd]] = { width: 3, headerRow1: 'Stack', headerRow2: 'End' };
RTOSUCOS2Items[DisplayFields[DisplayFields.StackSize]] = { width: 2, headerRow1: 'Stack', headerRow2: 'Size' };
RTOSUCOS2Items[DisplayFields[DisplayFields.StackUsed]] = { width: 2, headerRow1: 'Stack', headerRow2: 'Used' };
RTOSUCOS2Items[DisplayFields[DisplayFields.StackFree]] = { width: 2, headerRow1: 'Stack', headerRow2: 'Free' };
RTOSUCOS2Items[DisplayFields[DisplayFields.StackPeak]] = { width: 2, headerRow1: 'Stack', headerRow2: 'Peak' };
const DisplayFieldNames: string[] = Object.keys(RTOSUCOS2Items);

export class RTOSUCOS2 extends RTOSCommon.RTOSBase {
    // We keep a bunch of variable references (essentially pointers) that we can use to query for values
    // Since all of them are global variable, we only need to create them once per session. These are
    // similar to Watch/Hover variables
    private OSRunning: RTOSCommon.RTOSVarHelper;
    private OSRunningVal: number;

    private stackEntrySize: number = 0;

    private OSTaskCtr: RTOSCommon.RTOSVarHelper;
    private OSTaskCtrVal: number;

    private OSTCBList: RTOSCommon.RTOSVarHelper;

    private OSTCBCur: RTOSCommon.RTOSVarHelper;
    private OSTCBCurVal: number;

    private stale: boolean;
    private foundThreads: RTOSCommon.FreeRTOSThreadInfo[] = [];
    private finalThreads: RTOSCommon.FreeRTOSThreadInfo[] = [];
    private timeInfo: string;
    private readonly maxThreads = 1024;

    private stackPattern = 0x00;
    private stackIncrements = -1;

    constructor(public session: vscode.DebugSession) {
        super(session, 'uC/OS-II');

        if(session.configuration.rtosViewConfig) {
            if(session.configuration.rtosViewConfig.stackPattern) {
                this.stackPattern = parseInt(session.configuration.rtosViewConfig.stackPattern);
            }

            if(session.configuration.rtosViewConfig.stackGrowth) {
                this.stackIncrements = parseInt(session.configuration.rtosViewConfig.stackGrowth);
            }
        }
    }

    public async tryDetect(useFrameId: number): Promise<RTOSCommon.RTOSBase> {
        this.progStatus = 'stopped';
        try {
            if (this.status === 'none') {
                // We only get references to all the interesting variables. Note that any one of the following can fail
                // and the caller may try again until we know that it definitely passed or failed. Note that while we
                // re-try everything, we do remember what already had succeeded and don't waste time trying again. That
                // is how this.getVarIfEmpty() works
                this.OSRunning = await this.getVarIfEmpty(this.OSRunning, useFrameId, 'OSRunning', false);
                this.OSTaskCtr = await this.getVarIfEmpty(this.OSTaskCtr, useFrameId, 'OSTaskCtr', false);
                this.OSTCBList = await this.getVarIfEmpty(this.OSTCBList, useFrameId, 'OSTCBList', false);
                this.OSTCBCur = await this.getVarIfEmpty(this.OSTCBCur, useFrameId, 'OSTCBCur', false);
                this.status = 'initialized';
            }
            return this;
        }
        catch (e) {
            this.status = 'failed';
            this.failedWhy = e;
            return this;
        }
    }

    public refresh(frameId: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.progStatus !== 'stopped') {
                resolve();
                return;
            }

            const timer = new HrTimer();
            this.stale = true;
            this.timeInfo = (new Date()).toISOString();

            // OSRunning & OSTaskCtr can go invalid anytime. Like when a reset/restart happens
            this.OSTaskCtrVal = Number.MAX_SAFE_INTEGER;
            this.OSRunningVal = Number.MAX_SAFE_INTEGER;
            this.foundThreads = [];

            this.OSRunning.getValue(frameId).then(async (str) => {
                try {
                    this.OSRunningVal = str ? parseInt(str) : 0;

                    if (0 !== this.OSRunningVal) {
                        const count = await this.OSTaskCtr.getValue(frameId);
                        this.OSTaskCtrVal = count ? parseInt(count) : Number.MAX_SAFE_INTEGER;

                        if ((this.OSTaskCtrVal > 0) && (this.OSTaskCtrVal <= this.maxThreads)) {

                            if (this.stackEntrySize == 0) {
                                /* Only get stack entry size once per session */
                                const stackEntrySizeRef = await this.getExprVal('sizeof(OS_STK)', frameId);
                                this.stackEntrySize = parseInt(stackEntrySizeRef);
                            }

                            const tmpOSTCBCurVal = await this.OSTCBCur.getValue(frameId);
                            this.OSTCBCurVal = tmpOSTCBCurVal ? parseInt(tmpOSTCBCurVal) : Number.MAX_SAFE_INTEGER;

                            await this.getThreadInfo(this.OSTCBList, frameId);

                            if (this.foundThreads[0]['ID'] !== '???') {
                                this.foundThreads.sort((a, b) => parseInt(a.display['ID']) - parseInt(b.display['ID']));
                            }
                            else {
                                this.foundThreads.sort((a, b) => parseInt(a.display['Address']) - parseInt(b.display['Address']));
                            }
                            this.finalThreads = [...this.foundThreads];
                        }
                        else {
                            this.finalThreads = [];
                        }
                    }
                    else {
                        this.finalThreads = [];
                    }

                    this.stale = false;
                    this.timeInfo += ' in ' + timer.deltaMs() + ' ms';
                    resolve();
                }
                catch (e) {
                    resolve();
                    console.error('RTOSUCOS2.refresh() failed: ', e);
                }
            }, (reason) => {
                resolve();
                console.error('RTOSUCOS2.refresh() failed: ', reason);
            });
        });
    }

    private getThreadInfo(varRef: RTOSCommon.RTOSVarHelper, frameId: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!varRef || !varRef.varReference || (this.foundThreads.length >= this.OSTaskCtrVal)) {
                resolve();
                return;
            }

            if (this.progStatus !== 'stopped') {
                reject(new Error('Busy'));
                return;
            }

            varRef.getVarChildrenObj(frameId).then(async (obj) => {
                try {
                    let curTaskObj = obj;
                    let thAddress = parseInt(varRef.value);

                    let threadCount = 1;

                    do {
                        const threadId = curTaskObj["OSTCBId-val"];

                        let thName = '???'
                        if (curTaskObj['OSTCBTaskName-exp']) {
                            const tmpThName = await this.getExprVal('(char *)' + curTaskObj['OSTCBTaskName-exp'], frameId);
                            const matchName = tmpThName.match(/"([^*]*)"$/);
                            thName = matchName ? matchName[1] : tmpThName;
                        }

                        const thState = mapTaskState(curTaskObj["OSTCBStat-val"]);

                        const matchPrio = curTaskObj['OSTCBPrio-val'].match(/([\w]*.?\s+).?\'/)
                        const thPrio = matchPrio ? matchPrio[1].trim() : curTaskObj['OSTCBPrio-val']

                        const stackInfo = await this.getStackInfo(curTaskObj, this.stackPattern, frameId);

                        const display: { [key: string]: string } = {};

                        const mySetter = (x: DisplayFields, v: string) => {
                            display[DisplayFieldNames[x]] = v;
                        };

                        mySetter(DisplayFields.ID, threadId ? parseInt(threadId).toString() : '???');
                        mySetter(DisplayFields.Address, hexFormat(thAddress));
                        mySetter(DisplayFields.TaskName, thName);
                        mySetter(DisplayFields.Status, (thAddress === this.OSTCBCurVal) ? 'RUNNING' : thState);
                        mySetter(DisplayFields.Priority, parseInt(thPrio).toString());

                        mySetter(DisplayFields.StackStart, hexFormat(stackInfo.stackStart));
                        mySetter(DisplayFields.StackTop, hexFormat(stackInfo.stackTop));
                        mySetter(DisplayFields.StackEnd, stackInfo.stackEnd ? hexFormat(stackInfo.stackEnd) : '0x????????');

                        const func = (x) => x === undefined ? '???' : x.toString();
                        mySetter(DisplayFields.StackSize, func(stackInfo.stackSize));
                        mySetter(DisplayFields.StackUsed, func(stackInfo.stackUsed));
                        mySetter(DisplayFields.StackFree, func(stackInfo.stackFree));
                        mySetter(DisplayFields.StackPeak, func(stackInfo.stackPeak));

                        this.foundThreads.push({ display: display, stackInfo: stackInfo });

                        thAddress = parseInt(curTaskObj['OSTCBNext-val']);
                        if (0 != thAddress) {
                            const nextThreadObj = await this.getVarChildrenObj(curTaskObj['OSTCBNext-ref'], 'OSTCBNext');
                            curTaskObj = nextThreadObj;
                            threadCount++;
                        }

                        if (threadCount > this.OSTaskCtrVal) {
                            console.log('RTOSUCOS2.getThreadInfo() detected more threads in OSTCBCur linked list that OSTaskCtr states');
                            break;
                        }

                    } while (0 != thAddress);

                    resolve();
                }
                catch (e) {
                    console.log('RTOSUCOS2.getThreadInfo() error', e);
                }
            }, (e) => {
                reject(e);
            });
        });
    }

    protected async getStackInfo(thInfo: any, stackPattern: number, frameId: number) {
        const TopOfStack = thInfo['OSTCBStkPtr-val'];

        /* only available with OS_TASK_CREATE_EXT_EN (optional) */
        const EndOfStack = thInfo['OSTCBStkBottom-val'];
        const StackSize = thInfo['OSTCBStkSize-val'];

        let Stack = 0;
        if (EndOfStack && StackSize) {
            if (this.stackIncrements < 0) {
                Stack = parseInt(EndOfStack) + (parseInt(StackSize) * this.stackEntrySize);
            }
            else {
                Stack = parseInt(EndOfStack) - (parseInt(StackSize) * this.stackEntrySize);
            }
        }
        else {
            /* As stackStart is mandatory, we need to set it to some reasonable value */
            Stack = parseInt(TopOfStack);
        }

        const stackInfo: RTOSCommon.RTOSStackInfo = {
            stackStart: Stack,
            stackTop: parseInt(TopOfStack)
        };

        if (EndOfStack && StackSize) {
            stackInfo.stackEnd = parseInt(EndOfStack);
            stackInfo.stackSize = parseInt(StackSize) * this.stackEntrySize;

            /* without StackSize & EndOfStack (=> stackTop) delta doesn't make sense */
            const stackDelta = Math.abs(stackInfo.stackTop - stackInfo.stackStart);
            if (this.stackIncrements < 0) {
                stackInfo.stackFree = stackDelta;
                stackInfo.stackUsed = stackInfo.stackSize - stackDelta;
            }
            else {
                stackInfo.stackUsed = stackDelta;
                stackInfo.stackFree = stackInfo.stackSize - stackDelta;
            }

            /* check stack peak */
            const memArg: DebugProtocol.ReadMemoryArguments = {
                memoryReference: hexFormat(Math.min(stackInfo.stackStart, stackInfo.stackEnd)),
                count: stackInfo.stackSize
            };
            try {
                const stackData = await this.session.customRequest('readMemory', memArg);
                const buf = Buffer.from(stackData.data, 'base64');
                stackInfo.bytes = new Uint8Array(buf);
                let start = this.stackIncrements < 0 ? 0 : stackInfo.bytes.length - 1;
                const end = this.stackIncrements < 0 ? stackInfo.bytes.length : -1;
                let peak = 0;
                while (start !== end) {
                    if (stackInfo.bytes[start] !== stackPattern) {
                        break;
                    }
                    start -= this.stackIncrements;
                    peak++;
                }
                stackInfo.stackPeak = stackInfo.stackSize - peak;
            }
            catch (e) {
                console.log(e);
            }
        }

        return stackInfo;
    }

    public lastValidHtml: string = '';
    public getHTML(): string {
        // WARNING: This stuff is super fragile. Once we know what we works, them we should refactor this
        let ret = '';
        if (this.status === 'none') {
            return '<p>RTOS not yet fully initialized. Will occur next time program pauses</p>\n';
        }
        else if (this.stale) {
            let msg = '';
            let lastHtml = this.lastValidHtml;

            if (this.OSTaskCtrVal === Number.MAX_SAFE_INTEGER) {
                msg = 'Count not read "OSTaskCtr". Perhaps program is busy or did not stop long enough';
                lastHtml = '';
            }
            else if (this.OSTaskCtrVal > this.maxThreads) {
                msg = `uc/OS-II variable OSTaskCtr = ${this.OSTaskCtrVal} seems invalid`;
                lastHtml = '';
            }
            else if (lastHtml) {
                msg = ' Following info from last query may be stale.';
            }

            return `<p>Unable to collect full RTOS information. ${msg}</p>\n` + lastHtml;
        }
        else if ((this.OSTaskCtrVal !== Number.MAX_SAFE_INTEGER) && (this.finalThreads.length !== this.OSTaskCtrVal)) {
            ret += `<p>Expecting ${this.OSTaskCtrVal} threads, found ${this.finalThreads.length}. Thread data may be unreliable<p>\n`;
        }
        else if (this.finalThreads.length === 0) {
            return `<p>No ${this.name} threads detected, perhaps RTOS not yet initialized or tasks yet to be created!</p>\n`;
        }

        ret += this.getHTMLCommon(DisplayFieldNames, RTOSUCOS2Items, this.finalThreads, this.timeInfo);

        this.lastValidHtml = ret;
        return ret;
    }
}

function mapTaskState(state: number): string {

    let stateString = '';

    /* Ready to run */
    if (state == 0x00) {
        stateString = 'READY';
    }
    else if ((state & 0x08) == 0x08) {
        /* Task is suspended */
        stateString += 'SUSPENDED';
    }
    else {
        stateString += 'PEND: ';

        /* Pending on multiple events doesn't need to be checked */

        /* Pending on semaphore */
        if ((state & 0x01) == 0x01) {
            stateString += 'SEMAPHORE, ';
        }

        /* Pending on mailbox */
        if ((state & 0x02) == 0x02) {
            stateString += 'MAILBOX, ';
        }

        /* Pending on queue */
        if ((state & 0x04) == 0x04) {
            stateString += 'QUEUE, ';
        }

        /* Pending on mutual exclusion semaphore */
        if ((state & 0x10) == 0x10) {
            stateString += 'MUTEX, ';
        }

        /* Pending on event flag group */
        if ((state & 0x20) == 0x20) {
            stateString += 'FLAG_GROUP, ';
        }

        stateString = stateString.trim();
        stateString = stateString.replace(/,+$/, '');
    }

    if (stateString === '') {
        stateString = '???'
    }

    return stateString
}