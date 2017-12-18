export interface TimeseriesGraphConfiguration {
	label: string;
	minimum: number;
	maximum: number;
	ports: {
		number: number,
		label: string,
		color: string
	}[];
};

export interface XYGraphConfiguration {
	label: string;
	initialX: number;
	initialY: number;
	xMinimum: number;
	yMinimum: number;
	xMaximum: number;
	yMaximum: number;
	xPort: number;
	yPort: number;
};

export interface Graph {
	stop(): void;
}

export interface GraphPoint {
	timestamp: number;
	value: number;
	raw: number;
};