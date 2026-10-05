import { describe, expect, it } from "vitest";
import { handleSagaRequest } from "./handler.js";
import { mailWatch } from "./connections.js";
import { runSagaJobs } from "./saga.js";
import { deps, fakeServices, OWNER, sagaEnv, testDatabase } from "./test-support.js";
import type { SagaEnv } from "./env.js";

// Asked: "Og er vi sikre på, at mailen bliver tjekket kontinuerligt?" - "Alene i eftermiddag er der kommet tre mails ind".
// It was not: Matrix stopped handing team@ over on 23 Sep while the status said "Forbundet".
const NOW = Date.parse("2026-10-02T10:00:00Z");
const MIN = 60_000;

const report = (env: SagaEnv, fetcher: typeof fetch, at: number, body: unknown) => handleSagaRequest(new Request("https://hjerterum.test/api/saga/liva/mail", {
  method: "POST", headers: { authorization: "Bearer liva-secret", "content-type": "application/json" }, body: JSON.stringify(body) }), env, deps(fetcher, at));

describe("knowing that team@ is checked", () => {
  it("keeps Matrix's report from every run, also an empty or failed one, and says when the watch has stopped", async () => {
    const db = testDatabase();
    const services = fakeServices();
    const env = sagaEnv(db);
    expect(await mailWatch(db, NOW)).toMatchObject({ state: "unknown" });

    expect(await (await report(env, services.fetcher, NOW, { mails: [], status: { connected: true, listed: 40, relayed: 0 } })).json()).toEqual({ received: 0, fresh: 0 });
    expect(await mailWatch(db, NOW + 5 * MIN)).toEqual({ state: "ok", detail: expect.stringContaining("40 nye i indbakken, 0 hentet") });
    // No report for more than half an hour: stopped.
    expect(await mailWatch(db, NOW + 31 * MIN)).toMatchObject({ state: "stale", detail: expect.stringContaining("ikke blevet tjekket siden") });

    await report(env, services.fetcher, NOW + 40 * MIN, { status: { connected: true, error: "imap_auth_failed" } });
    expect(await mailWatch(db, NOW + 41 * MIN)).toEqual({ state: "error", detail: "team@ kunne ikke læses ved seneste tjek (imap_auth_failed)." });
    await report(env, services.fetcher, NOW + 50 * MIN, { status: { connected: false } });
    expect((await mailWatch(db, NOW + 51 * MIN)).detail).toBe("team@ er ikke forbundet. Formanden forbinder den under Posthus.");
  });

  // Requested (5 October): "Disse Telegram beskeder er unødvendige - og dem vil jeg gerne være fri for." The watch is
  // shown under Forbindelser; Jacob gets no Telegram message about it, however long team@ goes unchecked.
  it("never writes to Jacob on Telegram about team@, however long it goes unchecked", async () => {
    const db = testDatabase();
    const services = fakeServices();
    const env = sagaEnv(db);
    await report(env, services.fetcher, NOW, { mails: [], status: { connected: true, listed: 3, relayed: 0 } });
    const toJacob = () => services.telegram("sendMessage").filter(c => (c.body as { chat_id: string }).chat_id === OWNER && /team@/.test((c.body as { text: string }).text));
    await runSagaJobs(env, deps(services.fetcher, NOW + 130 * MIN));
    await runSagaJobs(env, deps(services.fetcher, NOW + 24 * 60 * MIN));
    expect(toJacob()).toHaveLength(0);
    expect((await mailWatch(db, NOW + 24 * 60 * MIN)).state).toBe("stale");
  });
});
