import { describe, expect, it } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import type { WebFolder, WebmailOpener } from "./webmail.js";
import { filePrMails, PR_FOLDER, PR_PARENT } from "./prMail.js";
import { connectTeamMail, type ImapOpener } from "../saga/teamMail.js";
import { insertMail, saveBoardMessage } from "../saga/store.js";
import type { MailSender, Outgoing } from "./webmailCompose.js";
import { BOARD, deps, fakeServices, OWNER, personalCookie, sagaEnv, testDatabase } from "../saga/test-support.js";

// Requested (the chair, 4 Nov 2026): "Jeg har brug for, at Saga finder de mails fra mailboksen, der vedrører PR, deling og sociale medier, at de lander i
// min undermappe og at de bliver vist i min PR-sektion. Jeg har også brug for smart at kunne svare tilbage i PR-sektionen." - the folder "5 - JACOB › PR".
const NOW = Date.parse("2026-11-04T12:00:00Z");
const ORIGIN = "https://admin.hjerterum.example";
const RAW = ["From: Maria Dueholm <maria@example.dk>", "To: team@holistisk.org", "Message-ID: <deling-1@example.dk>", "Subject: Vil I dele mit forløb?", "Date: Wed, 4 Nov 2026 09:30:00 +0100",
  "Content-Type: text/plain; charset=utf-8", "", "Hej Hjerterum, vil I dele mit forløb Women Gathers på Instagram? Jeg har billeder klar.", ""].join("\r\n");

async function setup() {
  const db = testDatabase();
  const services = fakeServices({ ai: system => system.includes("udkast til et svar") ? "Tak for din mail, Maria. Tag gerne @hjerterum_aarhus i dit opslag, så deler vi det." : "{}" });
  const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026", SAGA_TELEGRAM_WEBHOOK_SECRET: "webhook-secret-0123456789" });
  const imap: ImapOpener = async () => ({ async open() { return { uidValidity: "77", uidNext: 1 }; }, async search() { return []; }, async fetch() { return []; }, async close() { /* nothing */ } });
  await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Jacob Hauge", authorId: OWNER, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
  await connectTeamMail(env, db, { address: "team@holistisk.org", password: "rigtig", by: "Jacob Hauge", nowMs: NOW }, imap);
  // Two mails in the inbox: one about PR (labelled by Saga), one not.
  const pr = (await insertMail(db, { ref: "imap:77:41", sender: "Maria Dueholm <maria@example.dk>", subject: "Vil I dele mit forløb?", receivedAtMs: NOW - 3_600_000, preview: "Hej Hjerterum, vil I dele mit forløb på Instagram?", nowMs: NOW }))!;
  const other = (await insertMail(db, { ref: "imap:77:42", sender: "Bo <bo@example.dk>", subject: "Kontingent", receivedAtMs: NOW - 1_800_000, preview: "Hvordan betaler jeg?", nowMs: NOW }))!;
  await db.prepare("UPDATE board_mail SET folder = 'INBOX', uid_validity = '77', uid = 41, label = 'PR' WHERE id = ?").bind(pr).run();
  await db.prepare("UPDATE board_mail SET folder = 'INBOX', uid_validity = '77', uid = 42, label = 'Medlem' WHERE id = ?").bind(other).run();
  const done: string[] = [];
  const folders: WebFolder[] = [{ path: "INBOX", name: "Indbakke", special: "\\Inbox", depth: 0, unseen: 1, total: 2, selectable: true }, { path: "INBOX.Sent", name: "Sendt", special: "\\Sent", depth: 0, unseen: 0, total: 0, selectable: true }];
  const opener: WebmailOpener = async () => ({
    async folders() { return folders; },
    async list() { return { total: 0, items: [] }; },
    async source(path, uid) { return path === PR_FOLDER && uid === 9 ? { source: new TextEncoder().encode(RAW), seen: true, flagged: false } : null; },
    async setFlag(path, uids, flag, on) { done.push(`${on ? "set" : "unset"} ${flag} ${path} ${uids.join(",")}`); },
    async move() { return { uidValidity: "77" }; },
    async remove() { return { uidValidity: "77" }; },
    async append(path) { done.push(`append ${path}`); },
    async uidValidity(path) { return path === PR_FOLDER ? "500" : "77"; },
    async create(path) { done.push(`create ${path}`); folders.push({ path, name: path, special: null, depth: 1, unseen: 0, total: 0, selectable: true }); },
    async moveMapped(path, uids, dest) { done.push(`move ${path} ${uids.join(",")} -> ${dest}`); return { sourceValidity: "77", destValidity: "500", map: uids.map(u => [u, 9] as [number, number]) }; },
    async close() { /* nothing */ },
  });
  const outgoing: Outgoing[] = [];
  const send: MailSender = async (_login, mail) => { outgoing.push(mail); return { raw: new TextEncoder().encode("raw"), messageId: "<svar@holistisk.org>" }; };
  const allDeps = { ...deps(services.fetcher, NOW), webmail: opener, webmailSend: send };
  return { db, env, services, done, outgoing, pr, other, allDeps };
}

describe("PR mails", () => {
  it("lands in 5 - JACOB › PR, once, and Posthus follows it there; the chair is told", async () => {
    const { db, env, services, done, pr, other, allDeps } = await setup();
    expect(await filePrMails(env, allDeps, db)).toBe(1);
    expect(done).toEqual([`create ${PR_PARENT}`, `create ${PR_FOLDER}`, `move INBOX 41 -> ${PR_FOLDER}`]);
    expect(await db.prepare("SELECT folder, uid, uid_validity, message_ref FROM board_mail WHERE id = ?").bind(pr).first()).toEqual({ folder: PR_FOLDER, uid: 9, uid_validity: "500", message_ref: `imap:${PR_FOLDER}:500:9` });
    expect(await db.prepare("SELECT folder, uid FROM board_mail WHERE id = ?").bind(other).first()).toEqual({ folder: "INBOX", uid: 42 });
    expect(services.telegram("sendMessage").map(c => JSON.stringify(c.body)).join()).toContain("Ny PR-mail fra Maria Dueholm");
    // The next round: nothing to move.
    expect(await filePrMails(env, allDeps, db)).toBe(0);
  });

  it("is shown in PR og SoMe → Mails and answered there with Saga's draft, sent from team@ by the chair", async () => {
    const { db, env, done, outgoing, pr, allDeps } = await setup();
    await filePrMails(env, allDeps, db);
    const cookie = await personalCookie("Jacob Hauge", NOW);
    const call = (path: string, init: RequestInit = {}) => handleCockpitRequest(new Request(ORIGIN + path, { ...init, headers: { cookie, ...(init.method === "POST" ? { origin: ORIGIN } : {}) } }), env, allDeps);
    const list = await (await call("/pr/mails")).text();
    expect(list).toContain("Mails om PR (1 venter)");
    expect(list).toContain("Vil I dele mit forløb?");
    expect(list).toContain(`href="/pr/mails/svar?id=${pr}"`);
    const reply = await (await call(`/pr/mails/svar?id=${pr}`)).text();
    expect(reply).toContain("Saga har skrevet et udkast");
    expect(reply).toContain("Tak for din mail, Maria. Tag gerne @hjerterum_aarhus i dit opslag, så deler vi det.");
    expect(reply).toContain('name="tilbage" value="/pr/mails"');
    expect(reply).toContain("Re: Vil I dele mit forløb?");
    // The chair sends it (Posthus' own send): from team@, as an answer, laid in Sendt, and back to the PR section.
    const form = new FormData();
    for (const [k, v] of Object.entries({ type: "svar", mappe: PR_FOLDER, uid: "9", til: "Maria Dueholm <maria@example.dk>", emne: "Re: Vil I dele mit forløb?", tekst: "Tak, Maria!", handling: "send", tilbage: "/pr/mails" })) form.append(k, v);
    const sent = await call("/posthus/mail/send", { method: "POST", body: form });
    expect(sent.headers.get("location")).toBe("/pr/mails?besked=sendt");
    expect(outgoing[0]).toMatchObject({ subject: "Re: Vil I dele mit forløb?", text: "Tak, Maria!", inReplyTo: "<deling-1@example.dk>" });
    expect(done).toContain(`set \\Answered ${PR_FOLDER} 9`);
    expect(await db.prepare("SELECT answered_at_ms IS NOT NULL AS yes FROM board_mail WHERE id = ?").bind(pr).first()).toEqual({ yes: 1 });
    expect(await (await call("/pr/mails?besked=sendt")).text()).toContain("Svaret er sendt fra team@");
  });
});
