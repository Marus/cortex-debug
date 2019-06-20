import * as d3 from 'd3';
import { Graph } from './types';
import { GraphDataSource } from './datasource';

declare const window: Window;
declare global {
    interface Window {
        datasource: GraphDataSource;
        addEventListener(event: string, callback: (event: any) => void);
        requestAnimationFrame(callback: () => void);
    }
}

interface FunctionStat {
    name: string;
    count: number;
}

function djb2(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i); /* hash * 33 + c */
    }
    return hash;
}

// tslint:disable-next-line:max-line-length
const COLORS: string[] = ['#C0392B', '#9B59B6', '#2980B9', '#1ABC9C', '#16A085', '#F1C40F', '#E67E22', '#D35400', '#E74C3C', '#8E44AD', '#3498DB', '#2ECC71', '#F39C12'];

function hashStringToColor(str: string): string {
    if (!str || str === '**Other**') { return '#CCCCCC'; }
    else { return COLORS[Math.abs(djb2(str)) % COLORS.length]; }
}

export class ProgramStatsGraph implements Graph {
    private svg: any;
    private width: number = 700;
    private height: number = 350;

    private margins = {
        top: 30,
        right: 20,
        left: 20,
        bottom: 30
    };

    private pie: any;
    private g: any;
    private arc: any;
    private label: any;
    private legend: any;
    private path: any;

    private stopped: boolean = false;

    private processData(data: {[name: string]: number}) {
        let counts: FunctionStat[] = [];

        // tslint:disable-next-line:forin
        for (const key in data) {
            counts.push({ name: key, count: data[key] });
        }

        counts.sort((a, b) => {
            if (a.count < b.count) { return 1; }
            else if (a.count > b.count) { return -1; }
            else { return 0; }
        });

        if (counts.length > 10) {
            const top9 = counts.slice(0, 9);
            const remainder = counts.slice(9);

            let total = 0;
            remainder.forEach((c) => total += c.count);

            counts = top9;
            counts.push({ name: '**Other**', count: total });
        }

        return counts;
    }

    constructor(private datasource: GraphDataSource) {
        const wrapper = d3.select('.graph-container').append('div').attr('class', 'graph-wrapper');
        wrapper.append('h3').text('Program Stats');

        this.svg = wrapper.append('svg')
            .attr('width', this.width + this.margins.left + this.margins.right)
            .attr('height', this.height + this.margins.top + this.margins.bottom);
        this.g = this.svg.append('g').attr('transform', `translate(${(this.height / 2) + this.margins.left}, ${(this.height / 2) + this.margins.top})`);
        this.legend = this.svg.append('g').attr('transform', `translate(${this.height + this.margins.left + 40}, ${this.margins.top})`);

        this.pie = d3.pie<FunctionStat>().sort(null).value((d) => d.count);

        const radius = this.height / 2;

        this.path = d3.arc()
            .outerRadius(radius)
            .innerRadius(0);

        window.requestAnimationFrame(this.updateGraph.bind(this));
    }

    public updateGraph() {
        if (!this.stopped) {
            const data = this.processData(this.datasource.getProgramCounterStats());

            this.g.selectAll('.arc').remove();
            const arc = this.g.selectAll('.arc')
                .data(this.pie(data))
                .enter().append('g').attr('class', 'arc');

            arc.append('path')
                .attr('d', this.path)
                .attr('fill', (d: any, index: number) => hashStringToColor(d.data.name))
                .attr('fill-opacity', 0.65)
                .attr('stroke', (d: any, index: number) => hashStringToColor(d.data.name));

            this.legend.selectAll('.entry').remove();
            const entry = this.legend.selectAll('.entry')
                .data(data)
                .enter().append('g').attr('class', 'entry').attr('transform', (d: any, index: number) => `translate(0,${index * 35})`);

            entry.append('rect')
                .attr('width', 30)
                .attr('height', 20)
                .attr('fill', (d: any, index: number) => hashStringToColor(d.name))
                .attr('fill-opacity', 0.65)
                .attr('stroke', (d: any, index: number) => hashStringToColor(d.name));
            entry.append('text').text((d: any) => d.name).attr('x', 40).attr('y', 15);
        }

        window.requestAnimationFrame(this.updateGraph.bind(this));
    }

    public stop() {
        this.stopped = true;
    }

    public continue() {
        this.stopped = false;
    }
}
