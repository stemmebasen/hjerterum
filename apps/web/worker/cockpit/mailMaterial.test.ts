import { describe, expect, it } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import type { WebFolder, WebmailOpener } from "./webmail.js";
import { filePrMails, PR_FOLDER, prMailData, prMailSection, takeOverFolder } from "./prMail.js";
import { matchEvent, mentionedDays, upcomingEvents } from "./mailMaterial.js";
import { studioData } from "./posterStudio.js";
import { connectTeamMail, type ImapOpener } from "../saga/teamMail.js";
import { insertMail, saveBoardMessage } from "../saga/store.js";
import { BOARD, deps, fakeServices, OWNER, personalCookie, sagaEnv, testDatabase } from "../saga/test-support.js";

// Requested (the chair, 5 Nov 2026): "Det ville være rigtig fint, at der allerede er lavet en kobling til det pågældende event og at materialet, der er sendt
// allerede ligger klar i den pågældende mappe under det pågældende event klar til brug. Kan vi indsætte en knap, som tager mig direkte til redigeringen af
// opslaget med det pågældende materiale?" - and "Flyt til PR", "Skjul", and Gitta's PR mails taken over.
const NOW = Date.parse("2026-11-05T12:00:00Z");
const ORIGIN = "https://admin.hjerterum.example";
const HEX = "6ae8cff06e0ca88f0503bf74";
const PIA = Date.parse("2026-11-24T18:00:00Z");
const JPEG = (() => { const b = new Uint8Array(60_000); b.set([0xff, 0xd8, 0xff, 0xe0]); return b; })();
const b64 = (bytes: Uint8Array) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/.{76}/g, "$&\r\n"); };
const RAW = ["From: Pia Lundgaard Brændstrup <pia@piabraendstrup.dk>", "To: team@holistisk.org", "Message-ID: <pr-pia@example.dk>", "Subject: PR- Hjerterum", "Date: Thu, 5 Nov 2026 12:42:00 +0100",
  "MIME-Version: 1.0", 'Content-Type: multipart/mixed; boundary="b1"', "", "--b1", "Content-Type: text/plain; charset=utf-8", "",
  "Kære Hjerterum. Hermed PR materiale for min kommende workshop. Dato: Tirsdag den 24 november. Klokkeslæt: 19.00 - 20.30.", "",
  "--b1", "Content-Type: image/jpeg; name=\"naervaer.jpg\"", "Content-Disposition: attachment; filename=\"naervaer.jpg\"", "Content-Transfer-Encoding: base64", "", b64(JPEG), "",
  "--b1", "Content-Type: text/plain; name=\"tekst.txt\"", "Content-Disposition: attachment; filename=\"tekst.txt\"", "", "Nærvær - midt i alt det, der skal nås.", "", "--b1--", ""].join("\r\n");

async function setup(folders: WebFolder[] = [{ path: "INBOX", name: "Indbakke", special: "\\Inbox", depth: 0, unseen: 0, total: 1, selectable: true }]) {
  const db = testDatabase();
  const objects = new Map<string, Uint8Array>();
  const media = { put: async (k: string, v: ArrayBuffer) => { objects.set(k, new Uint8Array(v)); return {}; }, get: async (k: string) => objects.has(k) ? { body: new Blob([objects.get(k)!.slice()]).stream() } : null, delete: async () => undefined };
  const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026", SAGA_TELEGRAM_WEBHOOK_SECRET: "webhook-secret-0123456789", EVENT_MEDIA: media } as never);
  const imap: ImapOpener = async () => ({ async open() { return { uidValidity: "77", uidNext: 1 }; }, async search() { return []; }, async fetch() { return []; }, async close() { /* nothing */ } });
  await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Jacob Hauge", authorId: OWNER, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
  await connectTeamMail(env, db, { address: "team@holistisk.org", password: "rigtig", by: "Jacob Hauge", nowMs: NOW }, imap);
  // The calendar of the 24th: Pia's workshop, and three others the same day.
  for (const [id, title, host, at] of [[`SF${HEX}`, "Nærvær – midt i alt det, der skal nås", "Pia Brændstrup", PIA], ["SF6ad87e578239541f7d0d7a63", "Dhyana Yoga", "Kasper Frausing", PIA - 36_000_000],
    ["SF6a294d5b2051a7813506bff1", "Restorative Sound & Yoga", "Anna Ananda", PIA - 9_000_000], ["SF6abf5fc77733b573ed0b7e9d", "Dhyana Yoga", "Kasper Frausing", PIA - 30_600_000]] as const)
    await db.prepare("INSERT INTO house_events (id, title, starts_at_ms, host, content_hash, updated_at_ms, description) VALUES (?, ?, ?, ?, 'x', 0, 'Om eventet')").bind(id, title, at, host).run();
  const mail = (await insertMail(db, { ref: `imap:${PR_FOLDER}:500:3`, sender: "Pia Lundgaard Brændstrup <pia@piabraendstrup.dk>", subject: "PR- Hjerterum", receivedAtMs: NOW - 3_600_000, preview: "Kære Hjerterum. Hermed PR materiale", nowMs: NOW }))!;
  await db.prepare("UPDATE board_mail SET folder = ?, uid_validity = '500', uid = 3, label = 'PR', message_id = '<pr-pia@example.dk>' WHERE id = ?").bind(PR_FOLDER, mail).run();
  const done: string[] = [];
  const opener: WebmailOpener = async () => ({
    async folders() { return folders; }, async list() { return { total: 0, items: [] }; },
    async source(path, uid) { return path === PR_FOLDER && uid === 3 ? { source: new TextEncoder().encode(RAW), seen: true, flagged: false } : null; },
    async setFlag() { /* nothing */ }, async move() { return { uidValidity: "77" }; }, async remove() { return { uidValidity: "77" }; }, async append() { /* nothing */ },
    async uidValidity(path) { return path === PR_FOLDER ? "500" : "77"; }, async present() { return []; },
    async create(path) { done.push(`create ${path}`); },
    async moveMapped(path, uids, dest) { done.push(`move ${path} ${uids.join(",")} -> ${dest}`); return { sourceValidity: "77", destValidity: "500", map: uids.map(u => [u, u + 100] as [number, number]) }; },
    async close() { /* nothing */ },
  });
  const allDeps = { ...deps(fakeServices().fetcher, NOW), webmail: opener };
  return { db, env, objects, mail, done, allDeps };
}

describe("a PR mail's material, kept with its event", () => {
  it("finds the event by the teacher's name and the day the mail mentions", async () => {
    expect(mentionedDays("Dato: Tirsdag den 24 november", NOW)).toEqual(["2026-11-24"]);
    expect(mentionedDays("Vi ses 3/1 og 24.11", NOW)).toEqual(["2027-01-03", "2026-11-24"]);
    const { db } = await setup();
    const events = await upcomingEvents(db, NOW);
    expect(matchEvent(events, { sender: "Pia Lundgaard Brændstrup <pia@piabraendstrup.dk>", subject: "PR- Hjerterum", text: "Tirsdag den 24 november kl. 19", receivedMs: NOW })?.key).toBe(`mw:SF${HEX}`);
    // A day alone is not enough among four events that day.
    expect(matchEvent(events, { sender: "Bo <bo@example.dk>", subject: "PR", text: "Tirsdag den 24 november", receivedMs: NOW })).toBeNull();
  });

  it("keeps the pictures, files and words with the event, and the button goes to the post with them", async () => {
    const { db, env, objects, mail, allDeps } = await setup();
    await filePrMails(env, allDeps, db);
    expect(await db.prepare("SELECT pr_event_key, pr_material_at_ms IS NOT NULL AS seen FROM board_mail WHERE id = ?").bind(mail).first()).toEqual({ pr_event_key: `mw:SF${HEX}`, seen: 1 });
    const kept = await db.prepare("SELECT kind, filename, content_type FROM event_material ORDER BY id").all();
    expect(kept.results).toEqual([{ kind: "image", filename: "naervaer.jpg", content_type: "image/jpeg" }, { kind: "file", filename: "tekst.txt", content_type: "text/plain; charset=utf-8" },
      { kind: "text", filename: "PR- Hjerterum", content_type: null }]);
    expect([...objects.keys()].every(k => k.startsWith(`material/mw_SF${HEX}/`))).toBe(true);
    const page = prMailSection("", await prMailData(db), await upcomingEvents(db, NOW), NOW);
    expect(page).toContain("Event: <b>Nærvær – midt i alt det, der skal nås</b>");
    expect(page).toContain("2 filer fra mailen ligger klar");
    expect(page).toContain(`href="/plakater/${HEX}?fra=%2Fpr%2Fmails">Lav opslaget med materialet →</a>`);
    // The studio has the mail's picture first (so it is the one chosen), its file, and its words.
    const data = (await studioData(db, HEX, NOW))!;
    expect(data.eventPictures[0]).toMatchObject({ label: "Fra mailen: naervaer.jpg", url: expect.stringMatching(/^\/plakater\/billede\/materiale\/\d+$/) });
    expect(data.files[0]).toMatchObject({ label: "Fra mailen: tekst.txt" });
    expect(data.mailTexts[0]!.text).toContain("Hermed PR materiale for min kommende workshop");
    const cookie = await personalCookie("Jacob Hauge", NOW);
    const picture = await handleCockpitRequest(new Request(ORIGIN + data.eventPictures[0]!.url, { headers: { cookie } }), env, allDeps);
    expect(picture.headers.get("content-type")).toBe("image/jpeg");
    // Looked at once.
    await filePrMails(env, allDeps, db);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM event_material").first<{ n: number }>())!.n).toBe(3);
  });

  it("is linked by the chair when Saga cannot tell; moved to PR and hidden by a press", async () => {
    const { db, env, mail, done, allDeps } = await setup();
    await db.prepare("UPDATE board_mail SET sender = 'Ukendt <x@example.dk>', pr_material_at_ms = 1 WHERE id = ?").bind(mail).run();
    const cookie = await personalCookie("Jacob Hauge", NOW);
    const post = (path: string, fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return handleCockpitRequest(new Request(ORIGIN + path, { method: "POST", body: f, headers: { cookie, origin: ORIGIN } }), env, allDeps); };
    expect(prMailSection("", await prMailData(db), await upcomingEvents(db, NOW), NOW)).toContain(`<option value="mw:SF${HEX}">`);
    expect((await post("/pr/mails/kobl", { id: String(mail), event: `mw:SF${HEX}` })).headers.get("location")).toBe("/pr/mails?besked=koblet");
    expect(await db.prepare("SELECT pr_event_key FROM board_mail WHERE id = ?").bind(mail).first()).toEqual({ pr_event_key: `mw:SF${HEX}` });
    // A mail in Gitta's folder, moved by the chair's own press.
    const other = (await insertMail(db, { ref: "imap:INBOX.3 - GITTA:9:4", sender: "Rie <rie@example.dk>", subject: "Billeder", receivedAtMs: NOW - 600_000, preview: "PR", nowMs: NOW }))!;
    await db.prepare("UPDATE board_mail SET folder = 'INBOX.3 - GITTA', uid_validity = '9', uid = 4, label = 'PR' WHERE id = ?").bind(other).run();
    expect(prMailSection("", await prMailData(db))).toContain('action="/pr/mails/flyt"');
    expect((await post("/pr/mails/flyt", { id: String(other) })).headers.get("location")).toBe("/pr/mails?besked=flyttet_mail");
    expect(done).toContain(`move INBOX.3 - GITTA 4 -> ${PR_FOLDER}`);
    expect(await db.prepare("SELECT folder, uid FROM board_mail WHERE id = ?").bind(other).first()).toEqual({ folder: PR_FOLDER, uid: 104 });
    // "Skjul": gone from the list; a new mail in the same thread shows.
    await post("/pr/mails/skjul", { id: String(other) });
    expect((await prMailData(db)).map(m => m.id)).not.toContain(other);
    const reply = (await insertMail(db, { ref: "imap:77:90", sender: "Rie <rie@example.dk>", subject: "Re: Billeder", receivedAtMs: NOW, preview: "Her er flere", nowMs: NOW }))!;
    await db.prepare("UPDATE board_mail SET folder = 'INBOX', label = 'PR' WHERE id = ?").bind(reply).run();
    expect((await prMailData(db)).map(m => m.id)).toContain(reply);
  });

  it("takes over the mails in Gitta's PR folder, once asked to", async () => {
    const { db, env, done, allDeps } = await setup([{ path: "INBOX.3 - GITTA.PR", name: "PR", special: null, depth: 2, unseen: 0, total: 1, selectable: true },
      { path: "INBOX.3 - GITTA.PR.Afsluttet -1", name: "Afsluttet", special: null, depth: 3, unseen: 0, total: 1, selectable: true }]);
    const hers = (await insertMail(db, { ref: "imap:INBOX.3 - GITTA.PR:9:7", sender: "Rie <rie@example.dk>", subject: "pr", receivedAtMs: NOW - 86_400_000, preview: "x", nowMs: NOW }))!;
    await db.prepare("UPDATE board_mail SET folder = 'INBOX.3 - GITTA.PR', uid_validity = '9', uid = 7 WHERE id = ?").bind(hers).run();
    const original = allDeps.webmail;
    const webmail: typeof original = async login => { const s = await original(login); return { ...s, async list(path: string) { return path === "INBOX.3 - GITTA.PR" ? { total: 1, items: [{ uid: 7 } as never] } : { total: 0, items: [] }; } }; };
    expect(await takeOverFolder(env, { ...allDeps, webmail }, db, /^INBOX\.3\s*-\s*GITTA\.PR$/i)).toBe(1);
    expect(done).toContain(`move INBOX.3 - GITTA.PR 7 -> ${PR_FOLDER}`);
    expect(done.some(d => d.includes("Afsluttet"))).toBe(false);
    expect(await db.prepare("SELECT folder, uid FROM board_mail WHERE id = ?").bind(hers).first()).toEqual({ folder: PR_FOLDER, uid: 107 });
  });
});
