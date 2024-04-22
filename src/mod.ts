import { cronParser, dayjs, delay, timezone, utc } from "./deps.ts";

dayjs.extend(utc);
dayjs.extend(timezone);

export class Cron {
  #when: cronParser.CronExpression;
  #abortController: AbortController;
  #working: boolean;
  #worker!: AsyncGenerator<AbortSignal, void>;
  #lastProcessAt?: number;
  #tickerTimeout = 500;
  #timezone = "UTC";

  constructor(when: string, timezone?: string, tickerTimeout?: number) {
    this.#timezone = timezone ?? this.#timezone;
    this.#when = cronParser.parseExpression(when, { tz: this.#timezone });
    this.#working = false;

    this.#abortController = new AbortController();
    this.#tickerTimeout = tickerTimeout ?? this.#tickerTimeout;

    dayjs.tz.setDefault(this.#timezone);
  }

  get working(): boolean {
    return this.#working;
  }

  start(): AsyncGenerator<AbortSignal, void> {
    if (this.#working) return this.#worker;

    this.#working = true;
    this.#worker = this.#work();

    return this.#worker;
  }

  async stop() {
    if (!this.#working) return;

    this.#working = false;

    this.#abortController.abort();

    await this.#worker.return();
  }

  nextAt(): string {
    this.#when.reset(dayjs().tz().set("milliseconds", 0).toDate());

    return dayjs.utc(this.#when.next().toISOString()).tz().format();
  }

  checkTime(at?: number): boolean {
    return this.#checkTime(at ?? dayjs().tz().unix() * 1000);
  }

  #checkTime(at: number) {
    const now = dayjs(at).tz().set("milliseconds", 0);

    return (
      // @ts-ignore: ts stuff
      this.#when.fields.second.includes(now.second()) &&
      // @ts-ignore: ts stuff
      this.#when.fields.minute.includes(now.minute()) &&
      // @ts-ignore: ts stuff
      this.#when.fields.hour.includes(now.hour()) &&
      // @ts-ignore: ts stuff
      this.#when.fields.dayOfMonth.includes(now.date()) &&
      // @ts-ignore: ts stuff
      // We must add 1 to the month value as it starts from 0 and the cron starts from 1.
      this.#when.fields.month.includes(now.month() + 1) &&
      // @ts-ignore: ts stuff
      this.#when.fields.dayOfWeek.includes(now.day())
    );
  }

  async *#ticker() {
    yield dayjs().tz().valueOf();

    while (true) {
      try {
        await delay(this.#tickerTimeout, {
          signal: this.#abortController.signal,
        });

        yield dayjs().tz().valueOf();
      } catch {
        return;
      }
    }
  }

  async *#work() {
    for await (const at of this.#ticker()) {
      const seconds = Math.floor(at / 1000);
      const isTime = this.#checkTime(seconds * 1000);
      const notMatchesLastTime = !this.#lastProcessAt ||
        seconds !== this.#lastProcessAt;

      if (isTime && notMatchesLastTime) {
        this.#lastProcessAt = seconds;

        yield this.#abortController.signal;
      }

      if (this.#abortController.signal.aborted) {
        return;
      }
    }

    if (this.#working) this.#working = false;
  }
}

export default Cron;
