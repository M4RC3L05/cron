import {
  assertEquals,
  describe,
  fail,
  FakeTime,
  it,
  type Spy,
  spy,
} from "./test_deps.ts";
import { Cron } from "./mod.ts";

describe("Cron", () => {
  describe("constructor()", () => {
    it("should throw an error if cron expression is invalid", () => {
      try {
        new Cron("* * * * * * * *");

        fail("It should have thrown an error");
      } catch (error) {
        assertEquals(error.message, "Invalid cron expression");
      }
    });

    it("should create a cron", () => {
      assertEquals(new Cron("* * * * * *").working, false);
    });
  });

  describe("start()", () => {
    it("should start the cron", async () => {
      const cron = new Cron("* * * * * *");
      cron.start();
      assertEquals(cron.working, true);
      await cron.stop();
    });
  });

  describe("stop()", () => {
    it("should stop the cron", async () => {
      const cron = new Cron("* * * * * *");
      cron.start();
      assertEquals(cron.working, true);
      await cron.stop();
      assertEquals(cron.working, false);
    });
  });

  describe("checkTime()", () => {
    it("should return true/false indicating if a given time matches the cron expression", async () => {
      const time = new FakeTime(0);
      const cron = new Cron("0 1 * * * *", "UTC", 0);

      assertEquals(cron.checkTime(), false);
      await time.tickAsync(1000 * 59); // +59s
      assertEquals(cron.checkTime(), false);
      await time.tickAsync(1000); // +1s
      assertEquals(cron.checkTime(), true);
      await time.tickAsync(1000); // +1s
      assertEquals(cron.checkTime(), false);
      await time.tickAsync(1000 * 59); // +59s
      assertEquals(cron.checkTime(), false);
      assertEquals(cron.checkTime(1000 * 59), false);
      assertEquals(cron.checkTime(1000 * 60), true);

      await cron.stop();
    });

    it("should match first month", async () => {
      const time = new FakeTime(0);
      const cron = new Cron("0 1 * * * *", "UTC", 0);

      assertEquals(cron.checkTime(1000 * 60), true);

      time.restore();

      await cron.stop();
    });

    it("should match the last month", async () => {
      const time = new FakeTime(1000 * 60 * 60 * 24 * 360);

      const cron = new Cron("0 1 * * * *", "UTC", 0);

      assertEquals(cron.checkTime(Date.now() + 1000 * 60), true);

      time.restore();

      await cron.stop();
    });

    it("should handle diference between system time and specified timezone", async () => {
      const time = new FakeTime("2024-01-10T11:00:00.000+02:00");

      const cron = new Cron("0 0 9 * * *", "Europe/Lisbon", 0);

      assertEquals(cron.checkTime(), true);

      time.restore();

      await cron.stop();
    });

    it("should handle DLS", async () => {
      const time = new FakeTime("2024-03-30T09:00:00.000+02:00");

      const cron = new Cron("0 0 9 * * *", "Europe/Athens", 0);

      assertEquals(cron.checkTime(), true); // before DLS
      await time.tickAsync(1000 * 60 * 60 * 23);
      assertEquals(cron.checkTime(), true); // after DLS +1

      await time.tickAsync(
        new Date("2024-10-26T09:00:00.000+03:00").getTime() - Date.now(),
      );
      assertEquals(cron.checkTime(), true); // before DLS +1
      await time.tickAsync(1000 * 60 * 60 * 25);
      assertEquals(cron.checkTime(), true); // after DLS

      time.restore();

      await cron.stop();
    });

    it("should handle DLS with diference between system time and specified timezone", async () => {
      const time = new FakeTime("2024-03-30T11:00:00.000+02:00");

      const cron = new Cron("0 0 9 * * *", "Europe/Lisbon", 0);

      assertEquals(cron.checkTime(), true); // before DLS
      await time.tickAsync(1000 * 60 * 60 * 23);
      assertEquals(cron.checkTime(), true); // after DLS +1

      await time.tickAsync(
        new Date("2024-10-26T11:00:00.000+03:00").getTime() - Date.now(),
      );
      assertEquals(cron.checkTime(), true); // before DLS +1
      await time.tickAsync(1000 * 60 * 60 * 25);
      assertEquals(cron.checkTime(), true); // after DLS

      time.restore();

      await cron.stop();
    });
  });

  describe("work", () => {
    it("should yield when the cron expression matches", async () => {
      const time = new FakeTime(0);

      let waitPResolve: Spy;
      const waitP = new Promise<{ value: AbortSignal }>((resolve) => {
        waitPResolve = spy(resolve);
      });

      const cron = new Cron("0 1 * * * *", "UTC", 0);
      cron
        .start()
        .next()
        .then((s) => waitPResolve(s));

      await time.tickAsync(1000 * 59);
      assertEquals(cron.checkTime(), false);

      await time.tickAsync(1000);
      assertEquals(cron.checkTime(), true);

      const { value } = await waitP;
      assertEquals(waitPResolve!.calls.length, 1);
      assertEquals(value instanceof AbortSignal, true);

      await cron.stop();
      time.restore();
    });

    it("should yield when the cron expression matches multiple times", async () => {
      const time = new FakeTime(0);

      let waitPResolve: Spy;
      const waitP = new Promise<{ value: AbortSignal }>((resolve) => {
        waitPResolve = spy(resolve);
      });

      let waitPResolve2: Spy;
      const waitP2 = new Promise<{ value: AbortSignal }>((resolve) => {
        waitPResolve2 = spy(resolve);
      });

      const cron = new Cron("0 1 * * * *", "UTC", 0);
      const asyncGen = cron.start();

      asyncGen.next().then((s) => waitPResolve(s));

      await time.tickAsync(1000 * 60);
      await waitP;

      assertEquals(waitPResolve!.calls.length, 1);

      asyncGen.next().then((s) => waitPResolve2(s));
      await time.tickAsync(1000 * 60 * 60 * 1);
      await waitP2;

      assertEquals(waitPResolve!.calls.length, 1);

      await cron.stop();
      time.restore();
    });

    it("should not yield multiple times for the same match", async (done) => {
      const time = new FakeTime(0);

      let waitPResolve: Spy;
      const waitP = new Promise<{ value: AbortSignal }>((resolve) => {
        waitPResolve = spy(resolve);
      });

      let waitPResolve2: Spy;
      new Promise<{ value: AbortSignal }>((resolve) => {
        waitPResolve2 = spy(resolve);
      });

      const cron = new Cron("* 1 * * * *", "UTC", 0);
      const asyncGen = cron.start();

      asyncGen.next().then((s) => waitPResolve(s));
      await time.tickAsync(1000 * 60);

      asyncGen.next().then((s) => waitPResolve(s));
      await time.tickAsync(500);
      await waitP;

      assertEquals(waitPResolve!.calls.length, 1);

      asyncGen.next().then(async (s) => {
        waitPResolve(s);
        waitPResolve2(s);

        assertEquals(waitPResolve!.calls.length, 2);
        assertEquals(waitPResolve2!.calls.length, 1);

        await cron.stop();
        time.restore();
        // @ts-ignore: ts stuff
        done();
      });

      await time.tickAsync(500);
    });
  });
});
