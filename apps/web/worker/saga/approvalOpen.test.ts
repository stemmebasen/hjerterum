import { describe, expect, it } from "vitest";
import { scheduledApprovalOpen } from "./saga.js";
import { BOARD, deps, fakeServices, sagaEnv, testDatabase } from "./test-support.js";

// Requested: "Referat-udkast kan tilrettes og ændres i 3 dage. Herefter kan man ikke længere ændre det: nu skal bestyrelsesmedlemmerne godkende det hver især."
const NOW = Date.parse("2026-10-15T10:00:00Z");
const DAY = 86_400_000;

describe("the end of the three days of corrections", () => {
  it("tells the board once that the minutes now are to be approved", async () => {
    const db = testDatabase();
    const add = (file: string, date: string, created: number, source = "upload") => db.prepare(`INSERT INTO board_minutes (source, source_file_id, file_name, status, meeting_date, draft_markdown, created_at_ms, updated_at_ms)
      VALUES (?, ?, 'm.m4a', 'approved', ?, '# Referat', ?, ?)`).bind(source, file, date, created, created).run();
    await add("a", "2026-10-08", NOW - 3 * DAY - 60_000);
    await add("b", "2026-10-13", NOW - DAY);
    await add("c", "2026-09-01", NOW - 30 * DAY);
    await add("d", "2026-10-07", NOW - 3 * DAY - 60_000, "document");
    const services = fakeServices();
    const env = sagaEnv(db, { SAGA_MINUTES_PING: "on", COCKPIT_URL: "https://admin.hjerterum.info" });
    expect(await scheduledApprovalOpen(env, deps(services.fetcher, NOW))).toBe(1);
    expect(await scheduledApprovalOpen(env, deps(services.fetcher, NOW + 600_000))).toBe(0);
    expect(services.telegram("sendMessage").map(m => m.body)).toMatchObject([{ chat_id: BOARD, text: "Rettelsesperioden er slut 🌿\nReferatet fra mødet 8. oktober 2026 kan ikke længere ændres. Nu godkender I det hver især - når alle har godkendt, låses det:\nhttps://admin.hjerterum.info/referat/1" }]);
  });
});
