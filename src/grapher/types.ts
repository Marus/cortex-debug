export interface Graph {
    stop(): void;
    continue(): void;
}

export interface GraphPoint {
    timestamp: number;
    value: number;
}
