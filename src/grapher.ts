import * as d3 from 'd3';

class Graph {
	width: number = 500;
	height: number = 200;
	groups: any = {};

	constructor(public node: any, public limit: number, public duration: number) {
		this.groups = {
			current: {
				value: 0,
				color: 'orange',
				data: d3.range(this.limit).map(_ => 0)
			},
			target: {
				value: 0,
				color: 'green',
				data: d3.range(this.limit).map(_ => 0)
			},
			output: {
				value: 0,
				color: 'grey',
				data: d3.range(this.limit).map(_ => 0)
			}
		}
	}
}