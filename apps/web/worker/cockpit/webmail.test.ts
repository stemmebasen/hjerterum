import { describe, expect, it } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { hasAttachment, mailboxLink, orderFolders, parseMail, type WebFolder, type WebListItem, type WebmailOpener } from "./webmail.js";
import { connectTeamMail, type ImapOpener } from "../saga/teamMail.js";
import { deps, fakeServices, memberCookie, sagaEnv, testDatabase } from "../saga/test-support.js";

// Requested: "Posthus skal udbygges så det er en sand webmail med alle mapper, med alle svarmuligheder, og alle almindelige funktioner" - "Det vigtige er at
// alt kan holdes indenfor admin og at det er let at automatisere og køre AI indover" - "Ja". Step 1: reading.
const NOW = Date.parse("2026-10-16T10:00:00Z");
const ORIGIN = "https://admin.hjerterum.example";

const RAW = [
  "From: Pia Lund <pia@example.dk>", "To: team@holistisk.org", "Subject: Leje af salen", "Date: Thu, 15 Oct 2026 09:30:00 +0200", "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="b1"', "", "--b1", 'Content-Type: multipart/related; boundary="b2"', "", "--b2", "Content-Type: text/html; charset=utf-8", "",
  '<p>Hej, kan vi leje salen?</p><script>alert(1)</script><img src="https://tracker.example/pixel.png"><img src="cid:logo@pia">', "",
  "--b2", "Content-Type: image/png", "Content-ID: <logo@pia>", "Content-Disposition: inline", "Content-Transfer-Encoding: base64", "", "iVBORw0KGgo=", "--b2--",
  "--b1", "Content-Type: application/pdf; name=\"program.pdf\"", "Content-Disposition: attachment; filename=\"program.pdf\"", "Content-Transfer-Encoding: base64", "", "JVBERi0xLjQ=", "--b1--", ""
].join("\r\n");

function fakeWebmail() {
  const seen: Array<[string, number, boolean]> = [];
  const listed: Array<[string, number, string]> = [];
  const folders: WebFolder[] = [
    { path: "INBOX.Trash", name: "Papirkurv", special: "\\Trash", depth: 0, unseen: 0, total: 3, selectable: true },
    { path: "INBOX", name: "Indbakke", special: "\\Inbox", depth: 0, unseen: 2, total: 2, selectable: true },
    { path: "INBOX.Bestyrelsen", name: "Bestyrelsen", special: null, depth: 0, unseen: 0, total: 1, selectable: true },
    { path: "INBOX.Sent", name: "Sendt", special: "\\Sent", depth: 0, unseen: 0, total: 9, selectable: true },
    { path: "INBOX.Junk", name: "Spam", special: "\\Junk", depth: 0, unseen: 4, total: 4, selectable: true }];
  const items: WebListItem[] = [
    { uid: 7, date: NOW - 3_600_000, from: "Pia Lund", fromAddress: "pia@example.dk", to: "team@holistisk.org", subject: "Leje af salen", seen: false, flagged: true, answered: false, attachments: true },
    { uid: 5, date: NOW - 3 * 86_400_000, from: "Bo", fromAddress: "bo@example.dk", to: "team@holistisk.org", subject: "Tak for sidst", seen: true, flagged: false, answered: true, attachments: false }];
  const opener: WebmailOpener = async () => ({
    async folders() { return folders; },
    async list(path, page, size, query) { listed.push([path, page, query]); const found = query ? items.filter(i => i.subject.toLowerCase().includes(query.toLowerCase())) : items; return { total: found.length, items: found }; },
    async source(_path, uid) { return uid === 7 ? { source: new TextEncoder().encode(RAW), seen: false, flagged: true } : null; },
    async setSeen(path, uid, value) { seen.push([path, uid, value]); },
    async close() { /* nothing */ },
  });
  return { opener, seen, listed };
}

async function setup(connected = true) {
  const db = testDatabase();
  const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026", SAGA_TELEGRAM_WEBHOOK_SECRET: "webhook-secret-0123456789" });
  if (connected) {
    const imap: ImapOpener = async () => ({ async open() { return { uidValidity: "77", uidNext: 1 }; }, async search() { return []; }, async fetch() { return []; }, async close() { /* nothing */ } });
    await connectTeamMail(env, db, { address: "team@holistisk.org", password: "rigtig", by: "Jacob Hauge", nowMs: NOW }, imap);
  }
  const mail = fakeWebmail();
  const call = (path: string, init: RequestInit & { cookie?: string } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
    ...init, headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, { ...deps(fakeServices().fetcher, NOW), webmail: mail.opener });
  const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
  const session = ((await call("/login", { method: "POST", body: form({ password: "hjerte-2026" }) })).headers.get("set-cookie") ?? "").split(";")[0]!;
  return { db, call, form, session, mail, gitta: await memberCookie(session, "Gitta") };
}

describe("the mailbox in admin", () => {
  it("shows every folder in a mail program's order, and the list with unread, flags, files and search", async () => {
    const { call, gitta, mail } = await setup();
    const page = await call("/posthus/mail", { cookie: gitta });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("frame-src 'self'");
    const text = await page.text();
    const nav = text.slice(text.indexOf('class="card wm-folders"'));
    const order = ["Indbakke", "Sendt", "Spam", "Papirkurv", "Bestyrelsen"].map(name => nav.indexOf(`<span>${name}</span>`));
    expect(order.every(i => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain('<span class="n">2</span>');
    expect(text).toContain('href="/posthus/mail/vis?mappe=INBOX&uid=7" class="unread"');
    expect(text).toContain('aria-label="Flaget"');
    expect(text).toContain('aria-label="Vedhæftning"');
    expect(text).toContain("Tak for sidst");
    const searched = await (await call("/posthus/mail?mappe=INBOX&q=leje", { cookie: gitta })).text();
    expect(mail.listed.at(-1)).toEqual(["INBOX", 0, "leje"]);
    expect(searched).toContain("søgning: leje");
    expect(searched).not.toContain("Tak for sidst");
    // A folder that is not there leads to the inbox.
    expect((await call("/posthus/mail?mappe=Findes.ikke", { cookie: gitta })).headers.get("location")).toBe("/posthus/mail?mappe=INBOX");
  });

  it("opens a mail as read, shows it in a frame that may run and fetch nothing, and gives its files", async () => {
    const { call, gitta, mail } = await setup();
    const page = await (await call("/posthus/mail/vis?mappe=INBOX&uid=7", { cookie: gitta })).text();
    expect(mail.seen).toEqual([["INBOX", 7, true]]);
    expect(page).toContain("<h1>Leje af salen");
    expect(page).toContain("<b>Fra:</b> Pia Lund &lt;pia@example.dk&gt;");
    expect(page).toContain('href="/posthus/mail/fil?mappe=INBOX&uid=1&nr=1"'.replace("uid=1", "uid=7"));
    expect(page).toContain("program.pdf");
    // The picture sent along in the mail is shown in it, not as a file.
    expect(page).not.toContain("&nr=0");
    expect(page).toContain("Vis billeder");
    expect(page).toContain('sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"');

    const frame = await call("/posthus/mail/indhold?mappe=INBOX&uid=7", { cookie: gitta });
    const csp = frame.headers.get("content-security-policy")!;
    expect(csp).toContain("sandbox allow-same-origin allow-popups");
    expect(csp).toContain("img-src data:;");
    expect(csp).not.toContain("script-src");
    const body = await frame.text();
    expect(body).toContain("<p>Hej, kan vi leje salen?</p>");
    expect(body).not.toContain("<script>");
    expect(body).toContain('src="data:image/png;base64,');
    expect(body).toContain('<base target="_blank">');
    expect((await call("/posthus/mail/indhold?mappe=INBOX&uid=7&billeder=1", { cookie: gitta })).headers.get("content-security-policy")).toContain("img-src data: https: http:");

    const file = await call("/posthus/mail/fil?mappe=INBOX&uid=7&nr=1", { cookie: gitta });
    expect(file.headers.get("content-disposition")).toContain('attachment; filename="program.pdf"');
    expect(new Uint8Array(await file.arrayBuffer()).slice(0, 4)).toEqual(new TextEncoder().encode("%PDF"));
    expect((await call("/posthus/mail/vis?mappe=INBOX&uid=99", { cookie: gitta })).status).toBe(404);
  });

  it("marks a mail unread again, and asks who you are first", async () => {
    const { call, gitta, session, mail, form } = await setup();
    const back = await call("/posthus/mail/ulaest", { method: "POST", cookie: gitta, body: form({ mappe: "INBOX", uid: "7" }) });
    expect(back.headers.get("location")).toBe("/posthus/mail?mappe=INBOX");
    expect(mail.seen).toEqual([["INBOX", 7, false]]);
    expect((await call("/posthus/mail", { cookie: session })).headers.get("location")).toBe("/hvem");
    // Posthus leads there.
    expect(await (await call("/posthus", { cookie: gitta })).text()).toContain('href="/posthus/mail">Åbn mailboksen →</a>');
  });

  it("says so when team@ is not connected", async () => {
    const { call, gitta } = await setup(false);
    const page = await call("/posthus/mail", { cookie: gitta });
    expect(page.status).toBe(503);
    expect(await page.text()).toContain("team@ er ikke forbundet");
  });
});

describe("the mailbox's pieces", () => {
  it("knows a mail with a file, the folders' order, a mail's place from Posthus, and reads a mail", async () => {
    expect(hasAttachment({ type: "multipart/mixed", childNodes: [{ type: "text/plain" }, { type: "application/pdf", disposition: "attachment" }] })).toBe(true);
    expect(hasAttachment({ type: "multipart/alternative", childNodes: [{ type: "text/plain" }, { type: "text/html" }] })).toBe(false);
    const f = (path: string, special: string | null): WebFolder => ({ path, name: path, special, depth: 0, unseen: 0, total: 0, selectable: true });
    expect(orderFolders([f("Z", null), f("T", "\\Trash"), f("INBOX", "\\Inbox"), f("A", null), f("S", "\\Sent")]).map(x => x.path)).toEqual(["INBOX", "S", "T", "A", "Z"]);
    expect(mailboxLink("/c", "imap:77:12")).toBe("/c/posthus/mail/vis?mappe=INBOX&uid=12");
    expect(mailboxLink("/c", "imap:INBOX.Bestyrelsen:77:3")).toBe("/c/posthus/mail/vis?mappe=INBOX.Bestyrelsen&uid=3");
    expect(mailboxLink("/c", "relay:abc")).toBeNull();
    const parsed = await parseMail(new TextEncoder().encode(RAW));
    expect(parsed).toMatchObject({ subject: "Leje af salen", from: "Pia Lund <pia@example.dk>", to: "team@holistisk.org" });
    expect(parsed.attachments.map(a => [a.filename, a.contentType, a.inline])).toEqual([["vedhæftning-1", "image/png", true], ["program.pdf", "application/pdf", false]]);
  });
});
