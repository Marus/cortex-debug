import { assert } from 'console';
import * as vscode from 'vscode';
import { ConfigurationArguments, ChainedConfig } from '../common';
import { RTTCore, SWOCore } from './swo/core';
import { SWORTTSource } from './swo/sources/common';
import { SocketRTTSource } from './swo/sources/socket';

export class CDebugSession {
    public swo: SWOCore = null;
    public rtt: RTTCore = null;
    public swoSource: SWORTTSource = null;
    public rttPortMap: { [channel: number]: SocketRTTSource} = {};
    // Status can be 'none' before the session actually starts but this object
    // may have been created before that actually happens due to SWO, RTT, chained
    // launches, etc
    public status: 'started' | 'stopped' | 'running' | 'exited' | 'none' = 'none';

    protected parent: CDebugSession = null;
    protected children: CDebugSession[] = [];
    private static ROOT = new CDebugSession(null, null);     // Dummy node for all sessions trees
    public static CurrentSessions: CDebugSession[] = [];     // This may stuff that never fully got created

    constructor(public session: vscode.DebugSession, public config: ConfigurationArguments | vscode.DebugConfiguration) {
        if (session) {
            CDebugSession.CurrentSessions.push(this);
        }
    }

    public getRoot() {
        return this.parent && this.parent.parent ? this.parent.getRoot() : this;
    }

    public hasChildren(): boolean {
        return this.children.length > 0;
    }

    public moveToRoot() {
        if (this.parent) {
            this.remove();
            CDebugSession.ROOT.add(this);
        }
    }

    public broadcastDFS(cb: (s: CDebugSession) => void, fromRoot: boolean = true) {
        const root = fromRoot ? this.getRoot() : this;
        root._broadcastDFS(cb);
    }

    protected _broadcastDFS(cb: (s: CDebugSession) => void) {
        for (const child of this.children) {
            child._broadcastDFS(cb);
        }
        cb(this);
    }

    private remove() {
        this.parent.removeChild(this);
    }

    public add(child: CDebugSession) {
        assert(!child.parent, 'child already has a parent?');
        if (this.children.find((x) => x === child)) {
            assert(false, 'child already exists');
        } else {
            this.children.push(child);
            child.parent = this;
        }
    }

    private removeChild(child: CDebugSession) {
        this.children = this.children.filter((x) => x !== child);
        child.parent = null;
    }

    public stopAll() {
        this.broadcastDFS((arg) => {
            vscode.debug.stopDebugging(arg.session);
        });
    }

    public static RemoveSession(session: vscode.DebugSession) {
        const s = CDebugSession.FindSession(session);
        if (s) {
            s.status = 'exited';
            s.remove();
            CDebugSession.CurrentSessions = CDebugSession.CurrentSessions.filter((s) => s.session.id !== session.id);
        } else {
            console.error(`Where did session ${session.id} go?`);
        }
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

    // Call this method after session actually started. It inserts new session into the session tree
    public static NewSessionStarted(session: vscode.DebugSession): CDebugSession {
        const newSession = CDebugSession.GetSession(session);       // May have already in the global list
        newSession.status = 'started';
        if (session.parentSession && (session.parentSession.type === 'cortex-debug')) {
            const parent = CDebugSession.FindSession(session.parentSession);
            if (!parent) {
                vscode.window.showErrorMessage(
                    `Internal Error: Have parent for new session, Parent = ${session.parentSession.name} but can't find it`);
            } else {
                parent.add(newSession);     // Insert into tree
            }
        } else {
            CDebugSession.ROOT.add(newSession);
        }
        return newSession;
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
