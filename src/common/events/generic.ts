import { Event } from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';

export class GenericCustomEvent extends Event implements DebugProtocol.Event {
    constructor(suffix: string, info: any) {
        super('custom-event-' + suffix, { info: info });
    }
}

export class StoppedEvent extends Event implements DebugProtocol.Event {
    public readonly body: {
        reason: string;
        description?: string;
        threadId?: number;
        text?: string;
        allThreadsStopped?: boolean;
    };

    constructor(reason: string, threadId: number, allThreadsStopped: boolean) {
        super('stopped', {
            reason: reason,
            threadId: threadId,
            allThreadsStopped: allThreadsStopped
        });
    }
}
