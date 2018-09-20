export class TimeLogger {
    private constructor() {}

    public static theLogger = new TimeLogger();
    logs: TimeLog[] = [];

    public log(address: string) {
        return (eventName: string) => {
            return this.logs.push(new TimeLog(eventName, address));
        };
    }
}

class TimeLog {
    public readonly time: number;
    constructor(public readonly eventName: string, public readonly player: string) {
        this.time = Date.now();
    }
}