import * as vscode from 'vscode';
import TelemetryReporter from 'vscode-extension-telemetry';
let reporter: TelemetryReporter;

const extension = vscode.extensions.getExtension('marus.cortex-debug');

const extensionId = extension.id;
const extensionVersion = extension.packageJSON.version;
const key = '1b93f859-5da5-4127-aa82-edcf77f7ab3e';

function activate(context: vscode.ExtensionContext) {
	reporter = new TelemetryReporter(extensionId, extensionVersion, key)
}

function deactivate() {
	if (reporter) { reporter.dispose(); }
}

function sendEvent(name: string, properties: { [key: string]: string; }, measures: { [key: string]: number; }) {
	reporter.sendTelemetryEvent(name, properties, measures);
}

export default {
	activate: activate,
	deactivate: deactivate,
	sendEvent: sendEvent
};