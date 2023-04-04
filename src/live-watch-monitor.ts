import { DebugProtocol } from '@vscode/debugprotocol';
import { Handles } from '@vscode/debugadapter';
import { MI2 } from './backend/mi2/mi2';
import { decodeReference, ExtendedVariable, GDBDebugSession, RequestQueue } from './gdb';
import { MIError, VariableObject } from './backend/backend';
import * as crypto from 'crypto';
import { MINode } from './backend/mi_parse';
import { expandValue } from './backend/gdb_expansion';

export type VariableType = string | VariableObject | ExtendedVariable;
export interface NameToVarChangeInfo {
    [name: string]: any;
}
export class VariablesHandler {
    public variableHandles = new Handles<VariableType>(256);
    public variableHandlesReverse: { [id: string]: number } = {};
    public cachedChangeList: NameToVarChangeInfo | undefined;

    constructor(
        public isBusy: () => boolean,
        public busyError: (r: DebugProtocol.Response, a: any) => void
    ) { }

    public async clearCachedVars(miDebugger: MI2) {
        if (this.cachedChangeList) {
            const poromises = [];
            for (const name of Object.keys(this.cachedChangeList)) {
                poromises.push(miDebugger.sendCommand(`var-delete ${name}`));
            }
            this.cachedChangeList = {};
            try {
                await Promise.allSettled(poromises);
            }
            catch (e) {
            }
        }
    }

    public refreshCachedChangeList(miDebugger: MI2, resolve) {
        this.cachedChangeList = {};
        miDebugger.varUpdate('*', -1, -1).then((changes: MINode) => {
            const changelist = changes.result('changelist');
            for (const change of changelist || []) {
                const name = MINode.valueOf(change, 'name');
                this.cachedChangeList[name] = change;
                const inScope = MINode.valueOf(change, 'in_scope');
                const typeChanged  = MINode.valueOf(change, 'type_changed');
                if ((inScope === 'false') || (typeChanged === 'true')) {
                    // If one of these conditions happened, abandon the entire cache. TODO: Optimize later
                    this.cachedChangeList = undefined;
                    break;
                }
                const vId = this.variableHandlesReverse[name];
                const v = this.variableHandles.get(vId) as any;
                v.applyChanges(change);

            }
        }).finally (() => {
            resolve();
        });
    }

    public createVariable(arg: VariableType, options?: any) {
        if (options) {
            return this.variableHandles.create(new ExtendedVariable(arg, options));
        } else {
            return this.variableHandles.create(arg);
        }
    }

    public findOrCreateVariable(varObj: VariableObject): number {
        let id: number;
        if (this.variableHandlesReverse.hasOwnProperty(varObj.name)) {
            id = this.variableHandlesReverse[varObj.name];
        } else {
            id = this.createVariable(varObj);
            this.variableHandlesReverse[varObj.name] = id;
        }
        return varObj.isCompound() ? id : 0;
    }

    private evaluateQ = new RequestQueue<DebugProtocol.EvaluateResponse, DebugProtocol.EvaluateArguments>();
    public evaluateRequest(
        r: DebugProtocol.EvaluateResponse, a: DebugProtocol.EvaluateArguments,
        miDebugger: MI2, session: GDBDebugSession, forceNoFrameId = false): Promise<void> {
        a.context = a.context || 'hover';
        if (a.context !== 'repl') {
            if (this.isBusy()) {
                this.busyError(r, a);
                return Promise.resolve();
            }
        }

        const doit = (
            response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments,
            // tslint:disable-next-line: variable-name
            _pendContinue: any, miDebugger: MI2, session: GDBDebugSession) => {
            return new Promise<void>(async (resolve) => {
                if (this.isBusy() && (a.context !== 'repl')) {
                    this.busyError(response, args);
                    resolve();
                    return;
                }

                // Spec says if 'frameId' is specified, evaluate in the scope specified or in the global scope. Well,
                // we don't have a way to specify global scope ... use floating variable.
                let threadId = session.stoppedThreadId || 1;
                let frameId = 0;
                if (forceNoFrameId) {
                    threadId = frameId = -1;
                    args.frameId = undefined;
                } else if (args.frameId !== undefined) {
                    [threadId, frameId] = decodeReference(args.frameId);
                }

                if (args.context !== 'repl') {
                    try {
                        const exp = args.expression;
                        const hasher = crypto.createHash('sha256');
                        hasher.update(exp);
                        if (!forceNoFrameId && (args.frameId !== undefined)) {
                            hasher.update(args.frameId.toString(16));
                        }
                        const exprName = hasher.digest('hex');
                        const varObjName = `${args.context}_${exprName}`;
                        let varObj: VariableObject;
                        let forceCreate = false;
                        try {
                            let varId = this.variableHandlesReverse[varObjName];
                            const cachedChange = this.cachedChangeList && this.cachedChangeList[varObjName];
                            let changelist;
                            if (cachedChange) {
                                changelist = [];
                            } else if (this.cachedChangeList && (varId !== undefined)) {
                                changelist = [];
                            } else {
                                const changes = await miDebugger.varUpdate(varObjName, threadId, frameId);
                                changelist = changes.result('changelist') ?? [];
                            }
                            for (const change of changelist) {
                                const inScope = MINode.valueOf(change, 'in_scope');
                                if (inScope === 'true') {
                                    const name = MINode.valueOf(change, 'name');
                                    const vId = this.variableHandlesReverse[name];
                                    const v = this.variableHandles.get(vId) as any;
                                    v.applyChanges(change);
                                    if (this.cachedChangeList) {
                                        this.cachedChangeList[name] = change;
                                    }
                                } else {
                                    const msg = `${exp} currently not in scope`;
                                    await miDebugger.sendCommand(`var-delete ${varObjName}`);
                                    if (session.args.showDevDebugOutput) {
                                        session.handleMsg('log', `Expression ${msg}. Will try to create again\n`);
                                    }
                                    forceCreate = true;
                                    throw new Error(msg);
                                }
                            }
                            varId = this.variableHandlesReverse[varObjName];
                            varObj = this.variableHandles.get(varId) as any;
                        }
                        catch (err) {
                            if (!this.isBusy() && (forceCreate || ((err instanceof MIError && err.message === 'Variable object not found')))) {
                                if (this.cachedChangeList) {
                                    delete this.cachedChangeList[varObjName];
                                }
                                try {
                                    if (forceNoFrameId || (args.frameId === undefined)) {
                                        varObj = await miDebugger.varCreate(0, exp, varObjName, '@');  // Create floating variable
                                    } else {
                                        varObj = await miDebugger.varCreate(0, exp, varObjName, '*', threadId, frameId);
                                    }
                                    const varId = this.findOrCreateVariable(varObj);
                                    varObj.exp = exp;
                                    varObj.id = varId;
                                }
                                catch (e) {
                                    throw e;
                                }
                            }
                            else {
                                throw err;
                            }
                        }

                        response.body = varObj.toProtocolEvaluateResponseBody();
                        response.success = true;
                        session.sendResponse(response);
                    }
                    catch (err) {
                        if (this.isBusy()) {
                            this.busyError(response, args);
                        } else {
                            response.body = {
                                result: (args.context === 'hover') ? null : `<${err.toString()}>`,
                                variablesReference: 0
                            };
                            session.sendResponse(response);
                            if (session.args.showDevDebugOutput) {
                                session.handleMsg('stderr', args.context + ' ' + err.toString());
                            }
                        }
                        // this.sendErrorResponse(response, 7, err.toString());
                    }
                    finally {
                        resolve();
                    }
                } else {        // This is an 'repl'
                    try {
                        miDebugger.sendUserInput(args.expression).then((output) => {
                            if (typeof output === 'undefined') {
                                response.body = {
                                    result: '',
                                    variablesReference: 0
                                };
                            }
                            else {
                                response.body = {
                                    result: JSON.stringify(output),
                                    variablesReference: 0
                                };
                            }
                            session.sendResponse(response);
                            resolve();
                        }, (msg) => {
                            session.sendErrorResponsePub(response, 8, msg.toString());
                            resolve();
                        });
                    }
                    catch (e) {
                        session.sendErrorResponsePub(response, 8, e.toString());
                        resolve();
                    }
                }
            });
        };

        return this.evaluateQ.add(doit, r, a, miDebugger, session);
    }

    public getCachedChilren(pVar: VariableObject): VariableObject[] | undefined {
        if (!this.cachedChangeList) { return undefined; }
        const keys = Object.keys(pVar.children);
        if (keys.length === 0) { return undefined; }        // We don't have previous children, force a refresh
        const ret = [];
        for (const key of keys) {
            const gdbVaName = pVar.children[key];
            const childId = this.variableHandlesReverse[gdbVaName];
            if (childId === undefined) {
                return undefined;
            }
            const childObj = this.variableHandles.get(childId) as any;
            ret.push(childObj);
        }
        return ret;
    }

    public async variablesChildrenRequest(
        response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments,
        miDebugger: MI2, session: GDBDebugSession): Promise<void> {
        response.body = { variables: [] };
        if (!args.variablesReference) {
            // This should only be called to expand additional variable for a valid parent
            session.sendResponse(response);
            return;
        }
        let id: number | string | VariableObject | ExtendedVariable;
        id = this.variableHandles.get(args.variablesReference);
        if (typeof id === 'object') {
            if (id instanceof VariableObject) {
                const pVar = id as VariableObject;

                // Variable members
                let children: VariableObject[];
                const childMap: { [name: string]: number } = {};
                try {
                    let vars = [];
                    children = this.getCachedChilren(pVar);
                    if (children) {
                        for (const child of children) {
                            vars.push(child.toProtocolVariable());
                        }
                    } else {
                        children = await miDebugger.varListChildren(args.variablesReference, id.name);
                        pVar.children = {};     // Clear in case type changed, dynamic variable, etc.
                        vars = children.map((child) => {
                            const varId = this.findOrCreateVariable(child);
                            child.id = varId;
                            if (/^\d+$/.test(child.exp)) {
                                child.fullExp = `${pVar.fullExp || pVar.exp}[${child.exp}]`;
                            }
                            else {
                                let suffix = '.' + child.exp;                   // A normal suffix
                                if (child.exp.startsWith('<anonymous')) {       // We can have duplicates!!
                                    const prev = childMap[child.exp];
                                    if (prev) {
                                        childMap[child.exp] = prev + 1;
                                        child.exp += '#' + prev.toString(10);
                                    }
                                    childMap[child.exp] = 1;
                                    suffix = '';    // Anonymous ones don't have a suffix. Have to use parent name
                                } else {
                                    // The full-name is not always derivable from the parent and child info. Esp. children
                                    // of anonymous stuff. Might as well store all of them or set-value will not work.
                                    pVar.children[child.exp] = child.name;
                                }
                                child.fullExp = `${pVar.fullExp || pVar.exp}${suffix}`;
                            }
                            return child.toProtocolVariable();
                        });
                    }

                    response.body = {
                        variables: vars
                    };
                    session.sendResponse(response);
                }
                catch (err) {
                    session.sendErrorResponsePub(response, 1, `Could not expand variable: ${err}`);
                }
            } else if (id instanceof ExtendedVariable) {
                const variables: DebugProtocol.Variable[] = [];

                const varReq = id;
                if (varReq.options.arg) {
                    const strArr = [];
                    let argsPart = true;
                    let arrIndex = 0;
                    const submit = () => {
                        response.body = {
                            variables: strArr
                        };
                        session.sendResponse(response);
                    };
                    const addOne = async () => {
                        const variable = await miDebugger.evalExpression(JSON.stringify(`${varReq.name}+${arrIndex})`), -1, -1);
                        try {
                            const expanded = expandValue(this.createVariable.bind(this), variable.result('value'), varReq.name, variable);
                            if (!expanded) {
                                session.sendErrorResponsePub(response, 15, 'Could not expand variable');
                            }
                            else {
                                if (typeof expanded === 'string') {
                                    if (expanded === '<nullptr>') {
                                        if (argsPart) { argsPart = false; }
                                        else { return submit(); }
                                    }
                                    else if (expanded[0] !== '"') {
                                        strArr.push({
                                            name: '[err]',
                                            value: expanded,
                                            variablesReference: 0
                                        });
                                        return submit();
                                    }
                                    strArr.push({
                                        name: `[${(arrIndex++)}]`,
                                        value: expanded,
                                        variablesReference: 0
                                    });
                                    addOne();
                                }
                                else {
                                    strArr.push({
                                        name: '[err]',
                                        value: expanded,
                                        variablesReference: 0
                                    });
                                    submit();
                                }
                            }
                        }
                        catch (e) {
                            session.sendErrorResponsePub(response, 14, `Could not expand variable: ${e}`);
                        }
                    };
                    addOne();
                }
                else {
                    session.sendErrorResponsePub(response, 13, `Unimplemented variable request options: ${JSON.stringify(varReq.options)}`);
                }
            }
            else {
                response.body = {
                    variables: id
                };
                session.sendResponse(response);
            }
        }
        else {
            response.body = {
                variables: []
            };
            session.sendResponse(response);
        }
    }
}

export class LiveWatchMonitor {
    public miDebugger: MI2 | undefined;
    protected varHandler: VariablesHandler;
    constructor(private mainSession: GDBDebugSession) {
        this.varHandler = new VariablesHandler(
            (): boolean => false,
            (r: DebugProtocol.Response, a: any) => { }
        );
    }

    public setupEvents(mi2: MI2) {
        this.miDebugger = mi2;
        this.miDebugger.on('quit', this.quitEvent.bind(this));
        this.miDebugger.on('exited-normally', this.quitEvent.bind(this));
        this.miDebugger.on('msg', (type: string, msg: string) => {
            this.mainSession.handleMsg(type, 'LiveGDB: ' + msg);
        });

        /*
        Yes, we get all of these events and they seem to be harlmess
        const otherEvents = [
            'stopped',
            'watchpoint',
            'watchpoint-scope',
            'step-end',
            'step-out-end',
            'signal-stop',
            'running',
            'continue-failed',
            'thread-created',
            'thread-exited',
            'thread-selected',
            'thread-group-exited'
        ];
        for (const ev of otherEvents) {
            this.miDebugger.on(ev, (arg) => {
                this.mainSession.handleMsg(
                    'stderr', `Internal Error: Live watch GDB session received an unexpected event '${ev}' with arg ${arg?.toString() ?? '<empty>'}\n`);
            });
        }
        */
    }

    protected quitEvent() {
        // this.miDebugger = undefined;
    }

    public evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): Promise<void> {
        return new Promise<void>((resolve) => {
            args.frameId = undefined;       // We don't have threads or frames here. We always evaluate in global context
            this.varHandler.evaluateRequest(response, args, this.miDebugger, this.mainSession, true).finally(() => {
                if (this.mainSession.args.showDevDebugOutput) {
                    this.mainSession.handleMsg('log', `LiveGBD: Evaluated ${args.expression}\n`);
                }
                resolve();
            });
        });
    }

    public async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): Promise<void> {
        const ret = await this.varHandler.variablesChildrenRequest(response, args, this.miDebugger, this.mainSession);
        return ret;
    }

    // Calling this will also enable caching for the future of the session
    public async refreshLiveCache(args: RefreshAllArguments): Promise<void> {
        if (args.deleteAll) {
            await this.varHandler.clearCachedVars(this.miDebugger);
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
            this.varHandler.refreshCachedChangeList(this.miDebugger, resolve);
        });
    }

    private quitting = false;
    public quit() {
        try {
            if (!this.quitting) {
                this.quitting = true;
                this.miDebugger.detach();
            }
        }
        catch {}
    }
}

interface RefreshAllArguments {
    // Delete all gdb variables and the cache. This should be done when a live expression is deleted,
    // but otherwise, it is not needed
    deleteAll: boolean;
}
