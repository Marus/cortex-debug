import * as d3 from 'd3';
import { TimeseriesGraphConfiguration, GraphPoint, Graph } from './types';
import { GraphDataSource } from './datasource';

declare const window: Window;
declare global {
    interface Window {
        datasource: GraphDataSource;
        addEventListener(event: string, callback: (event: any) => void);
        requestAnimationFrame(callback: () => void);
    }
}

interface Path {
    graphId: string;
    path: any;
}

export class TimeseriesGraph implements Graph {
    public label: string;

    private x: d3.ScaleTime<number, number>;
    private y: d3.ScaleLinear<number, number>;

    private span: number = 10 * 1000;

    private stopped: boolean = false;

    private line: d3.Line<GraphPoint>;

    private svg: any;
    private g: any;
    private ag: any;
    private yAxis: any;
    private xAxis: any;
    private paths: Path[] = [];

    private height: number =  275;
    private width: number = 700;
    private margins = {
        top: 30,
        right: 0,
        left: 40,
        bottom: 60
    };

    private annotations: Array<{
        timestamp: number,
        type: string
    }> = [];

    private sg: any;
    private sx: d3.ScaleTime<number, number>;
    private sy: d3.ScaleLinear<number, number>;
    private sxAxis: any;
    private syAxis: any;
    private spaths: Path[] = [];
    private sheight = 75;
    private sline: d3.Line<GraphPoint>;
    private hrect: any;

    private start: number;

    constructor(protected configuration: TimeseriesGraphConfiguration, private datasource: GraphDataSource) {
        this.start = new Date().getTime();

        const now = this.start;

        this.span = configuration.timespan * 1000;

        this.x = d3.scaleTime().range([0, this.width]).domain([now - this.span, now]);
        this.y = d3.scaleLinear().range([this.height, 0]).domain([configuration.minimum, configuration.maximum]);

        this.line = d3.line<GraphPoint>().x((d) => this.x(d.timestamp)).y((d) => this.y(d.value));

        const wrapper = d3.select('.graph-container').append('div').attr('class', 'graph-wrapper');
        wrapper.append('h3').text(configuration.label);

        // Setup Main Graph
        const twidth = this.width + this.margins.left + this.margins.right;
        const theight = this.height + this.margins.top + this.margins.bottom + this.sheight + 50;
        this.svg = wrapper.append('svg')
            .attr('viewBox', `0 0 ${twidth} ${theight}`)
            .attr('preserveAspectRatio', 'xMidYMid meet');
        this.g = this.svg.append('g')
            .attr('transform', `translate(${this.margins.left}, ${this.margins.top})`);
        this.ag = this.g.append('g');

        this.xAxis = this.g.append('g').attr('class', 'axis x-axis')
            .attr('transform', `translate(0,${this.height})`)
            .call(d3.axisBottom(this.x));
        this.yAxis = this.g.append('g').attr('class', 'axis y-axis')
            .call(d3.axisLeft(this.y));

        // Setup Legend
        const legend = this.svg.append('g')
            .attr('class', 'legend')
            .attr('transform', `translate(${this.margins.left + 10}, ${this.margins.top + this.height + 30})`)
            .attr('stroke-width', 1)
            .attr('stroke', 'black')
            .attr('fill', 'none');

        let offset = 10;

        // Setup Summary Graph
        this.sx = d3.scaleTime().range([0, this.width]).domain([now, now + 1000]);
        this.sy = d3.scaleLinear().range([this.sheight, 0]).domain([configuration.minimum, configuration.maximum]);
        this.sg = this.svg.append('g')
            .attr('transform', `translate(${this.margins.left}, ${this.margins.top + this.height + this.margins.bottom + 25})`);
        this.sxAxis = this.sg.append('g').attr('class', 'axis x-axis')
            .attr('transform', `translate(0,${this.sheight})`)
            .call(d3.axisBottom(this.sx));
        this.syAxis = this.sg.append('g').attr('class', 'axis x-axis')
            .call(d3.axisLeft(this.sy).ticks(4));
        this.sline = d3.line<GraphPoint>().x((d) => this.sx(d.timestamp)).y((d) => this.sy(d.value));
        this.hrect = this.sg.append('rect')
            .attr('class', 'highlight-area')
            .attr('x', 0)
            .attr('y', 0)
            .attr('height', this.sheight)
            .attr('width', this.width);

        this.configuration.plots.forEach((plot, idx) => {
            const path = this.g.append('path')
                .attr('class', 'plot-line')
                .attr('stroke', plot.color)
                .attr('fill', 'none');

            this.paths.push({ graphId: plot.graphId, path: path });

            const spath = this.sg.append('path')
                .attr('class', 'plot-line thin')
                .attr('stroke', plot.color)
                .attr('fill', 'none');

            this.spaths.push({ graphId: plot.graphId, path: spath });

            const le = legend.append('g')
                .attr('class', 'legend-entry')
                .attr('transform', `translate(${offset}, 0)`);

            le.append('rect')
                .attr('width', 20)
                .attr('height', 10)
                .attr('x', 5)
                .attr('y', 10)
                .attr('fill', plot.color);

            const te = le.append('text')
                .text(`${plot.label || plot.graphId}`)
                .attr('x', 35)
                .attr('y', 20)
                .attr('class', 'label');

            offset += te.node().getComputedTextLength() + 50;
        });

        window.requestAnimationFrame(this.updateGraph.bind(this));
    }

    public stop() {
        this.stopped = true;
        this.annotations.push({ timestamp: new Date().getTime(), type: 'stopped' });
    }

    public continue() {
        this.stopped = false;
        this.annotations.push({ timestamp: new Date().getTime(), type: 'continued' });
    }

    public updateGraph() {
        if (!this.stopped) {
            const now = new Date().getTime();
            this.x.domain([now - this.span, now]);
            this.xAxis.call(d3.axisBottom(this.x));

            const visAnnotations = this.annotations.filter((a) => a.timestamp >= now - this.span && a.timestamp <= now);

            // tslint:disable-next-line:max-line-length
            const lines = this.ag.selectAll('line.annotation').data(visAnnotations).attr('x1', (d: any) => this.x(d.timestamp)).attr('x2', (d: any) => this.x(d.timestamp));
            // tslint:disable-next-line:max-line-length
            lines.enter().append('line').classed('annotation', true).attr('stroke', (d: any) => d.type === 'continued' ? 'rgba(0, 255, 0, 0.25)' : 'rgba(255, 0, 0, 0.25)').attr('stroke-width', 1).attr('y1', 0).attr('y2', this.height).attr('x1', (d: any) => this.x(d.timestamp)).attr('x2', (d: any) => this.x(d.timestamp));
            lines.exit().remove();

            this.paths.forEach((path) => {
                try {
                    const data = this.datasource.getData(path.graphId, now - this.span, now, true);
                    path.path.datum(data).attr('d', this.line);
                }
                catch (e) {
                    console.log('Error Updating Plot: ', e);
                }
            });

            let startTime = this.start;

            this.spaths.forEach((path) => {
                const oldest = this.datasource.oldestPoint(path.graphId);
                if (oldest && oldest.timestamp < startTime) { startTime = oldest.timestamp; }
            });

            this.sx.domain([startTime, now]);
            this.sxAxis.call(d3.axisBottom(this.sx));

            this.spaths.forEach((path) => {
                try {
                    const data = this.datasource.sampleData(path.graphId, this.width, startTime, now);
                    path.path.datum(data).attr('d', this.sline);
                }
                catch (e) {
                    console.log('Error Updating Plot: ', e);
                }
            });

            let st = now - this.span;
            if (st < startTime) { st = startTime; }
            const startX = this.sx(st);
            const endX = this.sx(now);
            this.hrect.attr('x', startX).attr('width', endX - startX);
        }

        window.requestAnimationFrame(this.updateGraph.bind(this));
    }
}
