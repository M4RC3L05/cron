export declare class Cron {
    #private;
    constructor(when: string, timezone?: string, tickerTimeout?: number);
    get working(): boolean;
    start(): AsyncGenerator<AbortSignal, void, unknown>;
    stop(): Promise<void>;
    nextAt(): string;
    checkTime(at?: number): boolean;
}
export default Cron;
