export interface GraphConfiguration {
    type: string;
    label: string;
}

export interface TimeseriesGraphConfiguration extends GraphConfiguration {
    minimum: number;
    maximum: number;
    timespan: number;
    plots: Array<{
        graphId: string,
        label: string,
        color: string
    }>;
}

export interface XYGraphConfiguration extends GraphConfiguration {
    xPort: number;
    yPort: number;
    xMinimum: number;
    xMaximum: number;
    yMinimum: number;
    yMaximum: number;
    initialX: number;
    initialY: number;
    timespan: number;
    xGraphId: string;
    yGraphId: string;
}

export interface GrapherMessage {
    id: number;
    timestamp: number;
    type: 'configure' | 'status' | 'data' | 'program-counter' | 'init';
}

export interface GrapherStatusMessage extends GrapherMessage {
    status: 'stopped' | 'terminated' | 'continued';
}

export interface GrapherDataMessage extends GrapherMessage {
    data: number;
}

export interface GrapherProgramCounterMessage extends GrapherMessage {
    function: string;
    counter: number;
}

export interface GrapherConfigurationMessage extends GrapherMessage {
    graphs: [GraphConfiguration];
    status: 'stopped' | 'terminated' | 'continued';
}

export interface Graph {
    stop(): void;
    continue(): void;
}

export interface GraphPoint {
    timestamp: number;
    value: number;
}
