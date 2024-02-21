import assert from "node:assert/strict";
import { type Mock, describe, it } from "node:test";
import { Cron } from "./mod.ts";

describe("Cron", () => {
  describe("constructor()", () => {
    it("should throw an error if cron expression is invalid", () => {
      try {
        new Cron("* * * * * * * *");

        assert.fail("It should have thrown an error");
      } catch (error) {
        assert.equal(error.message, "Invalid cron expression");
      }
    });

    it("should create a cron", () => {
      assert.equal(new Cron("* * * * * *").working, false);
    });
  });

  describe("start()", () => {
    it("should start the cron", async () => {
      const cron = new Cron("* * * * * *");
      cron.start();
      assert.equal(cron.working, true);
      await cron.stop();
    });
  });

  describe("stop()", () => {
    it("should stop the cron", async () => {
      const cron = new Cron("* * * * * *");
      cron.start();
      assert.equal(cron.working, true);
      await cron.stop();
      assert.equal(cron.working, false);
    });
  });

  describe("checkTime()", () => {
    it("should return true/false indicating if a given time matches the cron expression", (t) => {
      t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });

      const cron = new Cron("0 1 * * * *", "UTC", 0);

      assert.equal(cron.checkTime(), false);
      t.mock.timers.tick(1000 * 59); // +59s
      assert.equal(cron.checkTime(), false);
      t.mock.timers.tick(1000); // +1s
      assert.equal(cron.checkTime(), true);
      t.mock.timers.tick(1000); // +1s
      assert.equal(cron.checkTime(), false);
      t.mock.timers.tick(1000 * 59); // +59s
      assert.equal(cron.checkTime(), false);
      assert.equal(cron.checkTime(1000 * 59), false);
      assert.equal(cron.checkTime(1000 * 60), true);
    });

    it("should match first month", async (t) => {
      t.mock.timers.enable({ apis: ["Date"], now: 0 });

      const cron = new Cron("0 1 * * * *", "UTC", 0);

      assert.equal(cron.checkTime(1000 * 60), true);
    });

    it("should match the last month", async (t) => {
      t.mock.timers.enable({
        apis: ["Date"],
        now: 1000 * 60 * 60 * 24 * 360,
      });

      const cron = new Cron("0 1 * * * *", "UTC", 0);

      assert.equal(cron.checkTime(1000 * 60 * 60 * 24 * 360 + 1000 * 60), true);
    });
  });

  describe("work", () => {
    it("should not yeld when the cron expression matches", async (t) => {
      t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });

      // biome-ignore lint/complexity/noBannedTypes: <explanation>
      let waitPResolve: Mock<Function>;
      const waitP = new Promise<{ value: AbortSignal }>((resolve) => {
        waitPResolve = t.mock.fn(resolve);
      });

      const cron = new Cron("0 1 * * * *", "UTC", 0);
      cron
        .start()
        .next()
        .then((s) => waitPResolve(s));

      t.mock.timers.tick(1000 * 59);

      assert.equal(cron.checkTime(), false);

      t.mock.timers.tick(1000);

      assert.equal(cron.checkTime(), true);

      const { value } = await waitP;

      // @ts-ignore
      assert.equal(waitPResolve.mock.callCount(), 1);
      assert.equal(value instanceof AbortSignal, true);

      await cron.stop();
    });

    it("should not yeld when the cron expression matches multiple times", async (t) => {
      t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });

      // biome-ignore lint/complexity/noBannedTypes: <explanation>
      let waitPResolve: Mock<Function>;
      const waitP = new Promise<{ value: AbortSignal }>((resolve) => {
        waitPResolve = t.mock.fn(resolve);
      });

      // biome-ignore lint/complexity/noBannedTypes: <explanation>
      let waitPResolve2: Mock<Function>;
      const waitP2 = new Promise<{ value: AbortSignal }>((resolve) => {
        waitPResolve2 = t.mock.fn(resolve);
      });

      const cron = new Cron("0 * * * * *", "UTC", 0);
      const asyncGen = cron.start();

      asyncGen.next().then((s) => waitPResolve(s));

      t.mock.timers.tick(1000 * 60);

      await waitP;

      // @ts-ignore
      assert.equal(waitPResolve.mock.callCount(), 1);

      asyncGen.next().then((s) => waitPResolve2(s));

      t.mock.timers.tick(1000 * 60);

      await waitP2;

      // @ts-ignore
      assert.equal(waitPResolve2.mock.callCount(), 1);

      await cron.stop();
    });
  });
});
