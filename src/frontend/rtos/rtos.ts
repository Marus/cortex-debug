import { DebugProtocol } from '@vscode/debugprotocol';
import * as vscode from 'vscode';
import * as RTOSCommon from './rtos-common';
import { RTOSFreeRTOS } from './rtos-freertos';

export class RTOSSession {
    public lastFrameId: number;
    public html: string = '';
    public rtos: RTOSCommon.RTOSBase; // The final RTOS
    private allRTOSes: RTOSCommon.RTOSBase[] = [];

    constructor(public session: vscode.DebugSession) {
        this.allRTOSes.push(new RTOSFreeRTOS(session));
    }

    public async onStopped(frameId: number): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            const doRefresh = () => {
                if (this.rtos) {
                    this.html = '<p>Failed to get RTOS information</p>\n';
                    this.rtos.onStopped(frameId).then(() => {
                        this.html = this.rtos.getHTML();
                        console.log(this.html);
                        resolve();
                    });
                } else {
                    this.html = '';
                    resolve();
                }
            };

            this.lastFrameId = frameId;
            if (this.rtos === undefined && this.allRTOSes.length > 0) {
                // Let them all work in parallel. Since this will generate a ton of gdb traffic and traffic from other sources
                // like variable, watch windows, things can fail. But our own backend queues things up so failures are unlikely
                // With some other backend (if for instace we support cppdbg), not sure what happens. Worst case, try one OS
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
                        } else if (rtos.status === 'initialized') {
                            this.allRTOSes = [];
                            this.rtos = rtos;
                            doRefresh();
                            return;
                        }
                    }
                    // Nothing fully matched. Some may have partially worked before getting interrupted, try again on next pause
                    resolve();
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

    public getHTML(): string {
        return this.html;
    }

    public refresh() {
        if (this.rtos && (this.rtos.progStatus === 'stopped') && (this.lastFrameId !== undefined)) {
            this.onStopped(this.lastFrameId);
        }
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
                console.log('Unhandled Message type ' + message.type);
                break;
            }
        }
    }
}

export class RTOSTracker
    implements vscode.DebugAdapterTrackerFactory, DebugStopRunEvent {
    private sessionMap: Map<string, RTOSSession> = new Map<string, RTOSSession>();
    private provider: RTOSViewProvider;
    constructor(private context: vscode.ExtensionContext) {
        this.provider = new RTOSViewProvider(context.extensionUri, this);
        context.subscriptions.push(
            vscode.debug.onDidStartDebugSession(this.debugSessionStarted.bind(this)),
            vscode.debug.onDidTerminateDebugSession(
                this.debugSessionTerminated.bind(this)
            ),
            // vscode.debug.registerDebugAdapterTrackerFactory('cppdbg', this);
            vscode.window.registerWebviewViewProvider(RTOSViewProvider.viewType, this.provider),
            vscode.debug.registerDebugAdapterTrackerFactory('cortex-debug', this),
            vscode.commands.registerCommand('cortex-debug.rtos.refresh', this.refresh.bind(this))
        );
    }

    public createDebugAdapterTracker(
        session: vscode.DebugSession
    ): vscode.ProviderResult<vscode.DebugAdapterTracker> {
        return new DebuggerTracker(session, this);
    }

    public async onStopped(session: vscode.DebugSession, frameId: number) {
        for (const rtosSession of this.sessionMap.values()) {
            if (rtosSession.session.id === session.id) {
                await rtosSession.onStopped(frameId);
                this.provider.update();
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

    public refresh() {
        for (const rtosSession of this.sessionMap.values()) {
            rtosSession.refresh();
        }
    }

    public getHtml() {
        if (this.sessionMap.size === 0) {
            return '<p>No active/compatible debug sessions running.</p>\n';
        }
        let ret = '';
        for (const rtosSession of this.sessionMap.values()) {
            const rtosHtml = rtosSession.html;
            const name = `Session Name: "${rtosSession.session.name}"`;
            if (!rtosSession.rtos) {
                const nameAndStatus = name + ' -- No RTOS detected';
                ret += /*html*/`<h4>${nameAndStatus}</h4>\n`;
            } else {
                const nameAndStatus = name + ', ' + rtosSession.rtos.name + ' Detected.' + (!rtosHtml ? ' (No data available yet)' : '');
                ret += /*html*/`<h4>${nameAndStatus}</h4>\n` + rtosHtml;
            }
        }
        return ret;
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

        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        this.update();

        webviewView.webview.onDidReceiveMessage((msg) => {
            switch (msg?.type) {
                case 'refresh': {
                    this.parent.refresh();
                    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
                    break;
                }
            }
        });
    }

    public update() {
        if (this.webviewView) {
            this.webviewView.webview.html = this.getHtmlForWebview(this.webviewView.webview);
        }
    }

    public getHtmlForWebview(webview: vscode.Webview): string {
        const toolkitUri = getUri(webview, this.extensionUri, [
            'node_modules',
            '@vscode',
            'webview-ui-toolkit',
            'dist',
            'toolkit.js'
        ]);
        // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'rtos.js'));
        const rtosStyle = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'rtos.css'));

        const body = this.parent.getHtml();

        // Use a nonce to only allow a specific script to be run.
        const nonce = getNonce();
        return /*html*/`
            <!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<!--
					Use a content security policy to only allow loading images from https or from our extension directory,
					and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${rtosStyle}" rel="stylesheet">
				
				<title>RTOS Threads</title>
			</head>
			<body>
                <!--vscode-button id="refresh-button" appearance="primary">Refresh</vscode-button-->
                ${body}
                <script type="module" nonce="${nonce}" src="${toolkitUri}"></script>
				<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
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
