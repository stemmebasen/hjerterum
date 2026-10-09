import { expect, it } from "vitest";
import { enquiries, setLabel } from "./enquiries.js";
import { insertMail } from "../saga/store.js";
import { testDatabase } from "../saga/test-support.js";

// Requested: "kun uåbnede mails og altid kun for de sidste 10 dage" under the label chips.
const NOW = Date.parse("2026-10-09T10:00:00Z"), DAY = 86_400_000;
it("counts only open mails from the last ten days on the chips", async () => {
  const db = testDatabase();
  const add = async (ref: string, ageDays: number) => {
    const id = (await insertMail(db, { ref, sender: "x@example.com", subject: ref, receivedAtMs: NOW - ageDays * DAY, preview: "t", nowMs: NOW }))!;
    await setLabel(db, id, "Medlem"); return id;
  };
  await add("ny", 1); await add("gammel", 12);
  const done = await add("klaret", 2);
  await db.prepare("UPDATE board_mail SET handled_at_ms = ? WHERE id = ?").bind(NOW, done).run();
  expect((await enquiries(db, NOW)).labelCounts).toEqual({ Medlem: 1 });
});
