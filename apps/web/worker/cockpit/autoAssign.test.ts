import { describe, expect, it } from "vitest";
import { assignMail, enquiries, markImportant, memberOf } from "./enquiries.js";
import { insertMail } from "../saga/store.js";
import { testDatabase } from "../saga/test-support.js";

// Requested: "Is it possible that Saga learns or checks the email (the IMAP) to see if there is a contact person from the team that normally deals
// with this sender, and then assigns that email automatically to that person?" - "Ja". Then: "Slet automatisk tildeling af mails" - what is left: the name on an answer, and Vigtige mails.
const NOW = Date.parse("2026-10-13T10:00:00Z");
const DAY = 86_400_000;
const MEMBERS = ["Jacob Hauge", "Gitta Hansen", "Lisbeth", "Douglas"];

describe("the team's mails", () => {
  const setup = async () => {
    const db = testDatabase();
    let n = 0;
    const mail = async (sender: string, at: number, fields: Record<string, string | null> = { enquiry_kind: "Lokaleleje" }) => {
      const id = (await insertMail(db, { ref: `r${++n}`, sender, subject: `Mail ${n}`, receivedAtMs: at, preview: "Tekst", nowMs: NOW }))!;
      for (const [k, v] of Object.entries(fields)) await db.prepare(`UPDATE board_mail SET ${k} = ? WHERE id = ?`).bind(v, id).run();
      return id;
    };
    const row = (id: number) => db.prepare("SELECT assigned_to, assigned_why FROM board_mail WHERE id = ?").bind(id).first<{ assigned_to: string | null; assigned_why: string | null }>();
    return { db, mail, row };
  };

  it("knows the member by the name on an answer, and lets a member move a mail into Vigtige mails", async () => {
    expect(memberOf("Gitta | Hjerterum", MEMBERS)).toBe("Gitta Hansen");
    expect(memberOf("Hjerterum", MEMBERS)).toBeNull();
    const { db, mail } = await setup();
    const laila = await mail("Laila Pedersen <laila@example.dk>", NOW - DAY, {});
    expect((await enquiries(db, NOW)).open.map(e => e.id)).not.toContain(laila);
    await markImportant(db, laila);
    expect((await enquiries(db, NOW)).open.map(e => e.id)).toContain(laila);
  });
});
