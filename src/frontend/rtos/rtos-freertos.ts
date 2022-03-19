import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as RTOSCommon from './rtos-common';
import { hexFormat } from '../utils';

interface FreeRTOSThreadInfo {
    'Address': string;
    'Task Name': string;
    'Status': string;
    'Priority': string;
    'Stack Start': string;
    'Stack Top': string;
    'Stack Used': string;
    'Stack End'?: string;
    'Stack Size'?: string;
    'Stack Peak'?: string;
    'Stack Free'?: string;
    '%Runtime'?: string;
    stackInfo: RTOSCommon.RTOSStackInfo;
}

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
    private foundThreads: FreeRTOSThreadInfo[] = [];
    private finalThreads: FreeRTOSThreadInfo[] = [];
    private readonly maxThreads = 1024;

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

            this.stale = true;
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
                                tmpArray.push(await this.getVarIfEmpty(undefined, frameId, v.evaluateName));
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
                        this.foundThreads.sort((a, b) => a['Task Name'].toUpperCase().localeCompare(b['Task Name'].toUpperCase()));
                        this.finalThreads = [...this.foundThreads];
                        console.table(this.finalThreads);
                    } else {
                        this.finalThreads = [];
                    }
                    this.stale = false;
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
                        const th: FreeRTOSThreadInfo = {
                            'Address'       : hexFormat(threadId),
                            'Task Name'     : thName,
                            'Status'        : (threadId === this.curThreadAddr) ? 'RUNNING' : state,
                            'Priority'      : thInfo['uxPriority-val'],
                            'Stack Start'   : hexFormat(stackInfo.stackStart),
                            'Stack Top'     : hexFormat(stackInfo.stackTopCurrent),
                            'Stack Used'    : stackInfo.stackCurUsed.toString(),
                            'stackInfo'     : stackInfo
                        };
                        if (thInfo['uxBasePriority-val']) {
                            th['Priority'] += ` (${thInfo['uxBasePriority-val']})`;
                        }
                        if (stackInfo.stackSize) {
                            th['Stack End']  = hexFormat(stackInfo.stackEnd);
                            th['Stack Size'] = stackInfo.stackSize.toString();
                            th['Stack Peak'] = stackInfo.stackPeakUsed ? stackInfo.stackPeakUsed.toString() : 'Read mem fail';
                            th['Stack Free'] = stackInfo.stackFree.toString();
                        } else {
                            th['Stack End']  = '&lt;Unknown&gt;';
                        }
                        if (thInfo['ulRunTimeCounter-val'] && this.ulTotalRunTimeVal) {
                            const tmp = ((parseInt(thInfo['ulRunTimeCounter-val']) / this.ulTotalRunTimeVal) * 100).toFixed(2);
                            th['%Runtime'] = tmp.padStart(5, '0') + '%';
                        }
                        this.foundThreads.push(th);
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
            stackTopCurrent: parseInt(pxTopOfStack),
            stackCurUsed: 0
        };
        const stackUsedCur = stackInfo.stackStart - stackInfo.stackTopCurrent;
        stackInfo.stackCurUsed = Math.abs(stackUsedCur);

        if (pxEndOfStack) {
            stackInfo.stackEnd = parseInt(pxEndOfStack);
            stackInfo.stackSize = stackInfo.stackStart - stackInfo.stackEnd;
            const incr = stackInfo.stackSize < 0 ? 1 : -1;
            stackInfo.stackSize = Math.abs(stackInfo.stackSize);
            stackInfo.stackFree = stackInfo.stackSize - stackInfo.stackCurUsed;
            const memArg: DebugProtocol.ReadMemoryArguments = {
                memoryReference: (incr > 0) ? hexFormat(stackInfo.stackStart, 8) : hexFormat(stackInfo.stackEnd, 8),
                count: stackInfo.stackSize
            };
            try {
                const stackData: DebugProtocol.ReadMemoryResponse = await this.session.customRequest('readMemory', memArg);
                const buf = Buffer.from(stackData.body?.data, 'base64');
                stackInfo.bytes = new Uint8Array(buf);
                if (incr < 0) { stackInfo.bytes.reverse(); }
                let top = stackInfo.bytes.length;
                while (top > 0) {
                    if (stackInfo.bytes[top - 1] !== waterMark) {
                        break;
                    }
                    top--;
                }
                stackInfo.stackPeakUsed = top;
            }
            catch (e) {
                console.log(e);
            }
        } else {
            const incr = stackUsedCur < 0 ? 1 : -1;
            const memArg: DebugProtocol.ReadMemoryArguments = {
                memoryReference: (incr > 0) ? hexFormat(stackInfo.stackStart, 8) : hexFormat(stackInfo.stackTopCurrent, 8),
                count: stackInfo.stackCurUsed
            };
            const stackData: DebugProtocol.ReadMemoryResponse = await this.session.customRequest('readMemory', memArg);
        }
        return stackInfo;
    }

    public lastValidHtml: string = '';
    public getHTML(): string {
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
        
        let header = '';
        let table = '<vscode-data-grid>\n';
        let keys;
        for (const th of this.finalThreads) {
            keys = keys || Object.keys(th);
            if (!header) {
                let col = 1;
                header = '  <vscode-data-grid-row>\n';
                for (const key of keys) {
                    const v = th[key];
                    if (typeof v !== 'object') {
                        header += `    <vscode-data-grid-cell cell-type="columnheader" grid-column="${col}">${key}</vscode-data-grid-cell>\n`;
                        col++;
                    }
                }
                header += '  </vscode-data-grid-row>\n';
                table += header;
            }

            let col = 1;
            table += '  <vscode-data-grid-row>\n';
            for (const key of keys) {
                const v = th[key];
                if (typeof v !== 'object') {
                    table += `    <vscode-data-grid-cell grid-column="${col}">${v}</vscode-data-grid-cell>\n`;
                    col++;
                }
            }
            table += '  </vscode-data-grid-row>\n';
        }
        ret += table;
        ret += '</vscode-data-grid>\n';

        this.lastValidHtml = ret;
        return ret;
    }
}
