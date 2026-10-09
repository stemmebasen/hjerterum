import { describe, expect, it } from "vitest";
import { assignMail, setHandled } from "./enquiries.js";
import { setTodoDone } from "./data.js";
import { insertMail } from "../saga/store.js";
import { testDatabase } from "../saga/test-support.js";

// Requested: "Man skal også kunne tildele hver mail til et medlem af bestyrelsen ... hold det helt simpelt."
const NOW = Date.parse("2026-10-09T10:00:00Z");

describe("giving a mail to a board member", () => {
  const setup = async () => {
    const db = testDatabase();
    const id = (await insertMail(db, { ref: "a", sender: "Kamilla <kamilla@example.com>", subject: "Opsigelse", receivedAtMs: NOW, preview: "Tekst", nowMs: NOW }))!;
    await db.prepare("UPDATE board_mail SET enquiry_kind = 'Medlemskab' WHERE id = ?").bind(id).run();
    return { db, id };
  };
  const todos = (db: ReturnType<typeof testDatabase>) => db.prepare("SELECT owner, text, done_at_ms FROM cockpit_todos").all();

  it("puts a short to-do on the member's list, and checking either one off checks the other", async () => {
    const { db, id } = await setup();
    await assignMail(db, id, "Kai", "Jacob", NOW);
    expect((await todos(db)).results).toEqual([{ owner: "Kai", text: "Svar på mail fra Kamilla", done_at_ms: null }]);
    const todo = await db.prepare("SELECT assigned_todo_id AS t FROM board_mail WHERE id = ?").bind(id).first<{ t: number }>();
    await setTodoDone(db, todo!.t, "Kai", true, NOW + 1000);
    expect(await db.prepare("SELECT handled_by FROM board_mail WHERE id = ?").bind(id).first()).toEqual({ handled_by: "Kai" });
    await setHandled(db, id, "Jacob", false, NOW + 2000);
    expect((await todos(db)).results).toMatchObject([{ done_at_ms: null }]);
  });

  it("moves to another member or is taken back without leaving a to-do behind", async () => {
    const { db, id } = await setup();
    await assignMail(db, id, "Kai", "Jacob", NOW);
    await assignMail(db, id, "Lisbeth", "Jacob", NOW);
    expect((await todos(db)).results).toMatchObject([{ owner: "Lisbeth" }]);
    await assignMail(db, id, "", "Jacob", NOW);
    expect((await todos(db)).results).toEqual([]);
  });
});
