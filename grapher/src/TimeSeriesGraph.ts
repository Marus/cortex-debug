import * as d3 from 'd3';
import { TimeseriesGraphConfiguration, GraphPoint, Graph } from './basic';
import { GraphDataSource } from './datasource';

interface Path {
    port: number;
    path: any;
}

export class TimeseriesGraph implements Graph {
    label: string;

    x: d3.ScaleTime<number, number>;
    y: d3.ScaleLinear<number, number>;

    span: number = 10 * 1000;

    stopped: boolean = false;

    line: d3.Line<GraphPoint>;

    svg: any;
    g: any;
    yAxis: any;
    xAxis: any;
    paths: Path[] = [];

    height: number =  275;
    width: number = 700;
    margins = {
        top: 30,
        right: 0,
        left: 40,
        bottom: 60
    };

    constructor(protected configuration: TimeseriesGraphConfiguration, private datasource: GraphDataSource) {
        let now = new Date().getTime();

        this.x = d3.scaleTime().range([0, this.width]).domain([now - this.span, now]);
        this.y = d3.scaleLinear().range([this.height, 0]).domain([configuration.minimum, configuration.maximum]);

        this.line = d3.line<GraphPoint>().x(d => this.x(d.timestamp)).y(d => this.y(d.value));

        let wrapper = d3.select('.graph-container').append('div').attr('class', 'graph-wrapper');
        wrapper.append('h3').text(configuration.label);

        this.svg = wrapper.append('svg').attr('width', this.width + this.margins.left + this.margins.right).attr('height', this.height + this.margins.top + this.margins.bottom);
        this.g = this.svg.append('g').attr('transform', 'translate(' + this.margins.left + ',' + this.margins.top + ')');

        this.xAxis = this.g.append('g').attr('transform', 'translate(0,' + this.height + ')').call(d3.axisBottom(this.x));
        this.yAxis = this.g.append('g').call(d3.axisLeft(this.y));

        this.configuration.ports.forEach(port => {
            let path = this.g.append('path')
                .attr('fill', 'none')
                .attr('stroke', port.color)
                .attr('stroke-linejoin', 'round')
                .attr('stroke-linecap', 'round')
                .attr('stroke-width', 1.5);

            this.paths.push({ port: port.number, path: path });
        });

        window.requestAnimationFrame(this.updateGraph.bind(this));
    }

    stop() {
        this.stopped = true;
    }

    updateGraph() {
        if (this.stopped) { return; }

        let now = new Date().getTime();
        this.x.domain([now - this.span, now]);
        this.xAxis.call(d3.axisBottom(this.x));

        this.paths.forEach(path => {
            try {
                let data = this.datasource.getData(path.port, now - this.span, now, true);
                path.path.datum(data).attr('d', this.line);
            }
            catch (e) {
                console.log('Error Updating Plot: ', e);
            }
        });

        window.requestAnimationFrame(this.updateGraph.bind(this));
    }
}