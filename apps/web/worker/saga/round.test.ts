import { describe, expect, it } from "vitest";
import { isMailRun, runSagaJobs } from "./saga.js";
import { serviceStatus } from "./store.js";
import { deps, fakeServices, sagaEnv, testDatabase } from "./test-support.js";

// Asked: "Why have Saga not made a resume on the admin page since Friday at 1?" - team@ was read first in every round, and a
// round stopped there lost every job after it. Now team@ has its own run, and the round leaves a mark at each step.
describe("Saga's round", () => {
  it("runs without reading team@ when the mail has its own run, and says it finished", async () => {
    const db = testDatabase();
    const services = fakeServices();
    await runSagaJobs(sagaEnv(db), deps(services.fetcher, Date.parse("2026-10-12T06:00:00Z")), { mail: false });
    expect((await serviceStatus(db, "saga_round"))?.detail).toMatch(/^færdig \(startet 06:00 UTC\)$/);
    expect(await serviceStatus(db, "team_mail_progress")).toBeNull();
    // One cron (the free plan allows five in all): every other five-minute run reads team@.
    const at = Date.parse("2026-10-12T06:00:00Z");
    expect([isMailRun(at), isMailRun(at + 300_000), isMailRun(at + 600_000)]).toEqual([false, true, false]);
  });
});
