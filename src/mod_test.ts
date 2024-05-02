import {
  assertEquals,
  describe,
  fail,
  FakeTime,
  it,
  spy,
} from "./test_deps.ts";
import { Cron } from "./mod.ts";

describe("Cron", () => {
  describe("constructor()", () => {
    it("should create a cron", () => {
      assertEquals(new Cron(() => {}, { when: "* * * * * *" }).working, false);
    });

    it("should throw an error if cron expression is invalid", () => {
      try {
        new Cron(() => {}, { when: "* * * * * * * *" });

        fail("It should have thrown an error");
      } catch (error) {
        assertEquals(error.message, "Invalid cron expression");
      }
    });
  });

  describe("start()", () => {
    it("should start the cron", async () => {
      const cron = new Cron(() => {}, { when: "* * * * * *" });

      cron.start();

      assertEquals(cron.working, true);

      await cron.stop();
    });

    it("should return the same work promise for multiple start calls", async () => {
      const cron = new Cron(() => {}, { when: "* * * * * *" });

      const w1 = cron.start();
      const w2 = cron.start();

      assertEquals(w1, w2);

      await cron.stop();
    });
  });

  describe("stop()", () => {
    it("should stop the cron", async () => {
      const cron = new Cron(() => {}, { when: "* * * * * *" });
      cron.start();

      assertEquals(cron.working, true);

      await cron.stop();

      assertEquals(cron.working, false);
    });

    it("should stop only once for multiple calls", async () => {
      const abortSignalSpy = spy();
      const cron = new Cron(() => {}, { when: "* * * * * *" });
      cron.signal.addEventListener("abort", abortSignalSpy);

      cron.start();

      assertEquals(cron.working, true);

      const p1 = cron.stop();
      const p2 = cron.stop();

      await Promise.all([p1, p2]);

      assertEquals(cron.working, false);
      assertEquals(abortSignalSpy.calls.length, 1);
    });
  });

  describe("checkTime()", () => {
    it("should return true/false indicating if a given time matches the cron expression", async () => {
      const time = new FakeTime(0);
      const cron = new Cron(() => {}, {
        when: "0 1 * * * *",
        timezone: "UTC",
        tickerTimeout: 0,
      });

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
      const cron = new Cron(() => {}, {
        when: "0 1 * * * *",
        timezone: "UTC",
        tickerTimeout: 0,
      });

      assertEquals(cron.checkTime(1000 * 60), true);

      time.restore();

      await cron.stop();
    });

    it("should match the last month", async () => {
      const time = new FakeTime(1000 * 60 * 60 * 24 * 360);
      const cron = new Cron(() => {}, {
        when: "0 1 * * * *",
        timezone: "UTC",
        tickerTimeout: 0,
      });

      assertEquals(cron.checkTime(Date.now() + 1000 * 60), true);

      time.restore();

      await cron.stop();
    });

    it("should handle diference between system time and specified timezone", async () => {
      const time = new FakeTime("2024-01-10T11:00:00.000+02:00");

      const cron = new Cron(() => {}, {
        when: "0 0 9 * * *",
        timezone: "Europe/Lisbon",
        tickerTimeout: 0,
      });

      assertEquals(cron.checkTime(), true);

      time.restore();

      await cron.stop();
    });

    it("should handle DLS", async () => {
      const time = new FakeTime("2024-03-30T09:00:00.000+02:00");

      const cron = new Cron(() => {}, {
        when: "0 0 9 * * *",
        timezone: "Europe/Athens",
        tickerTimeout: 0,
      });

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

      const cron = new Cron(() => {}, {
        when: "0 0 9 * * *",
        timezone: "Europe/Lisbon",
        tickerTimeout: 0,
      });

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
    it("should call job when the cron expression matches", async () => {
      const time = new FakeTime(0);
      const jobSpy = spy();

      const cron = new Cron(jobSpy, {
        when: "0 1 * * * *",
        timezone: "UTC",
        tickerTimeout: 0,
      });

      cron.start();

      await time.tickAsync(1000 * 60);
      await time.tickAsync(1000 * 60 * 60 * 1);

      await cron.stop();
      time.restore();

      assertEquals(jobSpy.calls.length, 2);
    });

    it("should not call job multiple times for the same match", async () => {
      const time = new FakeTime(0);

      const jobSpy = spy();

      const cron = new Cron(jobSpy, {
        when: "* 1 * * * *",
        timezone: "UTC",
        tickerTimeout: 0,
      });

      cron.start();

      await time.tickAsync(1000 * 60);
      await time.tickAsync(500);
      await time.tickAsync(500);

      await cron.stop();
      time.restore();

      assertEquals(jobSpy.calls.length, 2);
    });

    it("should not tick if it was stoped before", async () => {
      const time = new FakeTime(0);

      const jobSpy = spy();

      const cron = new Cron(jobSpy, {
        when: "* 1 * * * *",
        timezone: "UTC",
        tickerTimeout: 0,
      });

      cron.start();
      await cron.stop();
      cron.start();

      await time.tickAsync(1000 * 60);
      await time.tickAsync(500);
      await time.tickAsync(500);

      await cron.stop();
      time.restore();

      assertEquals(jobSpy.calls.length, 0);
    });
  });
});
