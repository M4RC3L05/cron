import {
  cronParser,
  dayjs,
  type DayOfTheMonthRange,
  type DayOfTheWeekRange,
  delay,
  type HourRange,
  type MonthRange,
  type SixtyRange,
  timezone,
  utc,
} from "./deps.ts";

dayjs.extend(utc);
dayjs.extend(timezone);

type CronOptions = {
  when: string;
  timezone?: string;
  tickerTimeout?: number;
};

// deno-lint-ignore no-explicit-any
const wrapInPromise = <T extends (...args: any) => any>(
  fn: T,
): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> => {
  return (...args: Parameters<T>) => {
    try {
      const result = fn(...args);
      return Promise.resolve(result);
    } catch (error) {
      return Promise.reject(error);
    }
  };
};

const workerSymbol = Symbol("workerSymbol");

export class Cron {
  #when: cronParser.CronExpression;
  #abortController: AbortController;
  #working = false;
  #lastProcessAt?: number;
  #tickerTimeout = 500;
  #timezone = "UTC";
  #tickerSetTimeout?: number;
  #job: (abortSignal: AbortSignal) => Promise<void>;

  [workerSymbol]?: Promise<void>;

  constructor(
    job: (abortSignal: AbortSignal) => Promise<void> | void,
    options: CronOptions,
  ) {
    this.#timezone = options.timezone ?? this.#timezone;
    this.#when = cronParser.parseExpression(options.when, {
      tz: this.#timezone,
    });

    this.#abortController = new AbortController();
    this.#tickerTimeout = options.tickerTimeout ?? this.#tickerTimeout;

    this.#job = wrapInPromise(job);

    dayjs.tz.setDefault(this.#timezone);
  }

  get working(): boolean {
    return this.#working;
  }

  start() {
    if (this.#working) return;

    this.#working = true;
    this[workerSymbol] = this.#ticker();
  }

  async stop() {
    if (!this.#working) return;

    this.#working = false;
    this.#abortController.abort();

    clearTimeout(this.#tickerSetTimeout);

    await this[workerSymbol];
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
      this.#when.fields.second.includes(now.second() as SixtyRange) &&
      this.#when.fields.minute.includes(now.minute() as SixtyRange) &&
      this.#when.fields.hour.includes(now.hour() as HourRange) &&
      this.#when.fields.dayOfMonth.includes(now.date() as DayOfTheMonthRange) &&
      // We must add 1 to the month value as it starts from 0 and the cron starts from 1.
      this.#when.fields.month.includes((now.month() + 1) as MonthRange) &&
      this.#when.fields.dayOfWeek.includes(now.day() as DayOfTheWeekRange)
    );
  }

  async #ticker(): Promise<void> {
    const at = dayjs().tz().valueOf();
    const seconds = Math.floor(at / 1000);
    const isTime = this.#checkTime(seconds * 1000);
    const notMatchesLastTime = !this.#lastProcessAt ||
      seconds !== this.#lastProcessAt;

    if (isTime && notMatchesLastTime) {
      this.#lastProcessAt = seconds;

      try {
        await this.#job(this.#abortController.signal);
      } catch {
        // ignore errors from job.
        // we might want, in the future, to add retries
      }
    }

    if (this.#abortController.signal.aborted) {
      return;
    }

    await delay(this.#tickerTimeout, { signal: this.#abortController.signal })
      .catch(() => {
        // ignore delay errors, most likelly abort error
      });

    return this.#ticker();
  }
}

export default Cron;
