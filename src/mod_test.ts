import {
  assertEquals,
  describe,
  fail,
  FakeTime,
  it,
  Spy,
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
    });

    it("should match first month", () => {
      const time = new FakeTime(0);
      const cron = new Cron("0 1 * * * *", "UTC", 0);

      assertEquals(cron.checkTime(1000 * 60), true);

      time.restore();
    });

    it("should match the last month", () => {
      const time = new FakeTime(1000 * 60 * 60 * 24 * 360);

      const cron = new Cron("0 1 * * * *", "UTC", 0);

      assertEquals(cron.checkTime(Date.now() + 1000 * 60), true);

      time.restore();
    });

    it("should handle DLS", async () => {
      const time = new FakeTime("2016-03-26 09:00:00");

      const cron = new Cron("0 0 9 * * *", "UTC", 0);

      assertEquals(cron.checkTime(), true); // before DLS
      await time.tickAsync(1000 * 60 * 60 * 23);
      assertEquals(cron.checkTime(), true); // after DLS +1

      await time.tickAsync(
        new Date("2016-10-29 09:00:00").getTime() - Date.now(),
      );
      assertEquals(cron.checkTime(), true); // before DLS +1
      await time.tickAsync(1000 * 60 * 60 * 25);
      assertEquals(cron.checkTime(), true); // after DLS

      time.restore();
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

      const cron = new Cron("0 * * * * *", "UTC", 0);
      const asyncGen = cron.start();

      asyncGen.next().then((s) => waitPResolve(s));

      await time.tickAsync(1000 * 60);
      await waitP;

      assertEquals(waitPResolve!.calls.length, 1);

      asyncGen.next().then((s) => waitPResolve2(s));

      await time.tickAsync(1000 * 60);
      await waitP2;

      assertEquals(waitPResolve!.calls.length, 1);

      await cron.stop();
      time.restore();
    });
  });
});
