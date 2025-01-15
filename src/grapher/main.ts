import { TimeseriesGraph } from './timeseriesgraph';
import { XYGraph } from './xygraph';
import { ProgramStatsGraph } from './programstatsgraph';
import { Graph } from './types';
import { GraphDataSource } from './datasource';
import { GrapherConfigurationMessage, GrapherDataMessage, GrapherMessage, GrapherProgramCounterMessage, GrapherStatusMessage } from '@common/types';

interface VSCodeAPI {
    postMessage(msg: any): void;
    getState(): any;
    setState(state: any): void;
}

declare function acquireVsCodeApi(): VSCodeAPI;
declare const window: Window;
declare global {
    interface Window {
        datasource: GraphDataSource;
        addEventListener(event: string, callback: (event: any) => void);
    }
}

function init() {
    // let datasource: GraphDataSource = null;
    const graphs: Graph[] = [];

    function processConfiguration(message: GrapherConfigurationMessage) {
        window.datasource = new GraphDataSource();

        message.graphs.forEach((config) => {
            if (config.type === 'realtime') {
                const graph = new TimeseriesGraph(config, window.datasource);
                graphs.push(graph);
                if (message.status === 'stopped' || message.status === 'terminated') { graph.stop(); }
            }
            else if (config.type === 'x-y-plot') {
                const graph = new XYGraph(config, window.datasource);
                graphs.push(graph);
                if (message.status === 'stopped' || message.status === 'terminated') { graph.stop(); }
            }
        });

        // const psg: ProgramStatsGraph = new ProgramStatsGraph(window.datasource);
        // if (message.status === 'stopped' || message.status === 'terminated') { psg.stop(); }
        // graphs.push(psg);
    }

    function processStatus(message: GrapherStatusMessage) {
        if (message.status === 'stopped' || message.status === 'terminated') {
            graphs.forEach((g) => g.stop());
        }
        else if (message.status === 'continued') {
            graphs.forEach((g) => g.continue());
        }
    }

    function processData(message: GrapherDataMessage) {
        if (window.datasource) {
            window.datasource.receiveDataMessage(message);
        }
    }

    function processProgramCounter(message: GrapherProgramCounterMessage) {
        window.datasource.receivedProgramCounterMessage(message);
    }

    window.addEventListener('message', (event) => {
        const message: GrapherMessage = event.data;
        switch (message.type) {
            case 'configure':
                processConfiguration(message);
                break;
            case 'data':
                processData(message);
                break;
            case 'status':
                processStatus(message);
                break;
            case 'program-counter':
                processProgramCounter(message);
                break;
            default:
                console.log(`Got unrecognized message type: ${message.type}`);
                break;
        }
    });

    const vscode = acquireVsCodeApi();
    vscode.postMessage({ type: 'init' });
}

init();
