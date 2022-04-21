import { DebugProtocol } from '@vscode/debugprotocol';
import * as vscode from 'vscode';
import * as RTOSCommon from './rtos-common';
import { RTOSFreeRTOS } from './rtos-freertos';
import { RTOSUCOS2 } from './rtos-ucosii';

const RTOS_TYPES = {
    'FreeRTOS': RTOSFreeRTOS,
    'uC/OS-II': RTOSUCOS2
};
export class RTOSSession {
    public lastFrameId: number;
    public html: string = '';
    public style: string = '';
    public rtos: RTOSCommon.RTOSBase; // The final RTOS
    private allRTOSes: RTOSCommon.RTOSBase[] = [];
    public triedAndFailed = false;

    constructor(public session: vscode.DebugSession) {
        this.lastFrameId = undefined;
        for (const rtosType of Object.keys(RTOS_TYPES)) {
            this.allRTOSes.push(new RTOS_TYPES[rtosType](session));
        }
    }

    // This is the work horse. Do not call it if the panel is in disabled state.
    public async onStopped(frameId: number): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            this.lastFrameId = frameId;
            const doRefresh = () => {
                if (this.rtos) {
                    this.html = '<p>Failed to get RTOS information. Please report an issue if RTOS is actually running</p>\n';
                    this.rtos.onStopped(frameId).then(() => {
                        [this.html, this.style] = this.rtos.getHTML();
                        resolve();
                    });
                } else {
                    this.triedAndFailed = true;
                    this.html = '';
                    this.style = '';
                    resolve();
                }
            };

            if (this.rtos === undefined && this.allRTOSes.length > 0) {
                // Let them all work in parallel. Since this will generate a ton of gdb traffic and traffic from other sources
                // like variable, watch windows, things can fail. But our own backend queues things up so failures are unlikely
                // With some other backend (if for instance we support cppdbg), not sure what happens. Worst case, try one OS
                // at a time.
                const promises = [];
                for (const rtos of this.allRTOSes) {
                    promises.push(rtos.tryDetect(frameId));
                }

                Promise.all(promises).then((results) => {
                    for (const rtos of results) {
                        if (rtos.status === 'failed') {
                            const ix = this.allRTOSes.findIndex((v) => v === rtos);
                            this.allRTOSes.splice(ix, 1);
                            if (this.allRTOSes.length === 0) {
                                doRefresh();
                                break;
                            }
                        } else if (rtos.status === 'initialized') {
                            this.allRTOSes = [];
                            this.rtos = rtos;
                            doRefresh();
                            break;
                        }
                    }
                    if (this.allRTOSes.length > 0) {
                        // Some RTOSes have not finished detection
                        this.html = '<p>RTOS detection in progress...</p>\n';
                        this.style = '';
                        resolve();
                    }
                });
            } else {
                doRefresh();
            }
        });
    }

    public onContinued(): void {
        this.lastFrameId = undefined;
        if (this.rtos) {
            this.rtos.onContinued();
        }
    }

    public onExited(): void {
        if (this.rtos) {
            this.rtos.onExited();
        }
        this.lastFrameId = undefined;
        this.rtos = undefined;
    }

    public refresh(): Promise<void> {
        if (this.lastFrameId !== undefined) {
            return this.onStopped(this.lastFrameId);
        }
        return new Promise<void>((r) => r());
    }
}

interface DebugStopRunEvent {
    onStopped(session: vscode.DebugSession, frameId: number);
    onContinued(session: vscode.DebugSession);
}
class DebuggerTracker implements vscode.DebugAdapterTracker {
    private lastFrameId: number = undefined;
    constructor(
        public session: vscode.DebugSession,
        protected handler: DebugStopRunEvent
    ) { }

    public onDidSendMessage(msg: any): void {
        const message = msg as DebugProtocol.ProtocolMessage;
        if (!message) {
            return;
        }
        switch (message.type) {
            case 'event': {
                const ev: DebugProtocol.Event = message as DebugProtocol.Event;
                if (ev) {
                    if (ev.event === 'stopped') {
                        this.lastFrameId = undefined;
                    } else if (ev.event === 'continued') {
                        this.handler.onContinued(this.session);
                    }
                }
                break;
            }
            case 'response': {
                const rsp: DebugProtocol.Response = message as DebugProtocol.Response;
                if (rsp) {
                    // We don;t actually do anything when the session is paused. We wait until someone (VSCode) makes
                    // a stack trace request and we get the frameId from there. Any one will do. Either this or we
                    // have to make our requests for threads, scopes, stackTrace, etc. Unnecessary traffic and work
                    // for the adapter. Downside is if no stackTrace is requested by someone else, then we don't do anything
                    // but then who is the main client for the adapter?
                    if (rsp.command === 'stackTrace') {
                        if (
                            rsp.body?.stackFrames &&
                            rsp.body.stackFrames.length > 0 &&
                            this.lastFrameId === undefined
                        ) {
                            this.lastFrameId = rsp.body.stackFrames[0].id;
                            this.handler.onStopped(this.session, this.lastFrameId);
                        }
                    }
                }
                break;
            }
            default: {
                // console.log('Unhandled Message type ' + message.type);
                break;
            }
        }
    }
}

export class RTOSTracker
    implements vscode.DebugAdapterTrackerFactory, DebugStopRunEvent {
    private sessionMap: Map<string, RTOSSession> = new Map<string, RTOSSession>();
    private provider: RTOSViewProvider;
    public enabled: boolean;
    public visible: boolean;

    constructor(private context: vscode.ExtensionContext) {
        this.provider = new RTOSViewProvider(context.extensionUri, this);
        const config = vscode.workspace.getConfiguration('cortex-debug', null);

        this.enabled = config.get('showRTOS', false);
        this.visible = this.enabled;
        vscode.commands.executeCommand('setContext', 'cortex-debug:showRTOS', this.enabled);
        context.subscriptions.push(
            vscode.debug.onDidStartDebugSession(this.debugSessionStarted.bind(this)),
            vscode.debug.onDidTerminateDebugSession(
                this.debugSessionTerminated.bind(this)
            ),
            vscode.debug.registerDebugAdapterTrackerFactory('cortex-debug', this),
            // vscode.debug.registerDebugAdapterTrackerFactory('cppdbg', this);
            vscode.window.registerWebviewViewProvider(RTOSViewProvider.viewType, this.provider),
            vscode.workspace.onDidChangeConfiguration(this.settingsChanged.bind(this)),
            vscode.commands.registerCommand('cortex-debug.rtos.toggleRTOSPanel', this.toggleRTOSPanel.bind(this)),
            vscode.commands.registerCommand('cortex-debug.rtos.refresh', this.update.bind(this))
        );
    }

    private settingsChanged(e: vscode.ConfigurationChangeEvent) {
        if (e.affectsConfiguration('cortex-debug.showRTOS')) {
            const config = vscode.workspace.getConfiguration('cortex-debug', null);
            this.enabled = config.get('showRTOS', false);
            vscode.commands.executeCommand('setContext', 'cortex-debug:showRTOS', this.enabled);
            this.update();
        }
    }

    public createDebugAdapterTracker(
        session: vscode.DebugSession
    ): vscode.ProviderResult<vscode.DebugAdapterTracker> {
        return new DebuggerTracker(session, this);
    }

    public async onStopped(session: vscode.DebugSession, frameId: number) {
        for (const rtosSession of this.sessionMap.values()) {
            if (rtosSession.session.id === session.id) {
                rtosSession.lastFrameId = frameId;
                if (this.enabled && this.visible) {
                    await rtosSession.onStopped(frameId);
                    this.provider.updateHtml();
                }
                break;
            }
        }
    }

    public onContinued(session: vscode.DebugSession) {
        for (const rtosSession of this.sessionMap.values()) {
            if (rtosSession.session.id === session.id) {
                rtosSession.onContinued();
            }
        }
    }

    private debugSessionStarted(session: vscode.DebugSession) {
        this.sessionMap.set(session.id, new RTOSSession(session));
    }

    private debugSessionTerminated(session: vscode.DebugSession) {
        const s = this.sessionMap.get(session.id);
        if (s) {
            s.onExited();
            this.sessionMap.delete(session.id);
        }
    }

    // Only updates the RTOS state. Only debug sessions that are currently stopped will be updated
    public async updateRTOSInfo(): Promise<any> {
        const promises = [];
        if (this.enabled && this.visible) {
            for (const rtosSession of this.sessionMap.values()) {
                promises.push(rtosSession.refresh());
            }
        }
        return Promise.all(promises);
    }

    public toggleRTOSPanel() {
        this.enabled = !this.enabled;
        this.updateRTOSPanelStatus();
    }

    private updateRTOSPanelStatus() {
        const config = vscode.workspace.getConfiguration('cortex-debug', null);
        config.update('showRTOS', this.enabled);
        vscode.commands.executeCommand('setContext', 'cortex-debug:showRTOS', this.enabled);
        /*
        if (this.enabled) {
            this.provider.showAndFocus();
        }
        this.update();
        */
    }

    public notifyPanelDisposed() {
        this.enabled = this.visible = false;
        this.updateRTOSPanelStatus();
    }

    public async visibilityChanged(v: boolean) {
        if (v !== this.visible) {
            this.visible = v;
            if (this.visible) {
                const msg = 'Some sessions are busy. RTOS panel will be updated when session is paused';
                for (const rtosSession of this.sessionMap.values()) {
                    if (rtosSession.lastFrameId === undefined) {
                        if (msg) {
                            vscode.window.showInformationMessage(msg);
                            break;
                        }
                    }
                }
            }
            try {
                await this.update();
            }
            catch { }
        }
    }

    // Updates RTOS state and the Panel HTML
    private busyHtml: string;
    public update(): Promise<void> {
        return new Promise<void>((resolve) => {
            if (!this.enabled || !this.visible || !this.sessionMap.size) {
                resolve();
            }
            this.busyHtml = '<h4>Busy updating...</h4>\n';
            this.provider.updateHtml();
            this.updateRTOSInfo().then(() => {
                this.busyHtml = undefined;
                this.provider.updateHtml();
                resolve();
            }, (e) => {
                this.busyHtml = undefined;
                this.provider.updateHtml();
                resolve();
            });
        });
    }

    private lastGoodHtml: string;
    private lastGoodCSS: string;
    public getHtml(): [string, string] {
        if (this.busyHtml) {
            return [this.busyHtml, ''];
        } else if (this.sessionMap.size === 0) {
            if (this.lastGoodHtml) {
                return [this.lastGoodHtml, this.lastGoodCSS];
            } else {
                return ['<p>No active/compatible debug sessions running.</p>\n', ''];
            }
        } else if (!this.visible || !this.enabled) {
            return ['<p>Contents are not visible, so no html generated</p>\n', ''];
        }
        let ret = '';
        let retStyle = '';
        for (const rtosSession of this.sessionMap.values()) {
            const name = `Session Name: "${rtosSession.session.name}"`;
            if (!rtosSession.rtos) {
                const nameAndStatus = name + ' -- No RTOS detected';
                ret += /*html*/`<h4>${nameAndStatus}</h4>\n`;
                if (rtosSession.triedAndFailed) {
                    const supported = Object.keys(RTOS_TYPES).join(', ');
                    ret += `<p>Failed to match any supported RTOS. Supported RTOSes are (${supported}). ` +
                        'Please report issues and/or contribute code/knowledge to add your RTOS</p>\n';
                } else {
                    ret += '<p>Try refreshing this panel. RTOS detection may be still in progress</p>\n';
                }
            } else {
                const rtosHtml = rtosSession.html;
                const nameAndStatus = name + ', ' + rtosSession.rtos.name + ' detected.' + (!rtosHtml ? ' (No data available yet)' : '');
                ret += /*html*/`<h4>${nameAndStatus}</h4>\n` + rtosHtml;
                retStyle = rtosSession.style;
            }
        }
        this.lastGoodHtml = ret;
        this.lastGoodCSS = retStyle;
        return [ret, retStyle];
    }
}

class RTOSViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'cortex-debug.rtos';
    private webviewView: vscode.WebviewView;

    constructor(private readonly extensionUri: vscode.Uri, private parent: RTOSTracker) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken
    ) {
        this.webviewView = webviewView;
        this.parent.visible = this.webviewView.visible;
        this.parent.enabled = true;

        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };
        this.webviewView.description = 'View RTOS internals';

        this.webviewView.onDidDispose((e) => {
            this.webviewView = undefined;
            this.parent.notifyPanelDisposed();
        });

        this.webviewView.onDidChangeVisibility((e) => {
            this.parent.visibilityChanged(this.webviewView.visible);
        });

        this.updateHtml();

        webviewView.webview.onDidReceiveMessage((msg) => {
            switch (msg?.type) {
                case 'refresh': {
                    this.parent.update();
                    break;
                }
            }
        });
    }

    public showAndFocus() {
        if (this.webviewView) {
            this.webviewView.show(false);
        }
    }

    public updateHtml() {
        if (this.webviewView) {
            this.webviewView.webview.html = this.getHtmlForWebview();
            // console.log(this.webviewView.webview.html);
        }
    }

    private getHtmlForWebview(): string {
        const webview = this.webviewView?.webview;
        if (!webview) {
            return '';
        }
        if (!this.parent.enabled) {
            return '<!DOCTYPE html>\n' +
            '<html lang="en">\n' +
            '<head>\n' +
            '    <meta charset="UTF-8">\n' +
            '    <title>RTOS Threads</title>\n' +
            '</head>\n' +
            '<body>\n' +
            '    <p>Currently disabled. Enable setting "cortex-debug.showRTOS" or use Command "Cortex Debug: Toggle RTOS Panel" to see any RTOS info</p>\n' +
            '</body>\n' +
            '</html>';
        }
        const toolkitUri = getUri(webview, this.extensionUri, [
            'webview',
            'node_modules',
            '@vscode',
            'webview-ui-toolkit',
            'dist',
            'toolkit.js'
        ]);
        // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'rtos.js'));
        const rtosStyle = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'rtos.css'));

        const indentString = (str: string, count: number, indent = ' ') => {
            indent = indent.repeat(count);
            return str.replace(/^/gm, indent);
        };

        const [body, style] = this.parent.getHtml();
        const bodyIndented = indentString(body, 4);
        const styleIndented = indentString(style, 8);
        // Use a nonce to only allow a specific script to be run.
        const nonce = getNonce();
        return '<!DOCTYPE html>\n' +
               '<html lang="en">\n' +
               '<head>\n' +
               '    <meta charset="UTF-8">\n' +
               '    <!--\n' +
               '        Use a content security policy to only allow loading images from https or from our extension directory,\n' +
               '        and only allow scripts that have a specific nonce.\n' +
               '    -->\n' +
               '    <meta http-equiv="Content-Security-Policy" content="default-src \'none\';' +
               `style-src 'nonce-${nonce}' ${webview.cspSource}; script-src 'nonce-${nonce}';">\n` +
               '    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
               `    <link href="${rtosStyle}" rel="stylesheet">\n` +
               `    <style nonce="${nonce}">\n` +
               `${styleIndented}\n` +
               '    </style>\n' +
               '    <title>RTOS Threads</title>\n' +
               '</head>\n' +
               '<body>\n' +
               `${bodyIndented}\n` +
               `    <script type="module" nonce="${nonce}" src="${toolkitUri}"></script>\n` +
               `    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>\n` +
               '</body>\n' +
               '</html>';
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export function getUri(webview: vscode.Webview, extensionUri: vscode.Uri, pathList: string[]) {
    return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...pathList));
}
