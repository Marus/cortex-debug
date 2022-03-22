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
    StackPeak,
    Runtime
}

const FreeRTOSItems: {[key: string]: RTOSCommon.DisplayItem} = {};
FreeRTOSItems[DisplayFields[DisplayFields.ID]]         = {width: 1,   headerRow1: '',        headerRow2: 'ID'};
FreeRTOSItems[DisplayFields[DisplayFields.Address]]    = {width: 3,   headerRow1: 'Thread',  headerRow2: 'Address'};
FreeRTOSItems[DisplayFields[DisplayFields.TaskName]]   = {width: 4,   headerRow1: '',        headerRow2: 'Task Name'};
FreeRTOSItems[DisplayFields[DisplayFields.Status]]     = {width: 3,   headerRow1: '',        headerRow2: 'Status'};
FreeRTOSItems[DisplayFields[DisplayFields.Priority]]   = {width: 1.5, headerRow1: 'Prio',    headerRow2: 'rity'};
FreeRTOSItems[DisplayFields[DisplayFields.StackStart]] = {width: 3,   headerRow1: 'Stack',   headerRow2: 'Start'};
FreeRTOSItems[DisplayFields[DisplayFields.StackTop]]   = {width: 3,   headerRow1: 'Stack',   headerRow2: 'Top'};
FreeRTOSItems[DisplayFields[DisplayFields.StackEnd]]   = {width: 3,   headerRow1: 'Stack',   headerRow2: 'End'};
FreeRTOSItems[DisplayFields[DisplayFields.StackSize]]  = {width: 2,   headerRow1: 'Stack',   headerRow2: 'Size'};
FreeRTOSItems[DisplayFields[DisplayFields.StackUsed]]  = {width: 2,   headerRow1: 'Stack',   headerRow2: 'Used'};
FreeRTOSItems[DisplayFields[DisplayFields.StackFree]]  = {width: 2,   headerRow1: 'Stack',   headerRow2: 'Free'};
FreeRTOSItems[DisplayFields[DisplayFields.StackPeak]]  = {width: 2,   headerRow1: 'Stack',   headerRow2: 'Peak'};
FreeRTOSItems[DisplayFields[DisplayFields.Runtime]]    = {width: 2,   headerRow1: '',        headerRow2: 'Runtime'};
const DisplayFieldNames: string[] = Object.keys(FreeRTOSItems);

function isNullOrUndefined(x) {
    return (x === undefined) || (x === null);
}

export class RTOSFreeRTOS extends RTOSCommon.RTOSBase {
    // We keep a bunch of variable references (essentially pointers) that we can use to query for values
    // Since all of them are global variable, we only need to create them once per session. These are
    // similar to Watch/Hover variables
    private uxCurrentNumberOfTasks: RTOSCommon.RTOSVarHelper;
    private uxCurrentNumberOfTasksVal: number;
    private pxReadyTasksLists: RTOSCommon.RTOSVarHelper;
    private pxReadyTasksListsItems: RTOSCommon.RTOSVarHelper[];
    private xDelayedTaskList1: RTOSCommon.RTOSVarHelper;
    private xDelayedTaskList2: RTOSCommon.RTOSVarHelper;
    private xPendingReadyList: RTOSCommon.RTOSVarHelper;
    private pxCurrentTCB: RTOSCommon.RTOSVarHelper;
    private xSuspendedTaskList: RTOSCommon.RTOSVarHelper;
    private xTasksWaitingTermination: RTOSCommon.RTOSVarHelper;
    private ulTotalRunTime: RTOSCommon.RTOSVarHelper;
    private ulTotalRunTimeVal: number;

    private stale: boolean;
    private curThreadAddr: number;
    private foundThreads: RTOSCommon.FreeRTOSThreadInfo[] = [];
    private finalThreads: RTOSCommon.FreeRTOSThreadInfo[] = [];
    private timeInfo: string;
    private readonly maxThreads = 1024;

    // Need to do a TON of testing for stack growing the other direction
    private stackIncrements = -1;

    constructor(public session: vscode.DebugSession) {
        super(session, 'FreeRTOS');
    }

    public async tryDetect(useFrameId: number): Promise<RTOSCommon.RTOSBase> {
        this.progStatus = 'stopped';
        try {
            if (this.status === 'none') {
                // We only get references to all the interesting variables. Note that any one of the following can fail
                // and the caller may try again until we know that it definitely passed or failed. Note that while we
                // re-try everything, we do remember what already had succeeded and don't waste time trying again. That
                // is how this.getVarIfEmpty() works
                this.uxCurrentNumberOfTasks = await this.getVarIfEmpty(this.uxCurrentNumberOfTasks, useFrameId, 'uxCurrentNumberOfTasks', false);
                this.pxReadyTasksLists = await this.getVarIfEmpty(this.pxReadyTasksLists, useFrameId, 'pxReadyTasksLists', true);
                this.xDelayedTaskList1 = await this.getVarIfEmpty(this.xDelayedTaskList1, useFrameId, 'xDelayedTaskList1', true);
                this.xDelayedTaskList2 = await this.getVarIfEmpty(this.xDelayedTaskList2, useFrameId, 'xDelayedTaskList2', true);
                this.xPendingReadyList = await this.getVarIfEmpty(this.xPendingReadyList, useFrameId, 'xPendingReadyList', true);
                this.pxCurrentTCB = await this.getVarIfEmpty(this.pxCurrentTCB, useFrameId, 'pxCurrentTCB', false);
                this.xSuspendedTaskList = await this.getVarIfEmpty(this.xSuspendedTaskList, useFrameId, 'xSuspendedTaskList', true, true);
                this.xTasksWaitingTermination = await this.getVarIfEmpty(this.xTasksWaitingTermination, useFrameId, 'xTasksWaitingTermination', true, true);
                this.ulTotalRunTime = await this.getVarIfEmpty(this.ulTotalRunTime, useFrameId, 'ulTotalRunTime', false, true);
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
            // uxCurrentNumberOfTasks can go invalid anytime. Like when a reset/restart happens
            this.uxCurrentNumberOfTasksVal = Number.MAX_SAFE_INTEGER;
            this.foundThreads = [];
            this.uxCurrentNumberOfTasks.getValue(frameId).then(async (str) => {
                try {
                    this.uxCurrentNumberOfTasksVal = str ? parseInt(str) : Number.MAX_SAFE_INTEGER;
                    if ((this.uxCurrentNumberOfTasksVal > 0) && (this.uxCurrentNumberOfTasksVal <= this.maxThreads)) {
                        if (this.pxReadyTasksListsItems === undefined) {
                            const vars = await this.pxReadyTasksLists.getVarChildren(frameId);
                            const tmpArray = [];
                            for (const v of vars) {
                                tmpArray.push(await this.getVarIfEmpty(undefined, frameId, v.evaluateName, true));
                            }
                            this.pxReadyTasksListsItems = tmpArray;
                        }
                        if (this.ulTotalRunTime) {
                            const tmp = await this.ulTotalRunTime.getValue(frameId);
                            this.ulTotalRunTimeVal = parseInt(tmp);
                        }
                        const cur = await this.pxCurrentTCB.getValue(frameId);
                        this.curThreadAddr = parseInt(cur);
                        let ix = 0;
                        for (const item of this.pxReadyTasksListsItems) {
                            await this.getThreadInfo(item, 'READY', frameId);
                            ix++;
                        }
                        await this.getThreadInfo(this.xDelayedTaskList1, 'BLOCKED', frameId);
                        await this.getThreadInfo(this.xDelayedTaskList2, 'BLOCKED', frameId);
                        await this.getThreadInfo(this.xPendingReadyList, 'BLOCKED', frameId);
                        await this.getThreadInfo(this.xSuspendedTaskList, 'SUSPENDED', frameId);
                        await this.getThreadInfo(this.xTasksWaitingTermination, 'TERMINATED', frameId);
                        if (this.foundThreads[0]['ID'] !== '??') {
                            this.foundThreads.sort((a, b) => parseInt(a.display['ID']) - parseInt(b.display['ID']));
                        } else {
                            this.foundThreads.sort((a, b) => parseInt(a.display['Address']) - parseInt(b.display['Address']));
                        }
                        this.finalThreads = [...this.foundThreads];
                        // console.table(this.finalThreads);
                    } else {
                        this.finalThreads = [];
                    }
                    this.stale = false;
                    this.timeInfo += ' in ' + timer.deltaMs() + ' ms';
                    resolve();
                }
                catch (e) {
                    resolve();
                    console.error('FreeRTOS.refresh() failed: ', e);
                }
            }, (reason) => {
                resolve();
                console.error('FreeRTOS.refresh() failed: ', reason);
            });
        });
    }

    private getThreadInfo(varRef: RTOSCommon.RTOSVarHelper, state: string, frameId: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!varRef || !varRef.varReference || (this.foundThreads.length >= this.uxCurrentNumberOfTasksVal)) {
                resolve();
                return;
            }
            if (this.progStatus !== 'stopped') {
                reject(new Error('Busy'));
                return;
            }
            varRef.getVarChildrenObj(frameId).then(async (obj) => {
                const threadCount = parseInt(obj['uxNumberOfItems-val']);
                const listEndRef = obj['xListEnd-ref'];
                if ((threadCount <= 0) || !listEndRef) {
                    resolve();
                    return;
                }
                try {
                    const listEndObj = await this.getVarChildrenObj(listEndRef, 'xListEnd');
                    let curRef = listEndObj['pxPrevious-ref'];
                    for (let thIx = 0; thIx < threadCount; thIx++ ) {
                        const element = await this.getVarChildrenObj(curRef, 'pxPrevious');
                        const threadId = parseInt(element['pvOwner-val']);
                        const thInfo = await this.getExprValChildrenObj(`((TCB_t*)${hexFormat(threadId)})`, frameId);
                        const tmpThName = await this.getExprVal('(char *)' + thInfo['pcTaskName-exp'], frameId);
                        const match = tmpThName.match(/"([^*]*)"$/);
                        const thName = match ? match[1] : tmpThName;
                        const stackInfo = await this.getStackInfo(thInfo, 0xA5);
                        // This is the order we want stuff in
                        const display: {[key: string]: string} = {};
                        const mySetter = (x: DisplayFields, v: string) => {
                            display[DisplayFieldNames[x]] = v;
                        };
                        const myGetter = (x: DisplayFields) => display[DisplayFieldNames[x]];
                        mySetter(DisplayFields.ID, thInfo['uxTCBNumber-val'] || '??');
                        mySetter(DisplayFields.Address, hexFormat(threadId));
                        mySetter(DisplayFields.TaskName, thName);
                        mySetter(DisplayFields.Status, (threadId === this.curThreadAddr) ? 'RUNNING' : state);
                        mySetter(DisplayFields.StackStart, hexFormat(stackInfo.stackStart));
                        mySetter(DisplayFields.StackTop, hexFormat(stackInfo.stackTop));
                        mySetter(DisplayFields.StackEnd, stackInfo.stackEnd ? hexFormat(stackInfo.stackEnd) : '0x????????');

                        mySetter(DisplayFields.Priority, thInfo['uxPriority-val']);
                        if (thInfo['uxBasePriority-val']) {
                            mySetter(DisplayFields.Priority,  myGetter(DisplayFields.Priority) + `,${thInfo['uxBasePriority-val']}`);
                        }

                        const func = (x) => x === undefined ? '???' : x.toString();
                        mySetter(DisplayFields.StackSize, func(stackInfo.stackSize));
                        mySetter(DisplayFields.StackUsed, func(stackInfo.stackUsed));
                        mySetter(DisplayFields.StackFree, func(stackInfo.stackFree));
                        mySetter(DisplayFields.StackPeak, func(stackInfo.stackPeak));
                        if (thInfo['ulRunTimeCounter-val'] && this.ulTotalRunTimeVal) {
                            const tmp = ((parseInt(thInfo['ulRunTimeCounter-val']) / this.ulTotalRunTimeVal) * 100).toFixed(2);
                            mySetter(DisplayFields.Runtime, tmp.padStart(5, '0') + '%');
                        } else {
                            mySetter(DisplayFields.Runtime, '??.??%');
                        }
                        this.foundThreads.push({display: display, stackInfo: stackInfo});
                        curRef = element['pxPrevious-ref'];
                    }
                    resolve();
                }
                catch (e) {
                    console.log('FreeRTOS read thread info error', e);
                }
            }, (e) => {
                reject(e);
            });
        });
    }

    protected async getStackInfo(thInfo: any, waterMark: number) {
        const pxStack = thInfo['pxStack-val'];
        const pxTopOfStack = thInfo['pxTopOfStack-val'];
        const pxEndOfStack = thInfo['pxEndOfStack-val'];
        const stackInfo: RTOSCommon.RTOSStackInfo = {
            stackStart: parseInt(pxStack),
            stackTop: parseInt(pxTopOfStack)
        };
        const stackDelta = Math.abs(stackInfo.stackTop - stackInfo.stackStart);
        if (this.stackIncrements < 0) {
            stackInfo.stackFree = stackDelta;
        } else {
            stackInfo.stackUsed = stackDelta;
        }

        if (pxEndOfStack) {
            stackInfo.stackEnd = parseInt(pxEndOfStack);
            stackInfo.stackSize = Math.abs(stackInfo.stackStart - stackInfo.stackEnd);
            if (this.stackIncrements < 0) {
                stackInfo.stackUsed = stackInfo.stackSize - stackDelta;
            } else {
                stackInfo.stackFree = stackInfo.stackSize - stackDelta;
            }
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
                    if (stackInfo.bytes[start] !== waterMark) {
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
        } else if (this.stale) {
            let msg = '';
            let lastHtml = this.lastValidHtml;
            if (this.uxCurrentNumberOfTasksVal === Number.MAX_SAFE_INTEGER) {
                msg = 'Count not read "uxCurrentNumberOfTasks". Perhaps program is busy or did not stop long enough';
                lastHtml = '';
            } else if (this.uxCurrentNumberOfTasksVal > this.maxThreads) {
                msg = `FreeRTOS variable uxCurrentNumberOfTasks = ${this.uxCurrentNumberOfTasksVal} seems invalid`;
                lastHtml = '';
            } else if (lastHtml) {
                msg = ' Following info from last query may be stale.';
            }
            return `<p>Unable to collect full RTOS information. ${msg}</p>\n` + lastHtml;
        } else if ((this.uxCurrentNumberOfTasksVal !== Number.MAX_SAFE_INTEGER) && (this.finalThreads.length !== this.uxCurrentNumberOfTasksVal)) {
            ret += `<p>Expecting ${this.uxCurrentNumberOfTasksVal} threads, found ${this.finalThreads.length}. Thread data may be unreliable<p>\n`;
        } else if (this.finalThreads.length === 0) {
            return `<p>No ${this.name} threads detected, perhaps RTOS not yet initialized or tasks yet to be created!</p>\n`;
        }

        ret += this.getHTMLCommon(DisplayFieldNames, FreeRTOSItems, this.finalThreads, this.timeInfo);
        // console.log(ret);
        this.lastValidHtml = ret;
        return ret;
    }
}

function makeOneWord(s: string): string {
    return s.toLowerCase().replace(/\s+/g, '-');
}
