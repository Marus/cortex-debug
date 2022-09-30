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
    ThreadDescription,
    Status,
    Priority
}

enum chThreadStatus {
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
};

const numType = RTOSCommon.ColTypeEnum.colTypeNumeric;
const ChibiOSItems: { [key: string]: RTOSCommon.DisplayColumnItem } = {};

ChibiOSItems[DisplayFields[DisplayFields.ID]] = { width: 1, headerRow1: '', headerRow2: '', colType: numType};
ChibiOSItems[DisplayFields[DisplayFields.ThreadDescription]] = { width: 4, headerRow1: '', headerRow2: 'Thread'};
ChibiOSItems[DisplayFields[DisplayFields.Status]] = {width: 4, headerRow1: '', headerRow2: 'Status'};
ChibiOSItems[DisplayFields[DisplayFields.Priority]] = {width: 4, headerRow1: '', headerRow2: 'Prio'};

const DisplayFieldNames: string[] = Object.keys(ChibiOSItems);

function isNullOrUndefined(x: any) {
    return (x === undefined) || (x === null);
}

function getThreadStatusName(s: number) {
    if (s < chThreadStatus._SIZE) {
        return chThreadStatus[s];
    }

    return chThreadStatus[chThreadStatus._SIZE - 1];
}

function getCString(s: string) {
    let matchName = s.match(/"([^*]*)"$/);
    return matchName ? matchName[1] : s;
}

export class RTOSChibiOS extends RTOSCommon.RTOSBase {

    // We keep a bunch of variable references (essentially pointers) that we can use to query for values
    // Since all of them are global variable, we only need to create them once per session. These are
    // similar to Watch/Hover variables
    private chDebug: RTOSCommon.RTOSVarHelper;
    private chRlistCurrent: RTOSCommon.RTOSVarHelper;
    private chReglist: RTOSCommon.RTOSVarHelper;

    private rlistCurrent: number;
    private threadOffset: number;
    private smp: boolean = false;

    private stale: boolean;
    private curThreadAddr: number;
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
                } catch(e) {
                    this.chReglist = await this.getVarIfEmpty(this.chReglist, useFrameId, '(uint32_t) &ch0.reglist', false);
                }

                this.chDebug = await this.getVarIfEmpty(this.chDebug, useFrameId, 'ch_debug', false);
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

                if (ret) {
                    ret += '<br>Note: Make sure you consider the performance/resources impact for any changes to your FW.<br>\n';
                    ret = '<button class="help-button">Hints to get more out of the ChibiOS viewer</button>\n' +
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
            this.foundThreads = [];
            this.finalThreads = [];

            this.chRlistCurrent.getValue(frameId).then(async (rlistCurrentStr) => {
                try {
                    this.rlistCurrent = rlistCurrentStr ? parseInt(rlistCurrentStr) : 0;

                    if (0 !== this.rlistCurrent) {

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
                        let currentReglist = nextEntry['next-val'] ? parseInt(nextEntry['next-val']) : 0;
                        let i = 0;

                        // TODO: add reglist integrity check

                        do {

                            const currentThreadAddr = currentReglist - this.threadOffset;
                            const currentThread = await this.getExprValChildrenObj('(thread_t *) ' + currentThreadAddr, frameId);
                            i++;

                            const threadRunning = (currentThreadAddr === this.rlistCurrent);
                            const threadState = getThreadStatusName(parseInt(currentThread['state-val'], 10));
                            const threadName = getCString(currentThread['name-val']);
                            const threadPrio = currentThread['realprio-val']

                            // TODO: add stack, wtobj, time stats processing

                            const display: { [key: string]: RTOSCommon.DisplayRowItem } = {};
                            const mySetter = (x: DisplayFields, text: string, value?: any) => {
                                display[DisplayFieldNames[x]] = { text, value };
                            };

                            mySetter(DisplayFields.ID, i.toString());
                            mySetter(DisplayFields.ThreadDescription, threadName + ' @ ' + hexFormat(currentThreadAddr));
                            mySetter(DisplayFields.Status, threadState);
                            mySetter(DisplayFields.Priority, threadPrio);

                            const threadInfo: RTOSCommon.RTOSThreadInfo = {
                                display: display, stackInfo: null, running: threadRunning
                            };

                            this.foundThreads.push(threadInfo);

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

    protected async getStackInfo(thInfo: any, waterMark: number) {

    }

    public lastValidHtmlContent: RTOSCommon.HtmlInfo = {html: '', css: ''};

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
            msg = ' Could not read "uxCurrentNumberOfTasks". Perhaps program is busy or did not stop long enough';
            lastHtmlInfo.html = '';
            lastHtmlInfo.css = '';

            htmlContent.html = `<p>Unable to collect full RTOS information.${msg}</p>\n` + lastHtmlInfo.html;
            htmlContent.css = lastHtmlInfo.css;
            return htmlContent;
        }

        const ret = this.getHTMLCommon(DisplayFieldNames, ChibiOSItems, this.finalThreads, this.timeInfo);
        htmlContent.html = msg + ret.html + (this.helpHtml || '');
        htmlContent.css = ret.css;

        this.lastValidHtmlContent = htmlContent;
        // console.log(this.lastValidHtmlContent.html);
        return this.lastValidHtmlContent;
    }

}
