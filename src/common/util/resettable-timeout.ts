export class ResettableTimeout {
    protected timeoutId: NodeJS.Timeout = null;
    protected args: any[];

    constructor(protected cb: (...args: any) => void, protected interval: number, ...args: any[]) {
        this.args = args;
        this.timeoutId = setTimeout((...args) => {
            this.timeoutId = null;
            this.cb(...this.args);
        } , this.interval, ...this.args);
    }

    public kill() {
        if (this.isRunning()) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
    }

    public reset(interval?: number) {
        this.kill();
        if (interval !== undefined) { this.interval = interval; }
        this.timeoutId = setTimeout(this.cb, this.interval, ...this.args);
    }

    public isRunning() {
        return this.timeoutId !== null;
    }
}
