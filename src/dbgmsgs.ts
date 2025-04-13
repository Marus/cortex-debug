import * as vscode from 'vscode';
import { HrTimer } from './common';

export class CortexDebugChannel {
    private static vscodeDebugChannel: vscode.OutputChannel;
    private static globalHrTimer = new HrTimer();

    public static createDebugChanne() {
        if (!CortexDebugChannel.vscodeDebugChannel) {
            const options: object = {
                log: true
            };
            // (options as any).loglevel = vscode.LogLevel.Trace;
            CortexDebugChannel.vscodeDebugChannel = vscode.window.createOutputChannel('Cortex-Debug');
            CortexDebugChannel.vscodeDebugChannel.hide();
        }
    }

    public static debugMessage(msg: string): void {
        if (CortexDebugChannel.vscodeDebugChannel) {
            const ts = CortexDebugChannel.globalHrTimer.createDateTimestamp();
            CortexDebugChannel.vscodeDebugChannel.appendLine(ts + ' ' + msg);
        }
    }
}
