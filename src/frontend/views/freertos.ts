import { TreeItem, TreeDataProvider, EventEmitter, Event, TreeItemCollapsibleState, debug, workspace, ProviderResult} from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { NodeSetting } from '../../common';
import reporting from '../../reporting';
import { BaseNode } from './nodes/basenode';
import { MessageNode } from './nodes/messagenode';
import { FreertosTask, FreertosTaskNode } from './nodes/freertostasknode';
import { FreeRTOSTaskFieldNode } from './nodes/freertostaskfieldnode';

export class FreeRTOSTreeProvider implements TreeDataProvider<BaseNode> {
    // tslint:disable-next-line:variable-name
    public _onDidChangeTreeData: EventEmitter<BaseNode | undefined> = new EventEmitter<BaseNode | undefined>();
    public readonly onDidChangeTreeData: Event<BaseNode | undefined> = this._onDidChangeTreeData.event;

    private loaded: boolean = false;
    private taskNodes: FreertosTaskNode[];

    constructor() {
        this.taskNodes = [];
    }

    public refresh(): void {
        if (debug.activeDebugSession) {
            debug.activeDebugSession.customRequest('read-freertos').then((data) => {

                // we will get some data back for every task (just address and state if nothing else has changed)
                // we can remove any task that is not in the return data

                for (const taskData of data.tasks) {
                    const taskNode = this.taskNodes.findIndex((taskNode) => taskNode.task.address === taskData.address);
                    if (taskNode > -1) {
                        this.taskNodes[taskNode].task = {...this.taskNodes[taskNode].task, ...taskData};
                    }
                    else {
                        const task: FreertosTask = {
                            name: taskData.name ? taskData.name : `@${taskData.address}`,
                            priority: taskData.priority,
                            stackTop: taskData.stackTop,
                            stackStart: taskData.stackStart,
                            stackEnd: taskData.stackEnd ? taskData.stackEnd : 'unknown',
                            state: taskData.state,
                            address: taskData.address
                        };

                        const node = new FreertosTaskNode(task);
                        this.taskNodes.push(node);
                    }
                }
            });

            this._onDidChangeTreeData.fire();
        }
    }

    public _refreshRegisterValues() {
    }

    public getTreeItem(element: BaseNode): TreeItem | Promise<TreeItem> {
        return element.getTreeItem();
    }

    public createRegisters(regInfo: string[]) {

    }

    public getChildren(element?: BaseNode): ProviderResult<BaseNode[]> {
        if (!this.loaded) {
            return [new MessageNode('Not in active debug session.')];
        }
        else if (this.taskNodes.length === 0) {
            return [new MessageNode('No tasks found.')];
        }
        else if (this.taskNodes.length > 0) {
            return element ? element.getChildren() : this.taskNodes;
        }
        else {
            return [];
        }
    }

    public _saveState(fspath: string) {
    }

    public debugSessionTerminated() {
        this.loaded = false;
        this._onDidChangeTreeData.fire();
    }

    public debugSessionStarted() {
        this.loaded = true;
        this._onDidChangeTreeData.fire();
    }

    public debugStopped() {
        this.refresh();
        this._onDidChangeTreeData.fire();
    }

    public debugContinued() {

    }
}
