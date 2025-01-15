import { ConfigurationArguments } from '@common/types';
import { DebugProtocol } from '@vscode/debugprotocol';
import { EventEmitter } from 'events';
import { GDBDebugSession } from './gdb';

export enum CTIAction {
    'init',
    'pause',
    'resume'
}

export interface GDBServerController extends EventEmitter {
    portsNeeded: string[];
    name: string;

    setPorts(ports: { [name: string]: number }): void;
    setArguments(args: ConfigurationArguments): void;

    customRequest(command: string, response: DebugProtocol.Response, args: any): boolean;
    initCommands(): string[];
    launchCommands(): string[];
    attachCommands(): string[];
    resetCommands(): string[];
    allocateRTTPorts(): Promise<void>;
    swoAndRTTCommands(): string[];
    serverExecutable(): string;
    serverArguments(): string[];
    initMatch(): RegExp;
    serverLaunchStarted(): void;
    serverLaunchCompleted(): Promise<void> | void;
    debuggerLaunchStarted(obj?: GDBDebugSession): void;
    debuggerLaunchCompleted(): void;
    rttPoll?(): void;
    liveGdbInitCommands?(): string[];
    ctiStopResume?(action: CTIAction): void;
}
