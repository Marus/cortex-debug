import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as RTOSCommon from './rtos-common';
import { hexFormat } from '../utils';
import { HrTimer, toStringDecHexOctBin } from '../../common';

// We will have two rows of headers for uC/OS-II and the table below describes
// the columns headers for the two rows and the width of each column as a fraction
// of the overall space.
enum DisplayFields {
    ID,
    Address,
    TaskName,
    Status,
    Priority,
    StackPercent,
    StackPeakPercent
}

const RTOSUCOS2Items: { [key: string]: RTOSCommon.DisplayColumnItem } = {};
RTOSUCOS2Items[DisplayFields[DisplayFields.ID]] = { width: 1, headerRow1: '', headerRow2: 'ID' };
RTOSUCOS2Items[DisplayFields[DisplayFields.Address]] = { width: 3, headerRow1: 'Thread', headerRow2: 'Address' };
RTOSUCOS2Items[DisplayFields[DisplayFields.TaskName]] = { width: 4, headerRow1: '', headerRow2: 'Task Name' };
RTOSUCOS2Items[DisplayFields[DisplayFields.Status]] = { width: 3, headerRow1: '', headerRow2: 'Status' };
RTOSUCOS2Items[DisplayFields[DisplayFields.Priority]] = { width: 1.5, headerRow1: 'Prio', headerRow2: 'rity' };
RTOSUCOS2Items[DisplayFields[DisplayFields.StackPercent]] = {
    width: 4, headerRow1: 'Stack Usage', headerRow2: '% (Used B / Size B)',
    colType: RTOSCommon.colTypeEnum.colTypePercentage
};
RTOSUCOS2Items[DisplayFields[DisplayFields.StackPeakPercent]] = {
    width: 4, headerRow1: 'Stack Peak Usage', headerRow2: '% (Peak B / Size B)',
    colType: RTOSCommon.colTypeEnum.colTypePercentage
};

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
    private foundThreads: RTOSCommon.RTOSThreadInfo[] = [];
    private finalThreads: RTOSCommon.RTOSThreadInfo[] = [];
    private timeInfo: string;
    private readonly maxThreads = 1024;

    private stackPattern = 0x00;
    private stackIncrements = -1; // negative numbers => OS_STK_GROWTH = OS_STK_GROWTH_HI_TO_LO (1)

    private helpHtml: string = undefined;

    constructor(public session: vscode.DebugSession) {
        super(session, 'uC/OS-II');

        if (session.configuration.rtosViewConfig) {
            if (session.configuration.rtosViewConfig.stackPattern) {
                this.stackPattern = parseInt(session.configuration.rtosViewConfig.stackPattern);
            }

            if (session.configuration.rtosViewConfig.stackGrowth) {
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

    protected createHmlHelp(th: RTOSCommon.RTOSThreadInfo, thInfo: object) {
        if (this.helpHtml === undefined) {
            this.helpHtml = '';
            try {
                let ret: string = '';
                function strong(s) {
                    return `<strong>${s}</strong>`;
                }

                if (!thInfo['OSTCBTaskName-val']) {
                    ret += `Thread name missing: Enable macro ${strong('OS_TASK_NAME_EN')} in FW<br>`;
                }
                if (!th.stackInfo.stackSize) {
                    ret += `Stack Size missing: Enable macro ${strong('OS_TASK_CREATE_EXT_EN')} and use ${strong('OSTaskCreateExt')} in FW<br>`;
                }

                if (ret) {
                    ret += '<br>Note: Make sure you consider the performance/resources impact for any changes to your FW.<br>\n';
                    ret = '<button class="help-button">Hints to get more out of the uC/OS-II viewer</button>\n' +
                        `<div class="help"><p>\n${ret}\n</p></div>\n`;
                    this.helpHtml = ret;
                }
            }
            catch (e) {
                console.log(e);
            }
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

                            const OSTCBListVal = await this.OSTCBList.getValue(frameId);
                            if (OSTCBListVal && (0 !== parseInt(OSTCBListVal))) {

                                if (this.stackEntrySize === 0) {
                                    /* Only get stack entry size once per session */
                                    const stackEntrySizeRef = await this.getExprVal('sizeof(OS_STK)', frameId);
                                    this.stackEntrySize = parseInt(stackEntrySizeRef);
                                }

                                const tmpOSTCBCurVal = await this.OSTCBCur.getValue(frameId);
                                this.OSTCBCurVal = tmpOSTCBCurVal ? parseInt(tmpOSTCBCurVal) : Number.MAX_SAFE_INTEGER;

                                await this.getThreadInfo(this.OSTCBList, frameId);

                                if (this.foundThreads[0]['ID'] !== '???') {
                                    this.foundThreads.sort((a, b) => parseInt(a.display['ID'].text) - parseInt(b.display['ID'].text));
                                }
                                else {
                                    this.foundThreads.sort((a, b) => parseInt(a.display['Address'].text) - parseInt(b.display['Address'].text));
                                }
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
                        const threadId = curTaskObj['OSTCBId-val'];

                        let thName = '???';
                        if (curTaskObj['OSTCBTaskName-exp']) {
                            const tmpThName = await this.getExprVal('(char *)' + curTaskObj['OSTCBTaskName-exp'], frameId);
                            const matchName = tmpThName.match(/"([^*]*)"$/);
                            thName = matchName ? matchName[1] : tmpThName;
                        }

                        const thState = mapTaskState(parseInt(curTaskObj['OSTCBStat-val']));
                        const threadRunning = (thAddress === this.OSTCBCurVal);

                        const matchPrio = curTaskObj['OSTCBPrio-val'].match(/([\w]*.?\s+).?\'/);
                        const thPrio = matchPrio ? matchPrio[1].trim() : curTaskObj['OSTCBPrio-val'];

                        const stackInfo = await this.getStackInfo(curTaskObj, this.stackPattern, frameId);

                        const display: { [key: string]: RTOSCommon.DisplayRowItem } = {};
                        const mySetter = (x: DisplayFields, text: string, value?: any) => {
                            display[DisplayFieldNames[x]] = { text, value };
                        };

                        mySetter(DisplayFields.ID, (threadId ? parseInt(threadId).toString() : '???'));
                        mySetter(DisplayFields.Address, hexFormat(thAddress));
                        mySetter(DisplayFields.TaskName, thName);
                        mySetter(DisplayFields.Status, threadRunning ? 'RUNNING' : thState);
                        mySetter(DisplayFields.Priority, parseInt(thPrio).toString());

                        if ((stackInfo.stackUsed !== undefined) && (stackInfo.stackSize !== undefined)) {
                            const stackPercentVal = Math.round((stackInfo.stackUsed / stackInfo.stackSize) * 100);
                            const stackPercentText = `${stackPercentVal} % (${stackInfo.stackUsed} / ${stackInfo.stackSize})`;
                            mySetter(DisplayFields.StackPercent, stackPercentText, stackPercentVal);
                        }
                        else {
                            mySetter(DisplayFields.StackPercent, '??? %');
                        }

                        if ((stackInfo.stackPeak !== undefined) && (stackInfo.stackSize !== undefined)) {
                            const stackPeakPercentVal = Math.round((stackInfo.stackPeak / stackInfo.stackSize) * 100);
                            const stackPeakPercentText = `${stackPeakPercentVal} % (${stackInfo.stackPeak} / ${stackInfo.stackSize})`;
                            mySetter(DisplayFields.StackPeakPercent, stackPeakPercentText, stackPeakPercentVal);
                        }
                        else {
                            mySetter(DisplayFields.StackPeakPercent, '??? %');
                        }

                        const thread: RTOSCommon.RTOSThreadInfo = {
                            display: display, stackInfo: stackInfo, running: threadRunning
                        };
                        this.foundThreads.push(thread);
                        this.createHmlHelp(thread, curTaskObj);

                        thAddress = parseInt(curTaskObj['OSTCBNext-val']);
                        if (0 !== thAddress) {
                            const nextThreadObj = await this.getVarChildrenObj(curTaskObj['OSTCBNext-ref'], 'OSTCBNext');
                            curTaskObj = nextThreadObj;
                            threadCount++;
                        }

                        if (threadCount > this.OSTaskCtrVal) {
                            console.log('RTOSUCOS2.getThreadInfo() detected more threads in OSTCBCur linked list that OSTaskCtr states');
                            break;
                        }

                    } while (0 !== thAddress);

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

            if (this.stackIncrements < 0) {
                const stackDelta = stackInfo.stackStart - stackInfo.stackTop;
                stackInfo.stackFree = stackInfo.stackSize - stackDelta;
                stackInfo.stackUsed = stackDelta;
            }
            else {
                const stackDelta = stackInfo.stackTop - stackInfo.stackStart;
                stackInfo.stackFree = stackDelta;
                stackInfo.stackUsed = stackInfo.stackSize - stackDelta;
            }

            /* check stack peak */ // TODO Maybe optimize this by only reading between stackTop and stackEnd ans size stackFree
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
    public lastValidCSS: string = '';
    public getHTML(): [string, string] {
        // WARNING: This stuff is super fragile. Once we know how this works, then we should refactor this
        let msg = '';
        if (this.status === 'none') {
            return ['<p>RTOS not yet fully initialized. Will occur next time program pauses</p>\n', ''];
        }
        else if (this.stale) {
            let lastHtml = this.lastValidHtml;
            let lastCSS = this.lastValidCSS;

            if (this.OSTaskCtrVal === Number.MAX_SAFE_INTEGER) {
                msg = 'Count not read "OSTaskCtr". Perhaps program is busy or did not stop long enough';
                lastHtml = '';
                lastCSS = '';
            }
            else if (this.OSTaskCtrVal > this.maxThreads) {
                msg = `uC/OS-II variable OSTaskCtr = ${this.OSTaskCtrVal} seems invalid`;
                lastHtml = '';
                lastCSS = '';
            }
            else if (lastHtml) {
                msg = ' Following info from last query may be stale.';
            }

            return [(`<p>Unable to collect full RTOS information. ${msg}</p>\n` + lastHtml), lastCSS];
        }
        else if ((this.OSTaskCtrVal !== Number.MAX_SAFE_INTEGER) && (this.finalThreads.length !== this.OSTaskCtrVal)) {
            msg += `<p>Expecting ${this.OSTaskCtrVal} threads, found ${this.finalThreads.length}. Thread data may be unreliable<p>\n`;
        }
        else if (this.finalThreads.length === 0) {
            return [(`<p>No ${this.name} threads detected, perhaps RTOS not yet initialized or tasks yet to be created!</p>\n`), ''];
        }

        const ret = this.getHTMLCommon(DisplayFieldNames, RTOSUCOS2Items, this.finalThreads, this.timeInfo);
        this.lastValidHtml = msg + ret[0] + (this.helpHtml || '');
        this.lastValidCSS = ret[1];
        return [this.lastValidHtml, this.lastValidCSS];
    }
}

function mapTaskState(state: number): string {

    let stateString = '';

    /* Ready to run */
    if (state === 0x00) {
        stateString = 'READY';
    }
    else if ((state & 0x08) === 0x08) {
        /* Task is suspended */
        stateString += 'SUSPENDED';
    }
    else {
        stateString += 'PEND: ';

        /* Pending on multiple events doesn't need to be checked */

        /* Pending on semaphore */
        if ((state & 0x01) === 0x01) {
            stateString += 'SEMAPHORE, ';
        }

        /* Pending on mailbox */
        if ((state & 0x02) === 0x02) {
            stateString += 'MAILBOX, ';
        }

        /* Pending on queue */
        if ((state & 0x04) === 0x04) {
            stateString += 'QUEUE, ';
        }

        /* Pending on mutual exclusion semaphore */
        if ((state & 0x10) === 0x10) {
            stateString += 'MUTEX, ';
        }

        /* Pending on event flag group */
        if ((state & 0x20) === 0x20) {
            stateString += 'FLAG_GROUP, ';
        }

        stateString = stateString.trim();
        stateString = stateString.replace(/,+$/, '');
    }

    if (stateString === '') {
        stateString = '???';
    }

    return stateString;
}
