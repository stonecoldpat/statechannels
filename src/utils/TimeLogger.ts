export class TimeLogger {
    private constructor() {}

    public static theLogger = new TimeLogger();
    logs: TimeLog[] = [];

    public log(address: string) {
        return (eventName: string) => {
            const l = new TimeLog(eventName, address);
            //console.log(l.serialise());
            this.logs.push(l);
        };
    }
}

class TimeLog {
    public readonly time: number;
    constructor(public readonly event: string, public readonly player: string) {
        this.time = Date.now();
    }
    serialise(): string {
        return `${this.player}:${this.time}:${this.event}`;
    }
}
