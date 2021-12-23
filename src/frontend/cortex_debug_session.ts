import * as vscode from 'vscode';
import { ConfigurationArguments, ChainedConfig } from '../common';

export class CDebugSession {
    public static CurrentSessions: CDebugSession[] = [];

    constructor(public session: vscode.DebugSession, public config: ConfigurationArguments | vscode.DebugConfiguration) {
        CDebugSession.CurrentSessions.push(this);
    }

    public static RemoveSession(session: vscode.DebugSession) {
        CDebugSession.CurrentSessions = CDebugSession.CurrentSessions.filter((s) => s.session.id !== session.id);
    }
    public static FindSession(session: vscode.DebugSession) {
        return CDebugSession.FindSessionById(session.id);
    }
    public static FindSessionById(id: string) {
        const ret = CDebugSession.CurrentSessions.find((x) => x.session.id === id);
        return ret;
    }
    public static GetSession(session: vscode.DebugSession, config?: ConfigurationArguments | undefined): CDebugSession {
        const prev = CDebugSession.FindSessionById(session.id);
        if (prev) { return prev; }
        return new CDebugSession(session, config || session.configuration);
    }
}

export class CDebugChainedSessionItem {
    public static SessionsStack: CDebugChainedSessionItem[] = [];
    constructor(public parent: CDebugSession, public config: ChainedConfig, public options: vscode.DebugSessionOptions) {
        CDebugChainedSessionItem.SessionsStack.push(this);
    }

    public static FindByName(name: string): CDebugChainedSessionItem {
        return this.SessionsStack.find((x) => x.config.name === name);
    }

    public static RemoveItem(item: CDebugChainedSessionItem) {
        CDebugChainedSessionItem.SessionsStack = CDebugChainedSessionItem.SessionsStack.filter((x) => x !== item);
    }
}
