export interface CommonGraphConfiguration {
    label: string;
}

export interface TimeseriesGraphConfiguration extends CommonGraphConfiguration {
    type: 'realtime';
    minimum: number;
    maximum: number;
    timespan: number;
    plots: Array<{
        graphId: string,
        label: string,
        color: string
    }>;
}

export interface XYGraphConfiguration extends CommonGraphConfiguration {
    type: 'x-y-plot';
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

export type GraphConfiguration = TimeseriesGraphConfiguration | XYGraphConfiguration;

export interface GrapherMessageBase {
    timestamp?: number;
}

export interface GrapherUnsupportedMessage extends GrapherMessageBase {
    type: '';
}

export interface GrapherInitMessage extends GrapherMessageBase {
    type: 'init';
}

export interface GrapherStatusMessage extends GrapherMessageBase {
    type: 'status';
    status: 'stopped' | 'terminated' | 'continued';
}

export interface GrapherDataMessage extends GrapherMessageBase {
    type: 'data';
    id: string;
    data: number;
}

export type GrapherProgramStats = Array<[ string, number ]>;

export interface GrapherProgramCounterMessage extends GrapherMessageBase {
    type: 'program-counter';
    function: string;
    counter: number;
}

export interface GrapherConfigurationMessage extends GrapherMessageBase {
    type: 'configure';
    graphs: [ GraphConfiguration ];
    status: 'stopped' | 'terminated' | 'continued';
}

export type GrapherMessage =
    GrapherUnsupportedMessage |
    GrapherInitMessage |
    GrapherStatusMessage |
    GrapherDataMessage |
    GrapherProgramCounterMessage |
    GrapherConfigurationMessage;
