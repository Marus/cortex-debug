import { GraphPoint } from './basic';

export class GraphDataSource {
    data: {
        [port: number]: GraphPoint[]
    } = {};

    subscriptions: {
        [port: number]: Function[];
    } = {};

    constructor(ports: any[]) {
        ports.forEach(p => this.addPort(p));
    }

    private addPort(port: number) {
        this.data[port] = [];
    }

    public receiveMessage(message: any) {
        var gp: GraphPoint = {
            timestamp: message.timestamp,
            value: message.data,
            raw: message.raw
        };

        let port = message.port;
        if (this.data[port]) {
            this.data[port].push(gp);
        }

        if (this.subscriptions[port]) {
            this.subscriptions[port].forEach(fn => fn(gp));
        }
    }

    public getData(port: number, start: number, end: number, pad: boolean = true) {
        let data: GraphPoint[] = this.data[port];
        if (!data) { return []; }

        data = data.filter(gp => gp.timestamp >= start && gp.timestamp <= end);
        if (pad && data.length >= 1) {
            let ep = data[data.length - 1];
            data.push({ timestamp: end, value: ep.value, raw: ep.raw });
        }

        return data;
    }

    subscribe(port: number, callback: (point: GraphPoint) => void) {
        if (!this.subscriptions[port]) { this.subscriptions[port] = []; }
        this.subscriptions[port].push(callback);
    }
}