import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as RTOSCommon from './rtos-common';
import { hexFormat } from '../utils';
import { HrTimer } from '../../common';

// We will have two rows of headers for embOS and the table below describes
// the columns headers for the two rows and the width of each column as a fraction
// of the overall space.
enum DisplayFields {
    ID_Address,
    TaskName,
    Status,
    Priority,
    StackPercent,
    StackPeakPercent
}

const RTOSEMBOSItems: { [key: string]: RTOSCommon.DisplayColumnItem } = {};
RTOSEMBOSItems[DisplayFields[DisplayFields.ID_Address]] = { width: 2, headerRow1: '', headerRow2: 'ID / Address' };
RTOSEMBOSItems[DisplayFields[DisplayFields.TaskName]] = { width: 4, headerRow1: '', headerRow2: 'Name', colGapBefore: 1 };
RTOSEMBOSItems[DisplayFields[DisplayFields.Status]] = {
    width: 4, headerRow1: 'Thread', headerRow2: 'Status', colType: RTOSCommon.ColTypeEnum.colTypeCollapse
};
RTOSEMBOSItems[DisplayFields[DisplayFields.Priority]] = {
    width: 2, headerRow1: 'Priority', headerRow2: 'cur,base', colType: RTOSCommon.ColTypeEnum.colTypeNumeric, colGapAfter: 1
};
RTOSEMBOSItems[DisplayFields[DisplayFields.StackPercent]] = {
    width: 4, headerRow1: 'Stack Usage', headerRow2: '% (Used B / Size B)', colType: RTOSCommon.ColTypeEnum.colTypePercentage
};
RTOSEMBOSItems[DisplayFields[DisplayFields.StackPeakPercent]] = {
    width: 4, headerRow1: 'Stack Peak Usage', headerRow2: '% (Peak B / Size B)', colType: RTOSCommon.ColTypeEnum.colTypePercentage
};

const DisplayFieldNames: string[] = Object.keys(RTOSEMBOSItems);

export class RTOSEmbOS extends RTOSCommon.RTOSBase {
    // We keep a bunch of variable references (essentially pointers) that we can use to query for values
    // Since all of them are global variable, we only need to create them once per session. These are
    // similar to Watch/Hover variables
    private OSGlobal: RTOSCommon.RTOSVarHelper;
    private OSGlobalVal: any;

    private OSGlobalpTask: RTOSCommon.RTOSVarHelper; /* start of task linked list */
    private OSGlobalpObjNameRoot: RTOSCommon.RTOSVarHelper; /* start of object name linked list */

    private pCurrentTaskVal: number;

    private taskCount: number;

    private stale: boolean;
    private foundThreads: RTOSCommon.RTOSThreadInfo[] = [];
    private finalThreads: RTOSCommon.RTOSThreadInfo[] = [];
    private timeInfo: string;
    private readonly maxThreads = 1024;

    private stackPattern = 0x00;
    private stackIncrements = -1; /* negative numbers => high to low address growth on stack (OS_STACK_GROWS_TOWARD_HIGHER_ADDR = 0) */

    private helpHtml: string = undefined;

    constructor(public session: vscode.DebugSession) {
        super(session, 'embOS');

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
                this.OSGlobal = await this.getVarIfEmpty(this.OSGlobal, useFrameId, 'OS_Global', false);
                this.OSGlobalpTask = await this.getVarIfEmpty(this.OSGlobalpTask, useFrameId, 'OS_Global.pTask', false);
                this.OSGlobalpObjNameRoot = await this.getVarIfEmpty(this.OSGlobalpObjNameRoot, useFrameId, 'OS_Global.pObjNameRoot', false);

                this.status = 'initialized';
            }
            return this;
        }
        catch (e) {
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
                function strong(text: string) {
                    return `<strong>${text}</strong>`;
                }

                // FIXME rework once clear what is missing => done initial changes but needs improvements
                if (!thInfo['sName-val']) {
                    ret += `Thread name missing: Use embOS in a library mode / configuration where task names are supported and use ${strong('sName')}
                    parameter on task creation in FW<br><br>`;
                }
                if (!th.stackInfo.stackSize) {
                    ret += `Stack Size & Peak missing: Enable macro ${strong('OS_SUPPORT_STAT')} or use library mode that enables it<br><br>`;
                }

                if (ret) {
                    ret += 'Note: Make sure you consider the performance/resources impact for any changes to your FW.<br>\n';
                    this.helpHtml = '<button class="help-button">Hints to get more out of the embOS RTOS View</button>\n' +
                        `<div class="help"><p>\n${ret}\n</p></div>\n`;
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

            this.taskCount = Number.MAX_SAFE_INTEGER;
            this.foundThreads = [];

            this.OSGlobal.getVarChildrenObj(frameId).then(async (varObj) => {
                try {
                    this.OSGlobalVal = varObj;

                    // TODO Maybe check for IsRunning here too

                    const taskList = this.OSGlobalVal['pTask-val'];

                    // TODO check if we have this here already, maybe also add a check for NaN result!!!
                    if (undefined !== taskList && (0 !== parseInt(taskList))) {

                        this.pCurrentTaskVal = this.OSGlobalVal['pCurrentTask-val'] ? parseInt(this.OSGlobalVal['pCurrentTask-val']) : Number.MAX_SAFE_INTEGER;

                        const objectNameEntries = await this.getObjectNameEntries(frameId);

                        await this.getThreadInfo(this.OSGlobalpTask, objectNameEntries, frameId);

                        this.foundThreads.sort((a, b) => parseInt(a.display[DisplayFieldNames[DisplayFields.ID_Address]].text)
                            - parseInt(b.display[DisplayFieldNames[DisplayFields.ID_Address]].text));

                        this.finalThreads = [...this.foundThreads];
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
                    console.error('RTOSEMBOS.refresh() failed: ', e);
                }
            }, (reason) => {
                resolve();
                console.error('RTOSEMBOS.refresh() failed: ', reason);
            });
        });
    }

    private getThreadInfo(taskListEntry: RTOSCommon.RTOSVarHelper, objectNameEntries: Map<number, string>, frameId: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!taskListEntry || !taskListEntry.varReference) {
                resolve();
                return;
            }

            if (this.progStatus !== 'stopped') {
                reject(new Error('Busy'));
                return;
            }

            taskListEntry.getVarChildrenObj(frameId).then(async (obj) => {
                try {
                    let curTaskObj = obj;
                    let thAddress = parseInt(taskListEntry.value);

                    let threadCount = 1;

                    do {
                        let thName = '???';
                        if (curTaskObj['sName-val']) {
                            const matchName = curTaskObj['sName-val'].match(/"([^*]*)"$/);
                            thName = matchName ? matchName[1] : curTaskObj['sName-val'];
                        }

                        const threadRunning = (thAddress === this.pCurrentTaskVal);
                        const thStateObject = await this.analyzeTaskState(curTaskObj, objectNameEntries);
                        const stackInfo = await this.getStackInfo(curTaskObj, this.stackPattern);

                        const display: { [key: string]: RTOSCommon.DisplayRowItem } = {};
                        const mySetter = (x: DisplayFields, text: string, value?: any) => {
                            display[DisplayFieldNames[x]] = { text, value };
                        };

                        mySetter(DisplayFields.ID_Address, hexFormat(thAddress));
                        mySetter(DisplayFields.TaskName, thName);
                        mySetter(DisplayFields.Status, threadRunning ? 'RUNNING' : thStateObject.describe(), thStateObject.fullData());

                        const myHexNumStrCon = (hexNumberString: string): string => {
                            return parseInt(hexNumberString).toString();
                        };

                        const prioString = `${myHexNumStrCon(curTaskObj['Priority-val'])},${myHexNumStrCon(curTaskObj['BasePrio-val'])}`;
                        mySetter(DisplayFields.Priority, prioString);

                        if ((stackInfo.stackUsed !== undefined) && (stackInfo.stackSize !== undefined)) {
                            const stackPercentVal = Math.round((stackInfo.stackUsed / stackInfo.stackSize) * 100);
                            const stackPercentText = `${stackPercentVal} % (${stackInfo.stackUsed} / ${stackInfo.stackSize})`;
                            mySetter(DisplayFields.StackPercent, stackPercentText, stackPercentVal);
                        }
                        else {
                            mySetter(DisplayFields.StackPercent, '?? %');
                        }

                        if ((stackInfo.stackPeak !== undefined) && (stackInfo.stackSize !== undefined)) {
                            const stackPeakPercentVal = Math.round((stackInfo.stackPeak / stackInfo.stackSize) * 100);
                            const stackPeakPercentText = `${stackPeakPercentVal.toString().padStart(3)} % (${stackInfo.stackPeak} / ${stackInfo.stackSize})`;
                            mySetter(DisplayFields.StackPeakPercent, stackPeakPercentText, stackPeakPercentVal);
                        }
                        else {
                            mySetter(DisplayFields.StackPeakPercent, '?? %');
                        }

                        const thread: RTOSCommon.RTOSThreadInfo = {
                            display: display, stackInfo: stackInfo, running: threadRunning
                        };
                        this.foundThreads.push(thread);
                        this.createHmlHelp(thread, curTaskObj);

                        thAddress = parseInt(curTaskObj['pNext-val']);
                        if (0 !== thAddress) {
                            const nextThreadObj = await this.getVarChildrenObj(curTaskObj['pNext-ref'], 'pNext');
                            curTaskObj = nextThreadObj;
                            threadCount++;
                        }

                        if (threadCount > this.maxThreads) {
                            console.error(`Exceeded maximum number of allowed threads (${this.maxThreads})`);
                            break;
                        }

                    } while ((0 !== thAddress));

                    this.taskCount = threadCount;

                    resolve();
                }
                catch (e) {
                    console.log('RTOSEMBOS.getThreadInfo() error', e);
                }
            }, (e) => {
                reject(e);
            });
        });
    }

    protected async analyzeTaskState(curTaskObj: object, objectNameEntries: Map<number, string>): Promise<TaskState> {
        const state = parseInt(curTaskObj['Stat-val']);

        const suspendCount = (state & OS_TASK_STATE_SUSPEND_MASK);
        if (suspendCount !== 0) {
            return new TaskSuspended(suspendCount);
        }

        let pendTimeout = Number.MAX_SAFE_INTEGER;
        let TimeoutActive = false;

        if (state & OS_TASK_STATE_TIMEOUT_ACTIVE) {
            pendTimeout = parseInt(curTaskObj['Timeout-val']);
            TimeoutActive = true;
        }

        const maskedState = (state & OS_TASK_STATE_MASK);

        switch (maskedState) {
            case OsTaskPendingState.READY:
                if (pendTimeout) {
                    return new TaskDelayed(pendTimeout);
                }
                else {
                    return new TaskReady();
                }

            case OsTaskPendingState.TASK_EVENT:
                const resultState = new TaskPending();
                resultState.addEventType(maskedState);

                if (curTaskObj['EventMask-val']) {
                    const eventMask = parseInt(curTaskObj['EventMask-val']); // Waiting bits
                    const event = parseInt(curTaskObj['Events-val']); // Set bits
                    const eventInfo: EventInfo = { address: eventMask, eventType: state, name: `mask ${eventMask} - set ${event}` };

                    if (TimeoutActive) {
                        eventInfo.timeOut = pendTimeout;
                    }

                    resultState.addEvent(eventInfo);
                }

                return resultState;

            default: {
                const resultState = new TaskPending();
                resultState.addEventType(maskedState);

                if (curTaskObj['pWaitList-val']) {
                    const waitListEntryAddress = parseInt(curTaskObj['pWaitList-val']);

                    if (waitListEntryAddress !== 0) {
                        const waitListEntry = await this.getVarChildrenObj(curTaskObj['pWaitList-ref'], 'pWaitList');
                        const waitObject = parseInt(waitListEntry['pWaitObj-val']);
                        const eventInfo: EventInfo = { address: waitObject, eventType: state };

                        if (objectNameEntries.has(waitObject)) {
                            eventInfo.name = objectNameEntries.get(waitObject);
                        }

                        if (TimeoutActive) {
                            eventInfo.timeOut = pendTimeout;
                        }

                        resultState.addEvent(eventInfo);
                    }
                }

                return resultState;
            }
        }
    }

    protected async getStackInfo(thInfo: object, stackPattern: number): Promise<RTOSCommon.RTOSStackInfo> {
        const TopOfStack = thInfo['pStack-val'];

        /* only available with #if (OS_SUPPORT_STACKCHECK != 0) || (OS_SUPPORT_MPU != 0) (optional) */
        const EndOfStack = thInfo['pStackBase-val'];
        const StackSize = thInfo['StackSize-val'];

        let Stack = 0;
        if (EndOfStack && StackSize) {
            if (this.stackIncrements < 0) {
                Stack = parseInt(EndOfStack) + parseInt(StackSize);
            }
            else {
                Stack = parseInt(EndOfStack) - parseInt(StackSize);
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
            stackInfo.stackSize = parseInt(StackSize);

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

            /* check stack peak */
            const memArg: DebugProtocol.ReadMemoryArguments = {
                memoryReference: hexFormat(Math.min(stackInfo.stackTop, stackInfo.stackEnd)),
                count: stackInfo.stackFree
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

    protected async getObjectNameEntries(frameId: number): Promise<Map<number, string>> {
        const result: Map<number, string> = new Map();

        await this.OSGlobalpObjNameRoot.getValue(frameId);

        /* Follow the linked list of object identifier nodes */
        if (0 !== parseInt(this.OSGlobalpObjNameRoot.value)) {
            let entry = await this.OSGlobalpObjNameRoot.getVarChildrenObj(frameId);
            while (entry) {
                const objectId = parseInt(entry['pOSObjID-val']);
                if (!objectId || objectId === 0) {
                    break;
                }

                const matchName = entry['sName-val'].match(/"([^*]*)"$/);
                const objectName = matchName ? matchName[1] : entry['sName-val'];

                if (objectName && !result.has(objectId)) {
                    result.set(objectId, objectName);
                }

                const nextEntryAddr = parseInt(entry['pNext-val']);
                if (nextEntryAddr === 0) {
                    break;
                } else {
                    entry = await this.getVarChildrenObj(entry['pNext-ref'], 'pNext');
                }
            }
        }

        return result;
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
            if (this.taskCount === Number.MAX_SAFE_INTEGER) {
                msg = ' Could not read any task from "OS_Global.pTask". Perhaps program is busy or did not stop long enough';
                lastHtmlInfo.html = '';
                lastHtmlInfo.css = '';
            } else if (this.taskCount > this.maxThreads) {
                msg = ` embOS variable "OS_Global.pTask" holds ${this.taskCount} tasks which seems invalid for us`;
                lastHtmlInfo.html = '';
                lastHtmlInfo.css = '';
            } else if (lastHtmlInfo.html) { // TODO check if this check is ok
                msg = ' Following info from last query may be stale.';
            }

            htmlContent.html = `<p>Unable to collect full RTOS information.${msg}</p>\n` + lastHtmlInfo.html;
            htmlContent.css = lastHtmlInfo.css;
            return htmlContent;
        } else if ((this.taskCount !== Number.MAX_SAFE_INTEGER) && (this.finalThreads.length !== this.taskCount)) {
            msg += `<p>Expecting ${this.taskCount} threads, found ${this.finalThreads.length}. Thread data may be unreliable<p>\n`;
        } else if (this.finalThreads.length === 0) {
            htmlContent.html = `<p>No ${this.name} threads detected, perhaps RTOS not yet initialized or tasks yet to be created!</p>\n`;
            return htmlContent;
        }

        const ret = this.getHTMLCommon(DisplayFieldNames, RTOSEMBOSItems, this.finalThreads, this.timeInfo);
        htmlContent.html = msg + ret.html + (this.helpHtml || '');
        htmlContent.css = ret.css;

        this.lastValidHtmlContent = htmlContent; // TODO Shouldn't the html part without the msg?
        // console.log(this.lastValidHtmlContent.html);
        return this.lastValidHtmlContent;
    }
}

const OS_TASK_STATE_SUSPEND_MASK = 0x03; /* Task suspend count (bit 0 - 1) */
const OS_TASK_STATE_TIMEOUT_ACTIVE = 0x04; /* Task timeout active (bit 2) */
const OS_TASK_STATE_MASK = 0xF8; /* Task state mask (bit 3 - bit 7) */

enum OsTaskPendingState {
    READY = 0x00,
    TASK_EVENT = 0x08, /* flag group "assigned" to one task */
    MUTEX = 0x10,
    UNKNOWN = 0x18, // TODO check when this is set
    SEMAPHORE = 0x20,
    MEMPOOL = 0x28,
    QUEUE_NOT_EMPTY = 0x30,
    MAILBOX_NOT_FULL = 0x38,
    MAILBOX_NOT_EMPTY = 0x40,
    EVENT_OBJECT = 0x48, /* flag group without task "assignment" */
    QUEUE_NOT_FULL = 0x50
}

abstract class TaskState {
    public abstract describe(): string;
    public abstract fullData(): any;
}

class TaskReady extends TaskState {
    public describe(): string {
        return 'READY';
    }

    public fullData(): any {
        return null;
    }
}

class TaskDelayed extends TaskState {
    protected delayTicks: number;

    constructor(delayTicks: number) {
        super();
        this.delayTicks = delayTicks;
    }

    public describe(): string {
        return `DELAYED by ${this.delayTicks}`; // TODO Not sure what unit this variable holds
    }

    public fullData(): any {
        return null;
    }
}

class TaskSuspended extends TaskState {
    private suspendCount: number;

    constructor(suspendCount: number) {
        super();
        this.suspendCount = suspendCount;
    }

    public describe(): string {
        return `SUSPENDED (count: ${this.suspendCount})`;
    }

    public fullData(): any {
        return null;
    }
}

class TaskPending extends TaskState {
    private pendingInfo: Map<OsTaskPendingState, EventInfo[]>;

    constructor() {
        super();
        this.pendingInfo = new Map();
    }

    public addEvent(event: EventInfo) {
        this.addEventType(event.eventType);
        this.pendingInfo.get(event.eventType).push(event);
    }

    public addEventType(eventType: OsTaskPendingState) {
        if (!this.pendingInfo.has(eventType)) {
            this.pendingInfo.set(eventType, []);
        }
    }

    public describe(): string {
        // Converting to an array here is inefficient, but JS has no builtin iterator map/reduce feature
        const eventCount = [...this.pendingInfo.values()].reduce((acc, events) => acc + events.length, 0);

        if (eventCount <= 1) {
            let event: EventInfo = null;
            for (const events of this.pendingInfo.values()) {
                if (events.length > 0) {
                    event = events[0];
                }
            }

            if (event) {
                const eventTypeStr = OsTaskPendingState[event.eventType] ? OsTaskPendingState[event.eventType] : 'Unknown';
                const eventTimeoutString = event.timeOut ? ` with timeout in ${event.timeOut}` : ''; // TODO Not sure what unit this variable holds
                return `PEND ${eventTypeStr}: ${describeEvent(event)}${eventTimeoutString}`;
            } else {
                // This should not happen, but we still keep it as a fallback
                return 'PEND Unknown';
            }
        } else {
            return 'PEND MULTI';
        }
    }

    public fullData() {
        // Build an object containing mapping event types to event descriptions
        const result = {};
        const eventTypes = [...this.pendingInfo.keys()];
        eventTypes.sort();
        for (const eventType of eventTypes) {
            result[OsTaskPendingState[eventType]] = [];
            for (const event of this.pendingInfo.get(eventType)) {
                result[OsTaskPendingState[eventType]].push(describeEvent(event));
            }
        }

        return result;
    }
}

interface EventInfo {
    name?: string;
    timeOut?: number;
    address: number;
    eventType: OsTaskPendingState;
}

function describeEvent(event: EventInfo): string {
    if (event.name && event.name !== '?') {
        return event.name;
    } else {
        return `0x${event.address.toString(16)}`;
    }
}
