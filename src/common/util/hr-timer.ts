export class HrTimer {
    private start: bigint;
    constructor() {
        this.start = process.hrtime.bigint();
    }

    public restart(): void {
        this.start = process.hrtime.bigint();
    }

    public getStart(): bigint {
        return this.start;
    }

    public static getNow(): bigint {
        return process.hrtime.bigint();
    }

    public deltaNs(): string {
        return (process.hrtime.bigint() - this.start).toString();
    }

    public deltaUs(): string {
        return this.toStringWithRes(3);
    }

    public deltaMs(): string {
        return this.toStringWithRes(6);
    }

    public createPaddedMs(padding: number): string {
        const hrUs = this.deltaMs().padStart(padding, '0');
        // const hrUsPadded = (hrUs.length < padding) ? '0'.repeat(padding - hrUs.length) + hrUs : '' + hrUs ;
        // return hrUsPadded;
        return hrUs;
    }

    public createDateTimestamp(): string {
        const hrUs = this.createPaddedMs(6);
        const date = new Date();
        const ret = `[${date.toISOString()}, +${hrUs}ms]`;
        return ret;
    }

    private toStringWithRes(res: number) {
        const diff = process.hrtime.bigint() - this.start + BigInt((10 ** res) / 2);
        let ret = diff.toString();
        ret = ret.length <= res ? '0' : ret.substr(0, ret.length - res);
        return ret;
    }
}
