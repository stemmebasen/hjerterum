import { describe, expect, it } from "vitest";
import { mailWatch } from "./connections.js";
import { connectTeamMail, disconnectTeamMail, openPassword, readTeamMail, teamMailAccount, type FetchedMail, type ImapOpener } from "./teamMail.js";
import { deps, fakeServices, sagaEnv, testDatabase } from "./test-support.js";

// Requested: "medmindre det er mere optimalt at oprette den i hjerterums admin?" - "Godt". Hjerterum reads team@ itself.
const NOW = Date.parse("2026-10-02T21:00:00Z");
const MIN = 60_000;
const mime = (from: string, subject: string, body: string) => new TextEncoder().encode(`From: ${from}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`);

function fakeMailbox(mails: FetchedMail[], options: { password?: string; uidValidity?: string; hang?: boolean } = {}) {
  const logins: string[] = [];
  const searches: unknown[] = [];
  const opener: ImapOpener = async login => {
    logins.push(`${login.host}:${login.user}`);
    if (options.password && login.password !== options.password) throw Object.assign(new Error("Command failed"), { responseText: "AUTHENTICATIONFAILED Invalid credentials" });
    return {
      async open() { if (options.hang) await new Promise(() => undefined); return { uidValidity: options.uidValidity ?? "77", uidNext: Math.max(0, ...mails.map(m => m.uid)) + 1 }; },
      async search(query) { searches.push(query); return query.uid ? mails.filter(m => m.uid >= Number(query.uid!.split(":")[0])).map(m => m.uid) : mails.filter(m => (m.envelope?.date?.getTime() ?? 0) >= query.since!.getTime()).map(m => m.uid); },
      async fetch(uids) { return mails.filter(m => uids.includes(m.uid)); },
      async close() { /* nothing */ },
    };
  };
  return { opener, logins, searches };
}

describe("Hjerterum reads team@ itself", () => {
  it("connects only a mailbox that opens, keeps the password sealed, and reads the new mail each run, once", async () => {
    const db = testDatabase();
    const env = sagaEnv(db, { SAGA_TELEGRAM_WEBHOOK_SECRET: "webhook-secret-0123456789" });
    const d = deps(fakeServices().fetcher, NOW);
    const mails: FetchedMail[] = [
      { uid: 5, envelope: { date: new Date(NOW - 40 * 24 * 60 * MIN), subject: "For gammel", from: [{ name: "Gammel", address: "old@example.dk" }] } },
      { uid: 9, envelope: { date: new Date(NOW - 3 * 24 * 60 * MIN), subject: "Leje af salen", from: [{ name: "Mette Holm", address: "mette@example.dk" }] }, source: mime("Mette Holm <mette@example.dk>", "Leje af salen", "Kan vi leje salen den 14.?") },
    ];
    const box = fakeMailbox(mails, { password: "rigtig" });

    await expect(connectTeamMail(env, db, { address: "team@holistisk.org", password: "forkert", by: "Jacob", nowMs: NOW }, box.opener)).rejects.toThrow("mail_login_failed");
    expect(await teamMailAccount(db)).toBeNull();
    await expect(connectTeamMail(env, db, { address: "team@gmail.com", password: "rigtig", by: "Jacob", nowMs: NOW }, box.opener)).rejects.toThrow("mail_address_invalid");

    await connectTeamMail(env, db, { address: "Team@Holistisk.org", password: "rigtig", by: "Jacob", nowMs: NOW }, box.opener);
    const account = (await teamMailAccount(db))!;
    expect(account.address).toBe("team@holistisk.org");
    expect(account.password_sealed).not.toContain("rigtig");
    expect(await openPassword(env, account.password_sealed)).toBe("rigtig");

    // The first run reaches 30 days back: the 40-day-old mail is left, the new one kept with its text.
    expect(await readTeamMail(env, d, db, box.opener)).toEqual({ read: 1 });
    const kept = await db.prepare("SELECT message_ref, sender, subject, preview FROM board_mail").all<Record<string, string>>();
    expect(kept.results).toEqual([{ message_ref: "imap:77:9", sender: "Mette Holm <mette@example.dk>", subject: "Leje af salen", preview: "Kan vi leje salen den 14.?" }]);
    expect((await teamMailAccount(db))!.last_uid).toBe(9);
    expect(await mailWatch(db, NOW + MIN)).toMatchObject({ state: "ok", detail: expect.stringContaining("1 hentet") });

    // The next run asks only for what came after, and keeps nothing twice.
    mails.push({ uid: 10, envelope: { date: new Date(NOW), subject: "Tak for sidst", from: [{ address: "ole@example.dk" }] }, source: mime("ole@example.dk", "Tak for sidst", "Hej") });
    expect(await readTeamMail(env, deps(fakeServices().fetcher, NOW + 5 * MIN), db, box.opener)).toEqual({ read: 1 });
    expect(box.searches.at(-1)).toEqual({ uid: "10:*" });
    expect(await readTeamMail(env, deps(fakeServices().fetcher, NOW + 10 * MIN), db, box.opener)).toEqual({ read: 0 });
    expect((await db.prepare("SELECT COUNT(*) AS n FROM board_mail").first<{ n: number }>())!.n).toBe(2);
    expect(box.logins.every(l => l === "imap.one.com:team@holistisk.org")).toBe(true);
  });

  it("records a refused password and a lost key as the watch's error - never as connected", async () => {
    const db = testDatabase();
    const env = sagaEnv(db, { SAGA_TELEGRAM_WEBHOOK_SECRET: "webhook-secret-0123456789" });
    await connectTeamMail(env, db, { address: "team@holistisk.org", password: "rigtig", by: "Jacob", nowMs: NOW }, fakeMailbox([]).opener);

    expect(await readTeamMail(env, deps(fakeServices().fetcher, NOW), db, fakeMailbox([], { password: "ny" }).opener)).toEqual({ read: 0, error: "mail_login_failed" });
    expect((await mailWatch(db, NOW + MIN)).detail).toBe("team@ afviste adgangskoden. Formanden forbinder den igen under Posthus.");

    const other = sagaEnv(db, { SAGA_TELEGRAM_WEBHOOK_SECRET: "another-secret-0123456789" });
    expect(await readTeamMail(other, deps(fakeServices().fetcher, NOW), db, fakeMailbox([]).opener)).toEqual({ read: 0, error: "mail_password_unreadable" });

    await disconnectTeamMail(db, NOW);
    expect(await teamMailAccount(db)).toBeNull();
    expect(await readTeamMail(env, deps(fakeServices().fetcher, NOW), db, fakeMailbox([]).opener)).toEqual({ read: 0 });
    expect((await mailWatch(db, NOW + MIN)).detail).toBe("team@ er ikke forbundet. Formanden forbinder den under Posthus.");
  });
});
