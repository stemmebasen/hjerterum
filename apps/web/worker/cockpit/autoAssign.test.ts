import { describe, expect, it } from "vitest";
import { assignMail, autoAssignMail, enquiries, markImportant, memberOf } from "./enquiries.js";
import { insertMail } from "../saga/store.js";
import { testDatabase } from "../saga/test-support.js";

// Requested: "Is it possible that Saga learns or checks the email (the IMAP) to see if there is a contact person from the team that normally deals
// with this sender, and then assigns that email automatically to that person?" - "Ja".
const NOW = Date.parse("2026-10-13T10:00:00Z");
const DAY = 86_400_000;
const MEMBERS = ["Jacob Hauge", "Gitta Hansen", "Lisbeth", "Douglas"];

describe("Saga assigns a mail to the one who usually deals with the sender", () => {
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

  it("learns from whom the members assigned the sender's mails to, and from who answered them", async () => {
    const { db, mail, row } = await setup();
    const old = await mail("Pia <pia@example.dk>", NOW - 40 * DAY);
    await assignMail(db, old, "Gitta Hansen", "Jacob Hauge", NOW - 40 * DAY);
    await mail("Bo <bo@example.dk>", NOW - 20 * DAY, { enquiry_kind: "Medlemskab", answered_by: "Lisbeth | Hjerterum", answered_at_ms: String(NOW - 19 * DAY) });
    const pia = await mail("Pia <pia@example.dk>", NOW - DAY);
    const bo = await mail("Bo <bo@example.dk>", NOW - DAY);
    const stranger = await mail("Ny <ny@example.dk>", NOW - DAY);
    expect(await autoAssignMail(db, MEMBERS, new Map(), NOW)).toBe(2);
    expect(await row(pia)).toEqual({ assigned_to: "Gitta Hansen", assigned_why: "plejer at få mails fra Pia" });
    expect(await row(bo)).toEqual({ assigned_to: "Lisbeth", assigned_why: "har svaret Bo før" });
    expect(await row(stranger)).toEqual({ assigned_to: null, assigned_why: null });
    // The one assigned has it on the to-do list, as when a member assigns.
    expect((await db.prepare("SELECT owner, text, created_by FROM cockpit_todos WHERE owner = 'Gitta Hansen' AND done_at_ms IS NULL ORDER BY id DESC").first())).toEqual({ owner: "Gitta Hansen", text: "Svar på mail fra Pia", created_by: "Saga" });
  });

  it("uses the responsibilities when there is no history, leaves a tie to the board, and never takes back a member's choice", async () => {
    const { db, mail, row } = await setup();
    const bill = await mail("Firma <regning@firma.dk>", NOW - DAY, { enquiry_kind: "Andet", label: "Økonomi" });
    const two = await mail("To <to@example.dk>", NOW - DAY);
    for (const member of ["Gitta Hansen", "Douglas"]) {
      const earlier = await mail("To <to@example.dk>", NOW - 30 * DAY);
      await assignMail(db, earlier, member, "Jacob Hauge", NOW - 30 * DAY);
    }
    await autoAssignMail(db, MEMBERS, new Map([["Lisbeth", "Økonomi og regnskab"], ["Douglas", "Events og undervisere"]]), NOW);
    expect(await row(bill)).toEqual({ assigned_to: "Lisbeth", assigned_why: "har økonomi som ansvarsområde" });
    expect((await row(two))?.assigned_to).toBeNull();
    // A member takes Saga's choice away: Saga leaves that mail alone.
    await assignMail(db, bill, "", "Jacob Hauge", NOW);
    await autoAssignMail(db, MEMBERS, new Map([["Lisbeth", "Økonomi"]]), NOW);
    expect(await row(bill)).toEqual({ assigned_to: null, assigned_why: "fravalgt" });
  });

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
