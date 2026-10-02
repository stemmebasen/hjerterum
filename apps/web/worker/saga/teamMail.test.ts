import { describe, expect, it } from "vitest";
import { enquiries, setHandled } from "../cockpit/enquiries.js";
import { mailWatch } from "./connections.js";
import { connectTeamMail, disconnectTeamMail, openPassword, readableFolders, readTeamMail, sameSubject, teamMailAccount, type FetchedMail, type ImapOpener, type MailFolder } from "./teamMail.js";
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

/** A mailbox with folders: each folder its own mails and UIDs, opened one at a time like IMAP. */
function fakeFolders(boxes: Record<string, FetchedMail[]>, listing: MailFolder[]) {
  const opened: string[] = [];
  let current = "INBOX";
  const opener: ImapOpener = async () => ({
    async folders() { return listing; },
    async open(path = "INBOX") {
      if (!(path in boxes)) throw new Error(`no folder ${path}`);
      opened.push(path); current = path;
      return { uidValidity: `v-${path}`, uidNext: Math.max(0, ...boxes[path]!.map(m => m.uid)) + 1 };
    },
    async search(query) {
      const mails = boxes[current]!;
      return query.uid ? mails.filter(m => m.uid >= Number(query.uid!.split(":")[0])).map(m => m.uid) : mails.filter(m => (m.envelope?.date?.getTime() ?? 0) >= query.since!.getTime()).map(m => m.uid);
    },
    async fetch(uids) { return boxes[current]!.filter(m => uids.includes(m.uid)); },
    async close() { /* nothing */ },
  });
  return { opener, opened };
}
const mail = (uid: number, subject: string, at: number, from = "gæst@example.dk"): FetchedMail => ({ uid, envelope: { date: new Date(at), subject, from: [{ address: from }] }, source: mime(from, subject, subject) });

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
    expect(await readTeamMail(env, d, db, box.opener)).toEqual({ read: 1, answered: 0 });
    const kept = await db.prepare("SELECT message_ref, sender, subject, preview FROM board_mail").all<Record<string, string>>();
    expect(kept.results).toEqual([{ message_ref: "imap:77:9", sender: "Mette Holm <mette@example.dk>", subject: "Leje af salen", preview: "Kan vi leje salen den 14.?" }]);
    expect(await db.prepare("SELECT path, uid_validity, last_uid FROM team_mail_folders").all()).toMatchObject({ results: [{ path: "INBOX", uid_validity: "77", last_uid: 9 }] });
    expect(await mailWatch(db, NOW + MIN)).toMatchObject({ state: "ok", detail: expect.stringContaining("1 hentet") });

    // The next run asks only for what came after, and keeps nothing twice.
    mails.push({ uid: 10, envelope: { date: new Date(NOW), subject: "Tak for sidst", from: [{ address: "ole@example.dk" }] }, source: mime("ole@example.dk", "Tak for sidst", "Hej") });
    expect(await readTeamMail(env, deps(fakeServices().fetcher, NOW + 5 * MIN), db, box.opener)).toEqual({ read: 1, answered: 0 });
    expect(box.searches.at(-1)).toEqual({ uid: "10:*" });
    expect(await readTeamMail(env, deps(fakeServices().fetcher, NOW + 10 * MIN), db, box.opener)).toEqual({ read: 0, answered: 0 });
    expect((await db.prepare("SELECT COUNT(*) AS n FROM board_mail").first<{ n: number }>())!.n).toBe(2);
    expect(box.logins.every(l => l === "imap.one.com:team@holistisk.org")).toBe(true);
  });

  it("records a refused password and a lost key as the watch's error - never as connected", async () => {
    const db = testDatabase();
    const env = sagaEnv(db, { SAGA_TELEGRAM_WEBHOOK_SECRET: "webhook-secret-0123456789" });
    await connectTeamMail(env, db, { address: "team@holistisk.org", password: "rigtig", by: "Jacob", nowMs: NOW }, fakeMailbox([]).opener);

    expect(await readTeamMail(env, deps(fakeServices().fetcher, NOW), db, fakeMailbox([], { password: "ny" }).opener)).toEqual({ read: 0, answered: 0, error: "mail_login_failed" });
    expect((await mailWatch(db, NOW + MIN)).detail).toBe("team@ afviste adgangskoden. Formanden forbinder den igen under Posthus.");

    const other = sagaEnv(db, { SAGA_TELEGRAM_WEBHOOK_SECRET: "another-secret-0123456789" });
    expect(await readTeamMail(other, deps(fakeServices().fetcher, NOW), db, fakeMailbox([]).opener)).toEqual({ read: 0, answered: 0, error: "mail_password_unreadable" });

    await disconnectTeamMail(db, NOW);
    expect(await teamMailAccount(db)).toBeNull();
    expect(await readTeamMail(env, deps(fakeServices().fetcher, NOW), db, fakeMailbox([]).opener)).toEqual({ read: 0, answered: 0 });
    expect((await mailWatch(db, NOW + MIN)).detail).toBe("team@ er ikke forbundet. Formanden forbinder den under Posthus.");
  });
});

// Requested: "Hun skal læse alle relevante mails fra både hovedmappen og undermapper".
describe("Saga reads the inbox and the subfolders of team@", () => {
  const listing: MailFolder[] = [
    { path: "INBOX", delimiter: "." },
    { path: "INBOX.Bookinger", delimiter: "." },
    { path: "INBOX.Sent", delimiter: ".", specialUse: "\\Sent" },
    { path: "INBOX.Kladder", delimiter: "." },
    { path: "Papirkurv", delimiter: "." },
    { path: "Papirkurv.Gammelt", delimiter: "." },
    { path: "Spam", delimiter: "." },
    { path: "Arkiv", delimiter: ".", noSelect: true },
    { path: "Arkiv.2026", delimiter: "." },
  ];

  it("reads every folder but sent mail, drafts, trash and spam - the inbox first", () => {
    expect(readableFolders(listing)).toEqual(["INBOX", "INBOX.Bookinger", "Arkiv.2026"]);
    // A server marking or a Danish name is enough, and the inbox is read even when the listing leaves it out.
    expect(readableFolders([{ path: "Sendte elementer", delimiter: "/" }, { path: "Projekter/Udlejning", delimiter: "/" }, { path: "Noget", specialUse: "\\Junk" }])).toEqual(["INBOX", "Projekter/Udlejning"]);
  });

  it("keeps each folder's place, never reads the skipped folders, and keeps a mail moved between folders once", async () => {
    const db = testDatabase();
    const env = sagaEnv(db, { SAGA_TELEGRAM_WEBHOOK_SECRET: "webhook-secret-0123456789" });
    const day = 24 * 60 * MIN;
    const boxes: Record<string, FetchedMail[]> = {
      "INBOX": [mail(3, "Leje af salen", NOW - 2 * day, "mette@example.dk")],
      "INBOX.Bookinger": [mail(1, "Booking 14. november", NOW - 5 * day, "ole@example.dk"), mail(2, "Leje af salen", NOW - 2 * day, "mette@example.dk")],
      "INBOX.Sent": [mail(1, "Vores svar", NOW - day, "team@holistisk.org")],
      "INBOX.Kladder": [mail(1, "Udkast", NOW - day)], "Papirkurv": [mail(1, "Slettet", NOW - day)], "Papirkurv.Gammelt": [mail(1, "Gammelt", NOW - day)],
      "Spam": [mail(1, "Vind en iPhone", NOW - day)], "Arkiv.2026": [mail(7, "Regnskab 2025", NOW - 10 * day, "revisor@example.dk")],
    };
    const box = fakeFolders(boxes, listing);
    await connectTeamMail(env, db, { address: "team@holistisk.org", password: "rigtig", by: "Jacob", nowMs: NOW }, box.opener);

    expect(await readTeamMail(env, deps(fakeServices().fetcher, NOW), db, box.opener)).toEqual({ read: 4, answered: 0 });
    expect(box.opened.slice(1)).toEqual(["INBOX", "Arkiv.2026", "INBOX.Bookinger", "INBOX.Sent"]);
    const kept = await db.prepare("SELECT message_ref, subject FROM board_mail ORDER BY received_at_ms").all<Record<string, string>>();
    expect(kept.results).toEqual([
      { message_ref: "imap:Arkiv.2026:v-Arkiv.2026:7", subject: "Regnskab 2025" },
      { message_ref: "imap:INBOX.Bookinger:v-INBOX.Bookinger:1", subject: "Booking 14. november" },
      { message_ref: "imap:v-INBOX:3", subject: "Leje af salen" },
    ]);
    expect((await db.prepare("SELECT path, last_uid FROM team_mail_folders ORDER BY path").all()).results).toEqual([
      { path: "Arkiv.2026", last_uid: 7 }, { path: "INBOX", last_uid: 3 }, { path: "INBOX.Bookinger", last_uid: 2 }, { path: "INBOX.Sent", last_uid: 1 },
    ]);
    expect(await mailWatch(db, NOW + MIN)).toMatchObject({ state: "ok", detail: expect.stringContaining("4 nye i 3 mapper, 4 hentet") });

    // Next run: only what came after, in each folder.
    boxes["INBOX.Bookinger"]!.push(mail(3, "Ny booking", NOW + MIN, "lise@example.dk"));
    expect(await readTeamMail(env, deps(fakeServices().fetcher, NOW + 5 * MIN), db, box.opener)).toEqual({ read: 1, answered: 0 });
    expect((await db.prepare("SELECT COUNT(*) AS n FROM board_mail").first<{ n: number }>())!.n).toBe(4);

    // A folder that will not open is passed over; the others are still read.
    listing.push({ path: "Mærkelig", delimiter: "." });
    boxes["INBOX"]!.push(mail(4, "Stadig læst", NOW + 6 * MIN, "lise@example.dk"));
    expect(await readTeamMail(env, deps(fakeServices().fetcher, NOW + 7 * MIN), db, box.opener)).toEqual({ read: 1, answered: 0 });
    listing.pop();

    // A folder that is gone loses its place; another mailbox starts over.
    delete boxes["Arkiv.2026"];
    listing.splice(listing.findIndex(f => f.path === "Arkiv.2026"), 1);
    await readTeamMail(env, deps(fakeServices().fetcher, NOW + 10 * MIN), db, box.opener);
    expect((await db.prepare("SELECT path FROM team_mail_folders ORDER BY path").all()).results).toEqual([{ path: "INBOX" }, { path: "INBOX.Bookinger" }, { path: "INBOX.Sent" }]);
    await connectTeamMail(env, db, { address: "team@holistisk.org", password: "nyt", by: "Jacob", nowMs: NOW }, box.opener);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM team_mail_folders").first<{ n: number }>())!.n).toBe(3);
    await connectTeamMail(env, db, { address: "bestyrelse@holistisk.org", password: "nyt", by: "Jacob", nowMs: NOW }, box.opener);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM team_mail_folders").first<{ n: number }>())!.n).toBe(0);
  });

  it("shares 12 mails a run between the folders and leaves a folder's place alone when it got no room", async () => {
    const db = testDatabase();
    const env = sagaEnv(db, { SAGA_TELEGRAM_WEBHOOK_SECRET: "webhook-secret-0123456789" });
    const many = Array.from({ length: 20 }, (_, i) => mail(i + 1, `Mail ${i + 1}`, NOW - (20 - i) * 60 * MIN, `afsender${i}@example.dk`));
    const boxes: Record<string, FetchedMail[]> = { "INBOX": many, "INBOX.Bookinger": [mail(4, "Booking", NOW - 60 * MIN, "ole@example.dk")] };
    const box = fakeFolders(boxes, [{ path: "INBOX", delimiter: "." }, { path: "INBOX.Bookinger", delimiter: "." }]);
    await connectTeamMail(env, db, { address: "team@holistisk.org", password: "rigtig", by: "Jacob", nowMs: NOW }, box.opener);

    expect(await readTeamMail(env, deps(fakeServices().fetcher, NOW), db, box.opener)).toEqual({ read: 12, answered: 0 });
    expect((await db.prepare("SELECT path, last_uid FROM team_mail_folders").all()).results).toEqual([{ path: "INBOX", last_uid: 12 }]);
    // The folder that waited is read next time, and the inbox goes on from 13.
    expect(await readTeamMail(env, deps(fakeServices().fetcher, NOW + 5 * MIN), db, box.opener)).toEqual({ read: 9, answered: 0 });
    expect((await db.prepare("SELECT path, last_uid FROM team_mail_folders ORDER BY path").all()).results).toEqual([{ path: "INBOX", last_uid: 20 }, { path: "INBOX.Bookinger", last_uid: 4 }]);
    // Each run says where it is, so a run cut off from outside shows where it stopped.
    expect((await db.prepare("SELECT detail FROM saga_status WHERE key = 'team_mail_progress'").first<{ detail: string }>())!.detail).toBe("færdig");
  });
});

// Asked: "hvordan ved Saga, at de ikke er besvaret?" - "Hun er nødt til at tjekke, om der er kommet svar i mailboksen".
describe("Saga sees in team@ which mails are answered", () => {
  it("reads Re:, Sv: and Fwd: as the same subject", () => {
    expect(sameSubject("Sv: RE: Fwd: Leje af  salen")).toBe(sameSubject("leje af salen"));
  });

  it("finds an answer in Sent, a mail marked answered and a mail put in Besvarede - and Posthus keeps only the rest", async () => {
    const db = testDatabase();
    const env = sagaEnv(db, { SAGA_TELEGRAM_WEBHOOK_SECRET: "webhook-secret-0123456789" });
    const day = 24 * 60 * MIN;
    const incoming = (uid: number, from: string, subject: string, at: number, extra: Partial<NonNullable<FetchedMail["envelope"]>> = {}): FetchedMail =>
      ({ uid, envelope: { date: new Date(at), subject, from: [{ address: from }], messageId: `<m${uid}@${from.split("@")[1]}>`, ...extra }, source: mime(from, subject, subject) });
    const boxes: Record<string, FetchedMail[]> = {
      "INBOX": [
        incoming(1, "mette@example.dk", "Leje af salen", NOW - 3 * day),
        incoming(2, "ole@example.dk", "Workshop i november", NOW - 2 * day),
        incoming(3, "lise@example.dk", "Medlemskab", NOW - day),
        // Prisberegneren's requests come from team@ with the asker as Reply-To.
        incoming(4, "team@holistisk.org", "Bookingforespørgsel: Yoga", NOW - day, { replyTo: [{ address: "kunde@example.dk" }] }),
      ],
      "INBOX.Besvarede": [incoming(1, "anna@example.dk", "Samarbejde", NOW - 4 * day)],
      "Sendt": [
        { uid: 1, envelope: { date: new Date(NOW - 2 * day), subject: "Re: Leje af salen", to: [{ address: "mette@example.dk" }], inReplyTo: "<m1@example.dk>" } },
        { uid: 2, envelope: { date: new Date(NOW - 12 * 60 * MIN), subject: "SV: Bookingforespørgsel: Yoga", to: [{ address: "kunde@example.dk" }] } },
        // A newsletter to many, Lise among them, answers no one.
        { uid: 3, envelope: { date: new Date(NOW - 6 * 60 * MIN), subject: "Nyhedsbrev oktober", to: ["a", "b", "c", "lise"].map(n => ({ address: `${n}@example.dk` })) } },
      ],
    };
    const box = fakeFolders(boxes, [{ path: "INBOX", delimiter: "." }, { path: "INBOX.Besvarede", delimiter: "." }, { path: "Sendt", delimiter: ".", specialUse: "\\Sent" }]);
    await connectTeamMail(env, db, { address: "team@holistisk.org", password: "rigtig", by: "Jacob", nowMs: NOW }, box.opener);

    expect(await readTeamMail(env, deps(fakeServices().fetcher, NOW), db, box.opener)).toEqual({ read: 5, answered: 3 });
    const how = async () => Object.fromEntries(((await db.prepare("SELECT subject, answered_how FROM board_mail").all<{ subject: string; answered_how: string | null }>()).results ?? []).map(r => [r.subject, r.answered_how]));
    expect(await how()).toEqual({ "Leje af salen": "svar", "Workshop i november": null, "Medlemskab": null, "Bookingforespørgsel: Yoga": "svar", "Samarbejde": "mappe" });
    // Sent mail is never kept as mail to the house.
    expect((await db.prepare("SELECT COUNT(*) AS n FROM board_mail WHERE subject LIKE '%Nyhedsbrev%'").first<{ n: number }>())!.n).toBe(0);

    // Ole got his answer from a mail program: the mail is marked answered in team@.
    boxes["INBOX"]![1]!.flags = ["\\Seen", "\\Answered"];
    expect(await readTeamMail(env, deps(fakeServices().fetcher, NOW + 5 * MIN), db, box.opener)).toEqual({ read: 0, answered: 1 });
    expect((await how())["Workshop i november"]).toBe("markeret");
    expect(await mailWatch(db, NOW + 6 * MIN)).toMatchObject({ detail: expect.stringContaining("1 fundet besvaret") });

    // Posthus: only Lise still waits; the rest says how it was answered.
    await db.prepare("UPDATE board_mail SET scanned_at_ms = ?, enquiry_kind = 'Lokaleleje'").bind(NOW).run();
    const list = await enquiries(db, NOW + 10 * MIN);
    expect(list.open.map(e => e.subject)).toEqual(["Medlemskab"]);
    expect(list.handled.map(e => e.subject).sort()).toEqual(["Bookingforespørgsel: Yoga", "Leje af salen", "Samarbejde", "Workshop i november"]);

    // Fortryd opens it again, and Saga does not close it again by herself.
    const mette = list.handled.find(e => e.subject === "Leje af salen")!;
    await setHandled(db, mette.id, "Jacob", false, NOW + 11 * MIN);
    await readTeamMail(env, deps(fakeServices().fetcher, NOW + 15 * MIN), db, box.opener);
    expect((await enquiries(db, NOW + 16 * MIN)).open.map(e => e.subject).sort()).toEqual(["Leje af salen", "Medlemskab"]);
  });
});

