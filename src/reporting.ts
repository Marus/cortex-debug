import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const ua = require('universal-analytics');
const uuidv4 = require('uuid/v4');

const extension = vscode.extensions.getExtension('marus25.cortex-debug');
const extensionId = extension.id;
const extensionVersion = extension.packageJSON.version;
const trackingId = 'UA-113901869-1';

let analytics: any;

let uuid: string = null;
let sessionStart: Date = null;

interface UserSettings {
    uuid: string;
}

function getUUID(): string {
    if (!uuid) {
        const settingspath = path.join(os.homedir(), '.cortex-debug');
        if (fs.existsSync(settingspath)) {
            const data = fs.readFileSync(settingspath, 'utf8');
            const settings: UserSettings = JSON.parse(data);
            uuid = settings.uuid;
        }
        else {
            uuid = uuidv4();
            const settings: UserSettings = { uuid: uuid };
            fs.writeFileSync(settingspath, JSON.stringify(settings), 'utf8');
        }
    }

    return uuid;
}

function telemetryEnabled(): boolean {
    const telemetry = vscode.workspace.getConfiguration('telemetry');
    const cortexDebug = vscode.workspace.getConfiguration('cortex-debug');

    return (telemetry.enableTelemetry && cortexDebug.enableTelemetry);
}

function activate(context: vscode.ExtensionContext) {
    if (!telemetryEnabled()) { return; }

    analytics = ua(trackingId, getUUID());
    analytics.set('extensionId', extensionId);
    analytics.set('extensionVersion', extensionVersion);
}

function deactivate() {
    if (!telemetryEnabled()) { return; }
}

function sendEvent(category, action, label, options: { [key: string]: string } = {}) {
    if (!telemetryEnabled()) { return; }

    analytics.event(category, action, label, options).send();
}

function beginSession() {
    if (!telemetryEnabled()) { return; }
    
    sessionStart = new Date();
    analytics.screenview('Debug Session', 'Cortex-Debug', extensionVersion, extensionId)
        .event('Session', 'Started', '', 0, { sessionControl: 'start' })
        .send();
}

function endSession() {
    if (!telemetryEnabled()) { return; }

    const endTime = new Date();
    const time = (endTime.getTime() - sessionStart.getTime()) / 1000;
    sessionStart = null;

    analytics.timing('Session', 'Length', time).event('Session', 'Completed', '', time, { sessionControl: 'end' }).send();
}

export default {
    beginSession: beginSession,
    endSession: endSession,
    activate: activate,
    deactivate: deactivate,
    sendEvent: sendEvent
};
