import { GraphPoint, GrapherDataMessage, GrapherProgramCounterMessage } from './types';

export class GraphDataSource {
    private data: {
        [graphId: string]: GraphPoint[]
    } = {};

    private subscriptions: {
        // tslint:disable-next-line:ban-types
        [graphId: string]: Function[];
    } = {};

    private counterStats: {
        [fnName: string]: number;
    } = {};

    constructor() {
    }

    public receivedProgramCounterMessage(message: GrapherProgramCounterMessage) {
        if (!this.counterStats[message.function]) { this.counterStats[message.function] = 0; }
        this.counterStats[message.function] += 1;
    }

    public getProgramCounterStats() {
        return { ...this.counterStats };
    }

    public receiveDataMessage(message: GrapherDataMessage) {
        const gp: GraphPoint = {
            timestamp: message.timestamp,
            value: message.data
        };

        const graphId = message.id;
        if (!this.data[graphId]) { this.data[graphId] = []; }

        if (this.data[graphId]) {
            this.data[graphId].push(gp);
        }

        if (this.subscriptions[graphId]) {
            this.subscriptions[graphId].forEach((fn) => fn(gp));
        }
    }

    public getData(graphId: string, start: number, end: number, pad: boolean = true): GraphPoint[] {
        let data: GraphPoint[] = this.data[graphId];
        if (!data) { return []; }

        data = data.filter((gp) => gp.timestamp >= start && gp.timestamp <= end);
        if (pad && data.length >= 1) {
            const ep = data[data.length - 1];
            data.push({ timestamp: end, value: ep.value });
        }

        return data;
    }

    public sampleData(graphId: string, sampleSize: number, start: number = null, end: number = null): GraphPoint[] {
        let data: GraphPoint[] = this.data[graphId];
        if (!data) { return []; }

        if (start === null) { start = 0; }
        if (end == null) { end = new Date().getTime(); }

        data = data.filter((gp) => gp.timestamp >= start && gp.timestamp <= end);

        if (data.length > sampleSize * 1.5) {
            const sampleRate = Math.round(data.length / sampleSize);
            data = data.filter((gp, idx) => idx % sampleRate === 0);
        }

        return data;
    }

    public oldestPoint(graphId: string): GraphPoint {
        return this.data[graphId] ? this.data[graphId][0] : null;
    }

    public subscribe(graphId: string, callback: (point: GraphPoint) => void) {
        if (!this.subscriptions[graphId]) { this.subscriptions[graphId] = []; }
        this.subscriptions[graphId].push(callback);
    }
}
