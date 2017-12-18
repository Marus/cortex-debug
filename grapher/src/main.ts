import { TimeseriesGraph } from './TimeSeriesGraph';
import { XYGraph } from './XYGraph';
import { GraphPoint, TimeseriesGraphConfiguration, XYGraphConfiguration, Graph } from './basic';
import { GraphDataSource } from './datasource';
import { setInterval } from 'timers';
import * as d3 from 'd3';

function buildData() {
    let limit = 60 * 1000;
    let now = new Date().getTime() - limit;
    let end = new Date().getTime();
    let data: GraphPoint[] = [];

    while (now < end) {
        let val = Math.floor(Math.random() * 1024);
        data.push({
            timestamp: now,
            value: val,
            raw: val
        });

        now += Math.floor(50 + Math.random() * 40);
    }

    setInterval(_ => {
        let now = new Date().getTime();
        let val = Math.floor(Math.random() * 1024);
        data.push({ timestamp: now, value: val, raw: val });
    }, 70);

    return data;
}

function getParameterByName(name: string, url: string) {
    if (!url) url = window.location.href;
    name = name.replace(/[\[\]]/g, '\\$&');
    var regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

function init() {
    let datasource: GraphDataSource = null;
    let graphs: Graph[] = [];

    let url = d3.select('base').attr('href');
    let port = getParameterByName('port', url);
    if (!port) { port = '53333'; }

    let ws = new WebSocket(`ws://localhost:${port}`);
    ws.onopen = function(event: any) {
        console.log('Opened: ', event);
    };

    ws.onmessage = function(event: any) {
        let message = JSON.parse(event.data);
        if (message.activePorts && message.graphs) {
            let ports = message.activePorts.map((p: any) => p.port);
            datasource = new GraphDataSource(ports);

            message.graphs.forEach((graph: any) => {
                if (graph.type === 'realtime') {
                    let config = graph as TimeseriesGraphConfiguration;
                    console.log('Creating Graph For: ', config);
                    graphs.push(new TimeseriesGraph(config, datasource));
                }
                else if (graph.type === 'x-y-plot') {
                    let config = graph as XYGraphConfiguration;
                    console.log('Creating Graph For: ', config);
                    graphs.push(new XYGraph(config, datasource));
                }
            });
        }
        else {
            if (datasource) {
                datasource.receiveMessage(message);
            }
        }
    };


}

init();