import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigurationArguments } from './common';

const ua = require('universal-analytics');
const uuidv4 = require('uuid/v4');

const extension = vscode.extensions.getExtension('marus25.cortex-debug');
const extensionId = extension.id;
const extensionVersion = extension.packageJSON.version;
const trackingId = 'UA-113901869-1';

const VSCODE_VERSION_DIMENSION = 'cd1';
const EXTENSION_VERSION_DIMENSION = 'cd2';
const DEVICE_ID_DIMENSION = 'cd3';
const RTOS_TYPE_DIMENSION = 'cd4';
const GDB_SERVER_TYPE_DIMENSION = 'cd5';
const PLATFORM_TYPE_DIMENSION = 'cd6';
const PLATFORM_RELEASE_DIMENSION = 'cd7';
const NODE_VERSION_DIMENSION = 'cd8';

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
    analytics.set(EXTENSION_VERSION_DIMENSION, extensionVersion);
    analytics.set(VSCODE_VERSION_DIMENSION, vscode.version);
    analytics.set(PLATFORM_TYPE_DIMENSION, os.platform());
    analytics.set(PLATFORM_RELEASE_DIMENSION, os.release());
    analytics.set(NODE_VERSION_DIMENSION, process.versions.node);
}

function deactivate() {
    if (!telemetryEnabled()) { return; }
}

function sendEvent(category: string, action: string, label?: string, value?: number, options: { [key: string]: string } = {}) {
    if (!telemetryEnabled()) { return; }

    analytics.event(category, action, label, Math.round(value), options).send();
}

function beginSession(opts: ConfigurationArguments) {
    if (!telemetryEnabled()) { return; }

    if (opts.rtos) { analytics.set(RTOS_TYPE_DIMENSION, opts.rtos); }
    if (opts.device) { analytics.set(DEVICE_ID_DIMENSION, opts.device); }
    analytics.set(GDB_SERVER_TYPE_DIMENSION, opts.servertype);
    
    analytics.screenview('Debug Session', 'Cortex-Debug', extensionVersion, extensionId);
    analytics.event('Session', 'Started', '', 0, { sessionControl: 'start' });

    if (opts.swoConfig.enabled) {
        analytics.event('SWO', 'Used');
    }
    if (opts.graphConfig.length > 0) {
        analytics.event('Graphing', 'Used');
    }
    
    sessionStart = new Date();
    
    analytics.send();
}

function endSession() {
    if (!telemetryEnabled()) { return; }

    const endTime = new Date();
    const time = (endTime.getTime() - sessionStart.getTime()) / 1000;
    sessionStart = null;

    setTimeout(() => { analytics.event('Session', 'Completed', '', Math.round(time), { sessionControl: 'end' }).send(); }, 500);
}

export default {
    beginSession: beginSession,
    endSession: endSession,
    activate: activate,
    deactivate: deactivate,
    sendEvent: sendEvent
};
