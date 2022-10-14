import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as RTOSCommon from './rtos-common';
import { hexFormat } from '../utils';
import { HrTimer, toStringDecHexOctBin } from '../../common';

// We will have two rows of headers for ChibiOS and the table below describes
// the columns headers for the two rows and the width of each column as a fraction
// of the overall space.
enum DisplayFields {
    ID,
    THREAD_DESCRIPTION,
    FLAGS,
    REFS,
    TIME,
    WTOBJP,
    STATS_N,
    STATS_WORST,
    STATS_CUMULATIVE,
    STACK_TOP,
    STACK_END,
    STACK_MIN_FREE
}

enum chThreadState {
    READY = 0,
    CURRENT,
    STARTED,
    SUSPENDED,
    QUEUED,
    WTSEM,
    WTMTX,
    WTCOND,
    SLEEPING,
    WTEXIT,
    WTOREVT,
    WTANDEVT,
    SNDMSGQ,
    SNDMSG,
    WTMSG,
    FINAL,
    UNKNOWN,
    _SIZE
}

const colNumType = RTOSCommon.ColTypeEnum.colTypeNumeric;
const ChibiOSItems: { [key: string]: RTOSCommon.DisplayColumnItem } = {};

ChibiOSItems[DisplayFields[DisplayFields.ID]] = { width: 2, headerRow1: '', headerRow2: 'id', colType: colNumType};
ChibiOSItems[DisplayFields[DisplayFields.THREAD_DESCRIPTION]] = { width: 14, headerRow1: '', headerRow2: 'Thread', colGapBefore: 1};
ChibiOSItems[DisplayFields[DisplayFields.FLAGS]] = {width: 2, headerRow1: '', headerRow2: 'Flags', colGapAfter: 1};
ChibiOSItems[DisplayFields[DisplayFields.REFS]] = {width: 4, headerRow1: '', headerRow2: 'Refs', colGapBefore: 1};
ChibiOSItems[DisplayFields[DisplayFields.TIME]] = {width: 3, headerRow1: '', headerRow2: 'Time', colType: colNumType};
ChibiOSItems[DisplayFields[DisplayFields.WTOBJP]] = {width: 4, headerRow1: 'Wait', headerRow2: 'Obj/Msg', colGapBefore: 1};
ChibiOSItems[DisplayFields[DisplayFields.STATS_N]] = {width: 4, headerRow1: 'Stats', headerRow2: 'Switches', colType: colNumType};
ChibiOSItems[DisplayFields[DisplayFields.STATS_WORST]] = {width: 4, headerRow1: '', headerRow2: 'Worst Path', colType: colNumType};
ChibiOSItems[DisplayFields[DisplayFields.STATS_CUMULATIVE]] = {width: 4, headerRow1: '', headerRow2: 'Cumulative Time', colType: colNumType};
ChibiOSItems[DisplayFields[DisplayFields.STACK_TOP]] = {width: 4, headerRow1: 'Stack', headerRow2: 'Top', colGapBefore: 1};
ChibiOSItems[DisplayFields[DisplayFields.STACK_END]] = {width: 4, headerRow1: '', headerRow2: 'End', colGapBefore: 1};
ChibiOSItems[DisplayFields[DisplayFields.STACK_MIN_FREE]] = {width: 3, headerRow1: '', headerRow2: 'Min. free', colType: colNumType};

const DisplayFieldNames: string[] = Object.keys(ChibiOSItems);

function getThreadStateName(s: number): string {
    if (s < chThreadState._SIZE) {
        return chThreadState[s];
    }

    return chThreadState[chThreadState._SIZE - 1];
}

function getCString(s: string, nullValue: string = ''): string {
    const matchName = s.match(/"([^*]*)"$/);
    return matchName ? matchName[1] : nullValue;
}

function getNumber(s: string): number {
    return (s ? parseInt(s) : 0);
}

function getNumberNVL(s: string, nullValue: number): number {
    return (s ? parseInt(s) : nullValue);
}

function nvl(v: any, nullValue: any) {
    if ((v === undefined) || (v === null)) {
        return nullValue;
    }

    return v;
}

export class RTOSChibiOS extends RTOSCommon.RTOSBase {

    // We keep a bunch of variable references (essentially pointers) that we can use to query for values
    // Since all of them are global variable, we only need to create them once per session. These are
    // similar to Watch/Hover variables
    private chRlistCurrent: RTOSCommon.RTOSVarHelper;
    private chReglist: RTOSCommon.RTOSVarHelper;

    private rlistCurrent: number;
    private threadOffset: number;
    private smp: boolean = false;

    private stale: boolean;
    private foundThreads: RTOSCommon.RTOSThreadInfo[] = [];
    private finalThreads: RTOSCommon.RTOSThreadInfo[] = [];
    private timeInfo: string;
    private helpHtml: string = undefined;

    // Need to do a TON of testing for stack growing the other direction
    private stackIncrements = -1;

    private readonly maxThreads = 1024;

    constructor(public session: vscode.DebugSession) {
        super(session, 'ChibiOS');
    }

    public async tryDetect(useFrameId: number): Promise<RTOSCommon.RTOSBase> {
        this.progStatus = 'stopped';
        try {
            if (this.status === 'none') {
                // We only get references to all the interesting variables. Note that any one of the following can fail
                // and the caller may try again until we know that it definitely passed or failed. Note that while we
                // re-try everything, we do remember what already had succeeded and don't waste time trying again. That
                // is how this.getVarIfEmpty() works
                try {
                    this.chReglist = await this.getVarIfEmpty(this.chReglist, useFrameId, '(uint32_t) &ch_system.reglist', false);
                    this.smp = true;
                } catch (e) {
                    this.chReglist = await this.getVarIfEmpty(this.chReglist, useFrameId, '(uint32_t) &ch0.reglist', false);
                }

                this.chRlistCurrent = await this.getVarIfEmpty(this.chRlistCurrent, useFrameId, 'ch0.rlist.current', false);
                this.threadOffset = parseInt(await this.getExprVal('((char *)(&((thread_t *)0)->rqueue) - (char *)0)', useFrameId));
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
            // TODO: add help html
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
            this.foundThreads = [];
            this.finalThreads = [];

            this.chRlistCurrent.getValue(frameId).then(async (rlistCurrentStr) => {

                try {
                    this.rlistCurrent = getNumberNVL(rlistCurrentStr, 0);

                    if (0 !== this.rlistCurrent) {
                        // TODO: add global info: panic message, irs cnt...

                        await this.getThreadInfo(this.chReglist, frameId);
                        this.finalThreads = [...this.foundThreads];
                    } else {
                        this.finalThreads = [];
                    }

                    this.stale = false;
                    this.timeInfo += ' in ' + timer.deltaMs() + ' ms';
                    resolve();
                }
                catch (e) {
                    resolve();
                    console.error('ChibiOS.refresh() failed: ', e);
                }
            }, (reason) => {
                resolve();
                console.error('ChibiOS.refresh() failed: ', reason);
            });
        });
    }

    private getThreadInfo(reglist: RTOSCommon.RTOSVarHelper, frameId: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!reglist) {
                resolve();
                return;
            }

            if (this.progStatus !== 'stopped') {
                reject(new Error('Busy'));
                return;
            }

            reglist.getValue(frameId).then(async (obj) => {
                try {
                    const reglistHeader = obj ? parseInt(obj) : 0;

                    if (reglistHeader && 0 !== reglistHeader) {
                        let nextEntry = await this.getExprValChildrenObj('(ch_queue_t *)' + reglistHeader, frameId);
                        let currentReglist = getNumber(nextEntry['next-val']);
                        let i = 0;

                        // TODO: add reglist integrity check

                        do {
                            const currentThreadAddr = currentReglist - this.threadOffset;
                            const currentThread = await this.getExprValChildrenObj('(thread_t *) ' + currentThreadAddr, frameId);
                            const currentThreadPqueue = await this.getExprValChildrenObj('((thread_t *) ' + currentThreadAddr + ')->hdr.pqueue', frameId);
                            const currentThreadStateDetails = await this.getVarChildrenObj(currentThread['u-ref'], 'u');
                            const currentThreadStats = await this.getVarChildrenObj(currentThread['stats-ref'], 'stats');

                            const threadRunning = (currentThreadAddr === this.rlistCurrent);
                            const threadName = getCString(currentThread['name-val'], '<no name>');
                            const threadState = getThreadStateName(getNumberNVL(currentThread['state-val'], chThreadState._SIZE));
                            const threadFlags = getNumberNVL(currentThread['flags-val'], 0);
                            const threadPrio = getNumberNVL(currentThreadPqueue['prio-val'], 0);
                            const threadRefs = getNumberNVL(currentThread['refs-val'], 0);
                            const threadTime = nvl(currentThread['time-val'], '-');
                            const threadWaitForObj = currentThreadStateDetails['wtobjp-val'];
                            const threadStatsN = currentThreadStats['n-val'];
                            const threadStatsWorst = currentThreadStats['worst-val'];
                            const threadStatsCumulative = currentThreadStats['cumulative-val'];

                            const stackInfo = await this.getStackInfo(currentThread);

                            let stackMinFree: string;

                            if (stackInfo.stackPeak) {
                                if (stackInfo.stackPeak === -1) {
                                    stackMinFree = 'overflow';
                                } else {
                                    stackMinFree = stackInfo.stackPeak.toString();
                                }
                            } else {
                                stackMinFree = '-';
                            }

                            i++;

                            const display: { [key: string]: RTOSCommon.DisplayRowItem } = {};
                            const mySetter = (x: DisplayFields, text: string, value?: any) => {
                                display[DisplayFieldNames[x]] = { text, value };
                            };

                            mySetter(DisplayFields.ID, i.toString());
                            mySetter(DisplayFields.THREAD_DESCRIPTION,
                                threadName + '@' + hexFormat(currentThreadAddr) + ' ' + threadState + ' [P:' + threadPrio + ']' );
                            mySetter(DisplayFields.FLAGS, hexFormat(threadFlags, 2));
                            mySetter(DisplayFields.REFS, hexFormat(threadRefs));
                            mySetter(DisplayFields.TIME, threadTime);
                            mySetter(DisplayFields.WTOBJP, hexFormat(threadWaitForObj));
                            mySetter(DisplayFields.STATS_N, threadStatsN);
                            mySetter(DisplayFields.STATS_WORST, threadStatsWorst);
                            mySetter(DisplayFields.STATS_CUMULATIVE, threadStatsCumulative);
                            mySetter(DisplayFields.STACK_TOP, stackInfo.stackTop !== 0 ? hexFormat(stackInfo.stackTop) : '-');
                            mySetter(DisplayFields.STACK_END, stackInfo.stackEnd !== 0 ? hexFormat(stackInfo.stackEnd) : '-');
                            mySetter(DisplayFields.STACK_MIN_FREE, stackMinFree);

                            const threadInfo: RTOSCommon.RTOSThreadInfo = {
                                display: display, stackInfo: stackInfo, running: threadRunning
                            };

                            this.foundThreads.push(threadInfo);
                            this.createHmlHelp(threadInfo, currentThread);

                            nextEntry = await this.getExprValChildrenObj('(ch_queue_t *)' + currentReglist, frameId);
                            currentReglist = nextEntry['next-val'] ? parseInt(nextEntry['next-val']) : 0;

                        } while (reglistHeader !== currentReglist);

                    } else {
                        // TODO: add error message - reglist header not found
                    }

                    resolve();
                }
                catch (e) {
                    console.log('ChibiOS.getThreadInfo() error', e);
                }
            }, (e) => {
                reject(e);
            });
        });
    }

    protected async getStackInfo(thInfo: any) {

        const stackInfo: RTOSCommon.RTOSStackInfo = {
            stackStart: 0,
            stackTop: 0,
            stackPeak: null
        };

        const currentThreadCtx = await this.getVarChildrenObj(thInfo['ctx-ref'], 'ctx');
        const currentThreadCtxRegs = await this.getVarChildrenObj(currentThreadCtx['sp-ref'], 'sp');

        stackInfo.stackTop = getNumberNVL(currentThreadCtxRegs.hasOwnProperty('r13-val') ? currentThreadCtxRegs['r13-val'] : currentThreadCtx['sp-val'], 0);
        stackInfo.stackEnd = getNumberNVL(thInfo['wabase-val'], 0);

        if (stackInfo.stackTop === 0 || stackInfo.stackEnd === 0) {
            stackInfo.stackFree = null;
            stackInfo.stackPeak = null;
        } else if (stackInfo.stackTop < stackInfo.stackEnd) {
            stackInfo.stackFree = -1;
            stackInfo.stackPeak = -1;
        } else {
            stackInfo.stackFree = stackInfo.stackTop - stackInfo.stackEnd;

            /* check stack peak */
            try {
                const stackData = await this.session.customRequest(
                    'readMemory',
                    {
                        memoryReference: hexFormat(Math.min(stackInfo.stackTop, stackInfo.stackEnd)),
                        count: Math.abs(stackInfo.stackTop - stackInfo.stackEnd)
                    }
                );

                const buf = Buffer.from(stackData.data, 'base64');
                const bytes = new Uint8Array(buf);

                stackInfo.stackPeak = 0;
                while ((stackInfo.stackPeak < bytes.length) && (bytes[stackInfo.stackPeak] === 0x55)) {
                  stackInfo.stackPeak++;
                }
            }
            catch (e) {
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
        if (this.status === 'none') {
            htmlContent.html = '<p>RTOS not yet fully initialized. Will occur next time program pauses</p>\n';
            return htmlContent;
        } else if (this.stale) {
            const lastHtmlInfo = this.lastValidHtmlContent;
            htmlContent.html = '<p>Unable to collect full RTOS information.</p>\n' + lastHtmlInfo.html;
            htmlContent.css = lastHtmlInfo.css;
            return htmlContent;
        } else if (this.finalThreads.length === 0) {
            htmlContent.html = `<p>No ${this.name} threads detected, perhaps RTOS not yet initialized or tasks yet to be created!</p>\n`;
            return htmlContent;
        }

        const ret = this.getHTMLCommon(DisplayFieldNames, ChibiOSItems, this.finalThreads, this.timeInfo);
        htmlContent.html = ret.html + (this.helpHtml || '');
        htmlContent.css = ret.css;

        this.lastValidHtmlContent = htmlContent;
        // console.log(this.lastValidHtmlContent.html);
        return this.lastValidHtmlContent;
    }

}
