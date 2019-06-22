import * as d3 from 'd3';
import { Graph, XYGraphConfiguration, GraphPoint } from './types';
import { GraphDataSource } from './datasource';

declare const window: Window;
declare global {
    interface Window {
        datasource: GraphDataSource;
        addEventListener(event: string, callback: (event: any) => void);
        requestAnimationFrame(callback: () => void);
    }
}

interface XYGraphPoint {
    timestamp: number;
    x: number;
    y: number;
}

export class XYGraph implements Graph {
    private label: string;

    private x: d3.ScaleLinear<number, number>;
    private y: d3.ScaleLinear<number, number>;

    private span: number = 10 * 1000;

    private stopped: boolean = false;
    private line: d3.Line<XYGraphPoint>;

    private svg: any;
    private g: any;
    private yAxis: any;
    private xAxis: any;
    private path: any;

    private height: number = 350;
    private width: number = 350;
    private margins = {
        top: 30,
        right: 30,
        left: 40,
        bottom: 60
    };

    private currentX: number;
    private currentY: number;

    private points: XYGraphPoint[];

    constructor(protected configuration: XYGraphConfiguration, private datasource: GraphDataSource) {
        this.span = configuration.timespan * 1000;

        this.x = d3.scaleLinear().range([0, this.width]).domain([configuration.xMinimum || 0, configuration.xMaximum || 65535]);
        this.y = d3.scaleLinear().range([this.height, 0]).domain([configuration.yMinimum || 0, configuration.yMaximum || 65535]);

        this.currentX = configuration.initialX || (((configuration.xMinimum || 0) + (configuration.xMaximum || 65535)) / 2);
        this.currentY = configuration.initialY || (((configuration.yMinimum || 0) + (configuration.yMaximum || 65535)) / 2);

        this.line = d3.line<XYGraphPoint>().x((d) => this.x(d.x)).y((d) => this.y(d.y));

        const wrapper = d3.select('.graph-container').append('div').attr('class', 'graph-wrapper');
        wrapper.append('h3').text(configuration.label);

        // tslint:disable-next-line:max-line-length
        this.svg = wrapper.append('svg').attr('width', this.width + this.margins.left + this.margins.right).attr('height', this.height + this.margins.top + this.margins.bottom);
        this.g = this.svg.append('g').attr('transform', `translate(${this.margins.left},${this.margins.top})`);

        this.xAxis = this.g.append('g').attr('transform', `translate(0,${this.height})`).call(d3.axisBottom(this.x));
        this.yAxis = this.g.append('g').call(d3.axisLeft(this.y));

        datasource.subscribe(configuration.xGraphId, this.receivedX.bind(this));
        datasource.subscribe(configuration.yGraphId, this.receivedY.bind(this));

        this.path = this.g.append('path')
            .attr('fill', 'none')
            .attr('stroke', 'steelblue')
            .attr('stroke-linejoin', 'round')
            .attr('stroke-linecap', 'round')
            .attr('stroke-width', 1.5);

        window.requestAnimationFrame(this.updateGraph.bind(this));

        this.points = [];
    }

    public stop() {
        this.stopped = true;
    }

    public continue() {
        this.stopped = false;
    }

    public receivedX(point: GraphPoint) {
        const xy = {
            timestamp: point.timestamp,
            y: this.currentY,
            x: point.value
        };

        this.currentX = point.value;
        this.points.push(xy);
    }

    public receivedY(point: GraphPoint) {
        const xy = {
            timestamp: point.timestamp,
            y: point.value,
            x: this.currentX
        };

        this.currentY = point.value;
        this.points.push(xy);
    }

    public updateGraph() {
        if (!this.stopped) {
            try {
                const now = new Date().getTime();
                const limit = now - this.span;

                if (this.points.length > 0) {
                    const last = this.points[this.points.length - 1];

                    this.points = this.points.filter((xy) => xy.timestamp >= limit);
                    if (this.points.length === 0) { this.points.push(last); }

                    this.path.datum(this.points).attr('d', this.line);
                }
            }
            catch (e) {
                console.log('Error Updating Plot: ', e);
            }
        }

        window.requestAnimationFrame(this.updateGraph.bind(this));
    }
}
