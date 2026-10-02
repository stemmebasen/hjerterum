import { describe, expect, it } from "vitest";
import { recentMinutes } from "./store.js";
import { testDatabase } from "./test-support.js";

// Reported: "Hjerterum i Matrix er helt outdated ... slet ikke noget om det nyeste eller det nyeste referat. Husk, at
// vi altid skal se det nyeste øverst i alle henseender." Meetings imported later from the minutes document must not
// push the newest meeting's minutes out.
describe("the minutes Matrix gets", () => {
  it("come newest meeting first, whenever they were created", async () => {
    const db = testDatabase();
    const add = (id: string, day: string, createdAt: number) => db.prepare(`INSERT INTO board_minutes (source, source_file_id, file_name, status, meeting_date, draft_markdown, created_at_ms, updated_at_ms)
      VALUES ('telegram', ?, 'm.m4a', 'approved', ?, '# Referat', ?, ?)`).bind(id, day, createdAt, createdAt).run();
    await add("oct", "2026-10-01", 1000);
    for (const [i, day] of ["2026-09-17", "2026-09-03", "2026-08-20", "2026-08-06", "2026-07-23"].entries()) await add(`doc${i}`, day, 2000 + i);
    const list = await recentMinutes(db, 5);
    expect(list.map(m => m.meeting_date)).toEqual(["2026-10-01", "2026-09-17", "2026-09-03", "2026-08-20", "2026-08-06"]);
  });
});
