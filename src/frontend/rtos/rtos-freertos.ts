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

const numType = RTOSCommon.ColTypeEnum.colTypeNumeric;
const FreeRTOSItems: { [key: string]: RTOSCommon.DisplayColumnItem } = {};
FreeRTOSItems[DisplayFields[DisplayFields.ID]] = { width: 1, headerRow1: '', headerRow2: 'ID', colType: numType };
FreeRTOSItems[DisplayFields[DisplayFields.Address]] = { width: 3, headerRow1: 'Thread', headerRow2: 'Address', colGapBefore: 1 };
FreeRTOSItems[DisplayFields[DisplayFields.TaskName]] = { width: 4, headerRow1: '', headerRow2: 'Task Name' };
FreeRTOSItems[DisplayFields[DisplayFields.Status]] = { width: 3, headerRow1: '', headerRow2: 'Status' };
FreeRTOSItems[DisplayFields[DisplayFields.Priority]] = { width: 1.5, headerRow1: 'Prio', headerRow2: 'rity', colType: numType };
FreeRTOSItems[DisplayFields[DisplayFields.StackStart]] = {
    width: 3, headerRow1: 'Stack', headerRow2: 'Start',
    colType: RTOSCommon.ColTypeEnum.colTypeLink, colGapBefore: 1
};
FreeRTOSItems[DisplayFields[DisplayFields.StackTop]] = { width: 3, headerRow1: 'Stack', headerRow2: 'Top' };
FreeRTOSItems[DisplayFields[DisplayFields.StackEnd]] = { width: 3, headerRow1: 'Stack', headerRow2: 'End' };
FreeRTOSItems[DisplayFields[DisplayFields.StackSize]] = { width: 2, headerRow1: 'Stack', headerRow2: 'Size', colType: numType };
FreeRTOSItems[DisplayFields[DisplayFields.StackUsed]] = { width: 2, headerRow1: 'Stack', headerRow2: 'Used', colType: numType };
FreeRTOSItems[DisplayFields[DisplayFields.StackFree]] = { width: 2, headerRow1: 'Stack', headerRow2: 'Free', colType: numType };
FreeRTOSItems[DisplayFields[DisplayFields.StackPeak]] = { width: 2, headerRow1: 'Stack', headerRow2: 'Peak', colType: numType };
FreeRTOSItems[DisplayFields[DisplayFields.Runtime]] = { width: 2, headerRow1: '', headerRow2: 'Runtime', colType: numType };
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
    private foundThreads: RTOSCommon.RTOSThreadInfo[] = [];
    private finalThreads: RTOSCommon.RTOSThreadInfo[] = [];
    private timeInfo: string;
    private readonly maxThreads = 1024;
    private helpHtml: string = undefined;

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
                this.uxCurrentNumberOfTasks = await this.getVarIfEmpty(this.uxCurrentNumberOfTasks, useFrameId, 'uxCurrentNumberOfTasks');
                this.pxReadyTasksLists = await this.getVarIfEmpty(this.pxReadyTasksLists, useFrameId, 'pxReadyTasksLists');
                this.xDelayedTaskList1 = await this.getVarIfEmpty(this.xDelayedTaskList1, useFrameId, 'xDelayedTaskList1');
                this.xDelayedTaskList2 = await this.getVarIfEmpty(this.xDelayedTaskList2, useFrameId, 'xDelayedTaskList2');
                this.xPendingReadyList = await this.getVarIfEmpty(this.xPendingReadyList, useFrameId, 'xPendingReadyList');
                this.pxCurrentTCB = await this.getVarIfEmpty(this.pxCurrentTCB, useFrameId, 'pxCurrentTCB');
                this.xSuspendedTaskList = await this.getVarIfEmpty(this.xSuspendedTaskList, useFrameId, 'xSuspendedTaskList', true);
                this.xTasksWaitingTermination = await this.getVarIfEmpty(this.xTasksWaitingTermination, useFrameId, 'xTasksWaitingTermination', true);
                this.ulTotalRunTime = await this.getVarIfEmpty(this.ulTotalRunTime, useFrameId, 'ulTotalRunTime', true);
                this.status = 'initialized';
            }
            return this;
        } catch (e) {
            if (e instanceof RTOSCommon.ShouldRetry) {
                console.error(e.message);
            } else {
                this.status = 'failed';
                this.failedWhy = e;
            }
            return this;
        }
    }

    protected createHmlHelp(th: RTOSCommon.RTOSThreadInfo, thInfo: object) {
        if (this.helpHtml === undefined) {
            this.helpHtml = '';
            try {
                let ret: string = '';
                function strong(s) {
                    return `<strong>${s}</strong>`;
                }
                if (!thInfo['uxTCBNumber-val']) {
                    ret += `Thread ID missing......: Enable macro ${strong('configUSE_TRACE_FACILITY')} in FW<br>`;
                }
                if (!th.stackInfo.stackEnd) {
                    ret += `Stack End missing......: Enable macro ${strong('configRECORD_STACK_HIGH_ADDRESS')} in FW<br>`;
                }
                if ((thInfo['pcTaskName-val'] === '[0]') || (thInfo['pcTaskName-val'] === '[1]')) {
                    ret += `Thread Name missing....: Set macro ${strong('configMAX_TASK_NAME_LEN')} to something greater than 1 in FW<br>`;
                }

                if (!this.ulTotalRunTime) {
                    ret += /* html */`<br>Missing Runtime stats..:<br>
                    /* To get runtime stats, modify the following macro in FreeRTOSConfig.h */<br>
                    #define ${strong('configGENERATE_RUN_TIME_STATS')}             1 /* 1: generate runtime statistics; 0: no runtime statistics */<br>
                    /* Also, add the following two macros to provide a high speed counter -- something at least 10x faster than<br>
                    ** your RTOS scheduler tick. One strategy could be to use a HW counter and sample its current value when needed<br>
                    */<br>
                    #define ${strong('portCONFIGURE_TIMER_FOR_RUN_TIME_STATS()')} /* Define this to initialize your timer */<br>
                    #define ${strong('portGET_RUN_TIME_COUNTER_VALUE()')}${'&nbsp'.repeat(9)}/* Define this to sample the counter */<br>
                    `;
                }
                if (ret) {
                    ret += '<br>Note: Make sure you consider the performance/resources impact for any changes to your FW.<br>\n';
                    ret = '<button class="help-button">Hints to get more out of the FreeRTOS viewer</button>\n'
                        + `<div class="help"><p>\n${ret}\n</p></div>\n`;
                    this.helpHtml = ret;
                }
            } catch (e) {
                console.log(e);
            }
        }
    }

    private updateCurrentThreadAddr(frameId: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.pxCurrentTCB.getValue(frameId).then((ret) => {
                this.curThreadAddr = parseInt(ret);
                resolve();
            }, (e) => {
                reject(e);
            });
        });
    }

    private updateTotalRuntime(frameId: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!this.ulTotalRunTime) {
                resolve();
                return;
            }
            this.ulTotalRunTime.getValue(frameId).then((ret) => {
                this.ulTotalRunTimeVal = parseInt(ret);
                resolve();
            }, (e) => {
                reject(e);
            });
        });
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
                        let promises = [];
                        const ary = await this.pxReadyTasksLists.getVarChildren(frameId);
                        for (const v of ary) {
                            promises.push(this.getThreadInfo(v.variablesReference, 'READY', frameId));
                        }
                        promises.push(this.updateCurrentThreadAddr(frameId));
                        promises.push(this.updateTotalRuntime(frameId));
                        // Update in bulk, but broken up into three chunks, if the number of threads are already fulfilled, then
                        // not much happens
                        await Promise.all(promises);
                        promises = [];
                        promises.push(this.getThreadInfo(this.xDelayedTaskList1, 'BLOCKED', frameId));
                        promises.push(this.getThreadInfo(this.xDelayedTaskList2, 'BLOCKED', frameId));
                        promises.push(this.getThreadInfo(this.xPendingReadyList, 'PENDING', frameId));
                        await Promise.all(promises);
                        promises = [];
                        promises.push(this.getThreadInfo(this.xSuspendedTaskList, 'SUSPENDED', frameId));
                        promises.push(this.getThreadInfo(this.xTasksWaitingTermination, 'TERMINATED', frameId));
                        await Promise.all(promises);
                        promises = [];
                        if (this.foundThreads.length > 0) {
                            const th = this.foundThreads[0];
                            if (th.display['ID'].text !== '??') {
                                this.foundThreads.sort((a, b) => parseInt(a.display['ID'].text) - parseInt(b.display['ID'].text));
                            } else {
                                this.foundThreads.sort((a, b) => parseInt(a.display['Address'].text) - parseInt(b.display['Address'].text));
                            }
                        }
                        this.finalThreads = [...this.foundThreads];
                        // console.table(this.finalThreads);
                    } else {
                        this.finalThreads = [];
                    }
                    this.stale = false;
                    this.timeInfo += ' in ' + timer.deltaMs() + ' ms';
                    resolve();
                } catch (e) {
                    resolve();
                    console.error('FreeRTOS.refresh() failed: ', e);
                }
            }, (reason) => {
                resolve();
                console.error('FreeRTOS.refresh() failed: ', reason);
            });
        });
    }

    private getThreadInfo(varRef: RTOSCommon.RTOSVarHelper | number, state: string, frameId: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!varRef || ((typeof varRef !== 'number') && !varRef.varReference) || (this.foundThreads.length >= this.uxCurrentNumberOfTasksVal)) {
                resolve();
                return;
            }
            if (this.progStatus !== 'stopped') {
                reject(new Error('Busy'));
                return;
            }
            let promise;
            if (typeof varRef !== 'number') {
                promise = varRef.getVarChildrenObj(frameId);
            } else {
                promise = this.getVarChildrenObj(varRef, 'task-list');
            }
            promise.then(async (obj) => {
                const threadCount = parseInt(obj['uxNumberOfItems-val']);
                const listEndRef = obj['xListEnd-ref'];
                if ((threadCount <= 0) || !listEndRef) {
                    resolve();
                    return;
                }
                try {
                    const listEndObj = await this.getVarChildrenObj(listEndRef, 'xListEnd');
                    let curRef = listEndObj['pxPrevious-ref'];
                    for (let thIx = 0; thIx < threadCount; thIx++) {
                        const element = await this.getVarChildrenObj(curRef, 'pxPrevious');
                        const threadId = parseInt(element['pvOwner-val']);
                        const thInfo = await this.getExprValChildrenObj(`((TCB_t*)${hexFormat(threadId)})`, frameId);
                        const threadRunning = (threadId === this.curThreadAddr);
                        const tmpThName = await this.getExprVal('(char *)' + thInfo['pcTaskName-exp'], frameId);
                        const match = tmpThName.match(/"([^*]*)"$/);
                        const thName = match ? match[1] : tmpThName;
                        const stackInfo = await this.getStackInfo(thInfo, 0xA5);
                        // This is the order we want stuff in
                        const display: { [key: string]: RTOSCommon.DisplayRowItem } = {};
                        const mySetter = (x: DisplayFields, text: string, value?: any) => {
                            display[DisplayFieldNames[x]] = { text, value };
                        };

                        mySetter(DisplayFields.ID, thInfo['uxTCBNumber-val'] || '??');
                        mySetter(DisplayFields.Address, hexFormat(threadId));
                        mySetter(DisplayFields.TaskName, thName);
                        mySetter(DisplayFields.Status, threadRunning ? 'RUNNING' : state);
                        mySetter(DisplayFields.StackStart, hexFormat(stackInfo.stackStart));
                        mySetter(DisplayFields.StackTop, hexFormat(stackInfo.stackTop));
                        mySetter(DisplayFields.StackEnd, stackInfo.stackEnd ? hexFormat(stackInfo.stackEnd) : '0x????????');

                        if (thInfo['uxBasePriority-val']) {
                            mySetter(DisplayFields.Priority, `${thInfo['uxPriority-val']},${thInfo['uxBasePriority-val']}`);
                        } else {
                            mySetter(DisplayFields.Priority, `${thInfo['uxPriority-val']}`);
                        }

                        const func = (x: any) => x === undefined ? '???' : x.toString();
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
                        const thread: RTOSCommon.RTOSThreadInfo = {
                            display: display, stackInfo: stackInfo, running: threadRunning
                        };
                        this.foundThreads.push(thread);
                        this.createHmlHelp(thread, thInfo);
                        curRef = element['pxPrevious-ref'];
                    }
                    resolve();
                } catch (e) {
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
            } catch (e) {
                console.log(e);
            }
        }
        return stackInfo;
    }

    public lastValidHtmlContent: RTOSCommon.HtmlInfo = { html: '', css: '' };
    public getHTML(): RTOSCommon.HtmlInfo {
        const htmlContent: RTOSCommon.HtmlInfo = {
            html: '', css: ''
        };
        // WARNING: This stuff is super fragile. Once we know how this works, then we should refactor this
        let msg = '';
        if (this.status === 'none') {
            htmlContent.html = '<p>RTOS not yet fully initialized. Will occur next time program pauses</p>\n';
            return htmlContent;
        } else if (this.stale) {
            const lastHtmlInfo = this.lastValidHtmlContent;
            if (this.uxCurrentNumberOfTasksVal === Number.MAX_SAFE_INTEGER) {
                msg = ' Could not read "uxCurrentNumberOfTasks". Perhaps program is busy or did not stop long enough';
                lastHtmlInfo.html = '';
                lastHtmlInfo.css = '';
            } else if (this.uxCurrentNumberOfTasksVal > this.maxThreads) {
                msg = ` FreeRTOS variable uxCurrentNumberOfTasks = ${this.uxCurrentNumberOfTasksVal} seems invalid`;
                lastHtmlInfo.html = '';
                lastHtmlInfo.css = '';
            } else if (lastHtmlInfo.html) { // TODO check if this check is ok
                msg = ' Following info from last query may be stale.';
            }

            htmlContent.html = `<p>Unable to collect full RTOS information.${msg}</p>\n` + lastHtmlInfo.html;
            htmlContent.css = lastHtmlInfo.css;
            return htmlContent;
        } else if ((this.uxCurrentNumberOfTasksVal !== Number.MAX_SAFE_INTEGER) && (this.finalThreads.length !== this.uxCurrentNumberOfTasksVal)) {
            msg += `<p>Expecting ${this.uxCurrentNumberOfTasksVal} threads, found ${this.finalThreads.length}. Thread data may be unreliable<p>\n`;
        } else if (this.finalThreads.length === 0) {
            htmlContent.html = `<p>No ${this.name} threads detected, perhaps RTOS not yet initialized or tasks yet to be created!</p>\n`;
            return htmlContent;
        }

        const ret = this.getHTMLCommon(DisplayFieldNames, FreeRTOSItems, this.finalThreads, this.timeInfo);
        htmlContent.html = msg + ret.html + (this.helpHtml || '');
        htmlContent.css = ret.css;

        this.lastValidHtmlContent = htmlContent;
        // console.log(this.lastValidHtmlContent.html);
        return this.lastValidHtmlContent;
    }
}
