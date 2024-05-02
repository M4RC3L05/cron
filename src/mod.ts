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
): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> =>
(...args: Parameters<T>) => {
  try {
    const result = fn(...args);
    return Promise.resolve(result);
  } catch (error) {
    return Promise.reject(error);
  }
};

async function* tick(ms: number, signal: AbortSignal) {
  if (signal.aborted) return;

  yield Date.now();

  while (!signal.aborted) {
    await delay(ms, { signal }).catch(() => {
      // ignore delay errors, most likelly abort error
    });

    yield Date.now();
  }
}

const workerSymbol = Symbol("workerSymbol");

export class Cron {
  #when: cronParser.CronExpression;
  #abortController: AbortController;
  #tickerTimeout = 500;
  #timezone = "UTC";
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
    return this[workerSymbol] instanceof Promise;
  }

  start(): Promise<void> {
    if (!this[workerSymbol]) {
      this[workerSymbol] = this.#worker();
    }

    return this[workerSymbol];
  }

  async stop() {
    if (!this[workerSymbol]) {
      return;
    }

    const workerP = this[workerSymbol];
    this[workerSymbol] = undefined;

    this.#abortController.abort();

    await workerP;
  }

  nextAt(): string {
    this.#when.reset(dayjs().tz().set("milliseconds", 0).toDate());

    return dayjs.utc(this.#when.next().toISOString()).tz().format();
  }

  checkTime(at?: number): boolean {
    at ??= dayjs().tz().unix() * 1000;

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

  async #worker(): Promise<void> {
    const ticker = tick(this.#tickerTimeout, this.#abortController.signal);
    let lastProcessAt: number | undefined;

    for await (const _ of ticker) {
      const at = dayjs().tz().valueOf();
      const seconds = Math.floor(at / 1000);
      const isTime = this.checkTime(seconds * 1000);
      const notMatchesLastTime = !lastProcessAt ||
        seconds !== lastProcessAt;

      if (isTime && notMatchesLastTime) {
        lastProcessAt = seconds;

        await this.#job(this.#abortController.signal).catch(() => {
          // ignore errors from job.
          // we might want, in the future, to add retries
        });
      }
    }
  }
}

export default Cron;
