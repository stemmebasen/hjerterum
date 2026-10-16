import { describe, expect, it } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { hasAttachment, mailboxLink, orderFolders, parseMail, type WebFolder, type WebListItem, type WebmailOpener } from "./webmail.js";
import { connectTeamMail, type ImapOpener } from "../saga/teamMail.js";
import { nodemailerSender, parseRecipients, startDraft, type MailSender, type Outgoing } from "./webmailCompose.js";
import { deps, fakeServices, memberCookie, sagaEnv, testDatabase } from "../saga/test-support.js";

// Requested: "Posthus skal udbygges så det er en sand webmail med alle mapper, med alle svarmuligheder, og alle almindelige funktioner" - "Det vigtige er at
// alt kan holdes indenfor admin og at det er let at automatisere og køre AI indover" - "Ja". Step 1: reading.
const NOW = Date.parse("2026-10-16T10:00:00Z");
const ORIGIN = "https://admin.hjerterum.example";

const RAW = [
  "From: Pia Lund <pia@example.dk>", "To: team@holistisk.org, Bo <bo@example.dk>", "Cc: Gitta <gitta@example.dk>", "Message-ID: <leje-1@example.dk>", "Subject: Leje af salen", "Date: Thu, 15 Oct 2026 09:30:00 +0200", "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="b1"', "", "--b1", 'Content-Type: multipart/related; boundary="b2"', "", "--b2", "Content-Type: text/html; charset=utf-8", "",
  '<p>Hej, kan vi leje salen?</p><script>alert(1)</script><img src="https://tracker.example/pixel.png"><img src="cid:logo@pia">', "",
  "--b2", "Content-Type: image/png", "Content-ID: <logo@pia>", "Content-Disposition: inline", "Content-Transfer-Encoding: base64", "", "iVBORw0KGgo=", "--b2--",
  "--b1", "Content-Type: application/pdf; name=\"program.pdf\"", "Content-Disposition: attachment; filename=\"program.pdf\"", "Content-Transfer-Encoding: base64", "", "JVBERi0xLjQ=", "--b1--", ""
].join("\r\n");

function fakeWebmail() {
  const seen: Array<[string, number, boolean]> = [];
  const done: string[] = [];
  const listed: Array<[string, number, string]> = [];
  const folders: WebFolder[] = [
    { path: "INBOX.Trash", name: "Papirkurv", special: "\\Trash", depth: 0, unseen: 0, total: 3, selectable: true },
    { path: "INBOX", name: "Indbakke", special: "\\Inbox", depth: 0, unseen: 2, total: 2, selectable: true },
    { path: "INBOX.Bestyrelsen", name: "Bestyrelsen", special: null, depth: 0, unseen: 0, total: 1, selectable: true },
    { path: "INBOX.Sent", name: "Sendt", special: "\\Sent", depth: 0, unseen: 0, total: 9, selectable: true },
    { path: "INBOX.Junk", name: "Spam", special: "\\Junk", depth: 0, unseen: 4, total: 4, selectable: true },
    { path: "INBOX.Drafts", name: "Kladder", special: "\\Drafts", depth: 0, unseen: 0, total: 0, selectable: true }];
  const items: WebListItem[] = [
    { uid: 7, date: NOW - 3_600_000, from: "Pia Lund", fromAddress: "pia@example.dk", to: "team@holistisk.org", subject: "Leje af salen", seen: false, flagged: true, answered: false, attachments: true },
    { uid: 5, date: NOW - 3 * 86_400_000, from: "Bo", fromAddress: "bo@example.dk", to: "team@holistisk.org", subject: "Tak for sidst", seen: true, flagged: false, answered: true, attachments: false }];
  const opener: WebmailOpener = async () => ({
    async folders() { return folders; },
    async list(path, page, size, query) { listed.push([path, page, query]); const found = query ? items.filter(i => i.subject.toLowerCase().includes(query.toLowerCase())) : items; return { total: found.length, items: found }; },
    async source(_path, uid) { return uid === 7 ? { source: new TextEncoder().encode(RAW), seen: false, flagged: true } : null; },
    async setFlag(path, uids, flag, on) { if (flag === "\\Seen") for (const uid of uids) seen.push([path, uid, on]); else done.push(`${on ? (flag === "\\Answered" ? "answered" : "flag") : "unflag"} ${path} ${uids.join(",")}`); },
    async move(path, uids, dest) { done.push(`move ${path} ${uids.join(",")} -> ${dest}`); return { uidValidity: "77" }; },
    async remove(path, uids) { done.push(`delete ${path} ${uids.join(",")}`); return { uidValidity: "88" }; },
    async append(path, raw, flags) { done.push(`append ${path} ${flags.join(" ")} ${raw.length}`); },
    async uidValidity() { return "77"; },
    async close() { /* nothing */ },
  });
  return { opener, seen, listed, done };
}

async function setup(connected = true, sendFails = false) {
  const db = testDatabase();
  const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026", SAGA_TELEGRAM_WEBHOOK_SECRET: "webhook-secret-0123456789" });
  if (connected) {
    const imap: ImapOpener = async () => ({ async open() { return { uidValidity: "77", uidNext: 1 }; }, async search() { return []; }, async fetch() { return []; }, async close() { /* nothing */ } });
    await connectTeamMail(env, db, { address: "team@holistisk.org", password: "rigtig", by: "Jacob Hauge", nowMs: NOW }, imap);
  }
  const mail = fakeWebmail();
  const outgoing: Array<{ mail: Outgoing; draft: boolean }> = [];
  const send: MailSender = async (_login, m, options) => { if (sendFails && !options.draft) throw new Error("smtp down"); outgoing.push({ mail: m, draft: options.draft }); return { raw: new TextEncoder().encode("raw mail"), messageId: "<new@holistisk.org>" }; };
  const call = (path: string, init: RequestInit & { cookie?: string } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
    ...init, headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, { ...deps(fakeServices().fetcher, NOW), webmail: mail.opener, webmailSend: send });
  const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
  const session = ((await call("/login", { method: "POST", body: form({ password: "hjerte-2026" }) })).headers.get("set-cookie") ?? "").split(";")[0]!;
  return { db, call, form, session, mail, outgoing, gitta: await memberCookie(session, "Gitta") };
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
    const back = await call("/posthus/mail/handling", { method: "POST", cookie: gitta, body: form({ mappe: "INBOX", uid: "7", handling: "ulaest", tilbage: "vis" }) });
    expect(back.headers.get("location")).toBe("/posthus/mail?mappe=INBOX&udfoert=ulaest&n=1");
    expect(mail.seen).toEqual([["INBOX", 7, false]]);
    expect((await call("/posthus/mail", { cookie: session })).headers.get("location")).toBe("/hvem");
    // Posthus leads there.
    expect(await (await call("/posthus", { cookie: gitta })).text()).toContain('href="/posthus/mail">Åbn mailboksen →</a>');
    // Requested: "Skriv gerne (Testversion) et sted".
    expect(await (await call("/posthus/mail", { cookie: gitta })).text()).toContain('Mailboks <span class="wm-test">Testversion</span>');
  });

  // Step 2: archive, delete, spam, flag, move - one mail or the ones ticked.
  it("archives, deletes, marks spam, flags and moves - and what leaves for Papirkurv or Spam is done in Posthus too", async () => {
    const { call, gitta, mail, db } = await setup();
    const many = (pairs: Array<[string, string]>) => { const f = new FormData(); for (const [k, v] of pairs) f.append(k, v); return f; };
    const post = (pairs: Array<[string, string]>) => call("/posthus/mail/handling", { method: "POST", cookie: gitta, body: many(pairs) });
    const insert = (ref: string) => db.prepare("INSERT INTO board_mail (message_ref, sender, subject, received_at_ms, preview, created_at_ms) VALUES (?, 'Pia <pia@example.dk>', 'Leje', ?, 'Hej', ?)").bind(ref, NOW, NOW).run();
    await insert("imap:77:7"); await insert("imap:77:5"); await insert("imap:INBOX.Trash:88:3");
    const handled = async (ref: string) => (await db.prepare("SELECT handled_by FROM board_mail WHERE message_ref = ?").bind(ref).first<{ handled_by: string | null }>())!.handled_by;

    // The list has the buttons; Arkivér only where there is an Arkiv folder (here none).
    const list = await (await call("/posthus/mail", { cookie: gitta })).text();
    expect(list).toContain('form="wm-bulk" aria-label="Vælg: Leje af salen"');
    expect(list).toContain('value="spam">Spam</button>');
    expect(list).not.toContain('value="arkiv"');

    // Delete from the inbox: to Papirkurv, and done in Posthus.
    let r = await post([["mappe", "INBOX"], ["uid", "7"], ["uid", "5"], ["handling", "slet"]]);
    expect(r.headers.get("location")).toBe("/posthus/mail?mappe=INBOX&udfoert=slet&n=2");
    expect(mail.done.at(-1)).toBe("move INBOX 7,5 -> INBOX.Trash");
    expect([await handled("imap:77:7"), await handled("imap:77:5")]).toEqual(["Gitta", "Gitta"]);
    expect(await (await call("/posthus/mail?mappe=INBOX&udfoert=slet&n=2", { cookie: gitta })).text()).toContain("2 mails er lagt i papirkurven.");
    // From Papirkurv: for good.
    await post([["mappe", "INBOX.Trash"], ["uid", "3"], ["handling", "slet"]]);
    expect(mail.done.at(-1)).toBe("delete INBOX.Trash 3");
    expect(await handled("imap:INBOX.Trash:88:3")).toBe("Gitta");
    // Spam, and back.
    await post([["mappe", "INBOX"], ["uid", "7"], ["handling", "spam"]]);
    expect(mail.done.at(-1)).toBe("move INBOX 7 -> INBOX.Junk");
    await post([["mappe", "INBOX.Junk"], ["uid", "4"], ["handling", "ikkespam"]]);
    expect(mail.done.at(-1)).toBe("move INBOX.Junk 4 -> INBOX");
    // Flag from the mail goes back to it; move to the board's own folder; nothing ticked says so.
    r = await post([["mappe", "INBOX"], ["uid", "7"], ["handling", "flag"], ["tilbage", "vis"]]);
    expect(r.headers.get("location")).toBe("/posthus/mail/vis?mappe=INBOX&uid=7");
    expect(mail.done.at(-1)).toBe("flag INBOX 7");
    await post([["mappe", "INBOX"], ["uid", "5"], ["handling", "flyt"], ["til", "INBOX.Bestyrelsen"]]);
    expect(mail.done.at(-1)).toBe("move INBOX 5 -> INBOX.Bestyrelsen");
    expect((await post([["mappe", "INBOX"], ["uid", "5"], ["handling", "flyt"], ["til", "Findes.ikke"]])).headers.get("location")).toContain("udfoert=mappe");
    expect((await post([["mappe", "INBOX"], ["handling", "slet"]])).headers.get("location")).toContain("udfoert=ingen");
    // The mail's own buttons.
    const page = await (await call("/posthus/mail/vis?mappe=INBOX&uid=7", { cookie: gitta })).text();
    for (const text of ['value="slet">Slet</button>', 'value="spam">Spam</button>', 'value="fjernflag">Fjern flag</button>', 'value="ulaest">Markér som ulæst</button>', '<option value="INBOX.Bestyrelsen">Bestyrelsen</option>']) expect(page).toContain(text);
  });

  // Step 3: write, answer, answer all, forward, drafts - sent from team@ and kept in Sendt; Saga never sends.
  it("answers a mail from team@ with the writer's name, keeps it in Sendt, and marks the mail answered in the mailbox and in Posthus", async () => {
    const { call, gitta, mail, outgoing, db, form } = await setup();
    await db.prepare("INSERT INTO board_mail (message_ref, sender, subject, received_at_ms, preview, created_at_ms) VALUES ('imap:77:7', 'Pia <pia@example.dk>', 'Leje', ?, 'Hej', ?)").bind(NOW, NOW).run();
    const page = await (await call("/posthus/mail/vis?mappe=INBOX&uid=7", { cookie: gitta })).text();
    expect(page).toContain('href="/posthus/mail/skriv?type=svar&mappe=INBOX&uid=7">Svar</a>');
    expect(page).toContain(">Svar alle</a>");
    expect(page).toContain(">Videresend</a>");

    const reply = await (await call("/posthus/mail/skriv?type=svar&mappe=INBOX&uid=7", { cookie: gitta })).text();
    expect(reply).toContain('name="til" value="Pia Lund &lt;pia@example.dk&gt;"');
    expect(reply).toContain('name="emne" value="Re: Leje af salen"');
    expect(reply).toContain("Venlig hilsen\nGitta\nHjerterum");
    expect(reply).toContain("&gt; Hej, kan vi leje salen?");
    expect(reply).toContain("Fra: Gitta | Hjerterum &lt;team@holistisk.org&gt;");
    const all = await (await call("/posthus/mail/skriv?type=svaralle&mappe=INBOX&uid=7", { cookie: gitta })).text();
    expect(all).toContain('name="cc" value="Bo &lt;bo@example.dk&gt;, Gitta &lt;gitta@example.dk&gt;"');

    const sent = await call("/posthus/mail/send", { method: "POST", cookie: gitta, body: form({ type: "svar", mappe: "INBOX", uid: "7", til: "Pia Lund <pia@example.dk>", cc: "", bcc: "", emne: "Re: Leje af salen", tekst: "Ja, den er ledig.", handling: "send" }) });
    expect(sent.headers.get("location")).toBe("/posthus/mail?mappe=INBOX&udfoert=sendt&n=1");
    expect(outgoing[0]).toMatchObject({ draft: false, mail: { from: '"Gitta | Hjerterum" <team@holistisk.org>', to: ["Pia Lund <pia@example.dk>"], subject: "Re: Leje af salen", text: "Ja, den er ledig.",
      inReplyTo: "<leje-1@example.dk>", references: "<leje-1@example.dk>" } });
    expect(mail.done).toEqual(["append INBOX.Sent \\Seen 8", "answered INBOX 7"]);
    expect(await db.prepare("SELECT answered_how, answered_by FROM board_mail WHERE message_ref = 'imap:77:7'").first()).toEqual({ answered_how: "svar", answered_by: "Gitta | Hjerterum" });
    expect(await (await call("/posthus/mail?mappe=INBOX&udfoert=sendt&n=1", { cookie: gitta })).text()).toContain("Mailen er sendt og ligger i Sendt.");
  });

  it("forwards with the mail's files, keeps a draft in Kladder, and never loses the text when something is wrong", async () => {
    const { call, gitta, mail, outgoing, form } = await setup();
    const forward = await (await call("/posthus/mail/skriv?type=videresend&mappe=INBOX&uid=7", { cookie: gitta })).text();
    expect(forward).toContain('name="emne" value="Fwd: Leje af salen"');
    expect(forward).toContain('name="medtag" value="1" checked> program.pdf');
    expect(forward).toContain("---------- Videresendt mail ----------");
    const body = form({ type: "videresend", mappe: "INBOX", uid: "7", til: "lisbeth@example.dk", cc: "", bcc: "", emne: "Fwd: Leje af salen", tekst: "Se her", handling: "send" });
    body.append("medtag", "1");
    body.append("filer", new File([new Uint8Array([1, 2, 3])], "plan.txt", { type: "text/plain" }));
    await call("/posthus/mail/send", { method: "POST", cookie: gitta, body });
    expect(outgoing[0]!.mail.attachments.map(a => a.filename)).toEqual(["plan.txt", "program.pdf"]);
    expect(outgoing[0]!.mail.inReplyTo).toBeUndefined();

    // A new mail saved as a draft goes to Kladder.
    const saved = await call("/posthus/mail/send", { method: "POST", cookie: gitta, body: form({ type: "ny", mappe: "INBOX", uid: "0", til: "", cc: "", bcc: "", emne: "Udkast", tekst: "Halvfærdig", handling: "kladde" }) });
    expect(saved.headers.get("location")).toBe("/posthus/mail?mappe=INBOX.Drafts&udfoert=kladde&n=1");
    expect(outgoing[1]!.draft).toBe(true);
    expect(mail.done.at(-1)).toBe("append INBOX.Drafts \\Draft \\Seen 8");

    // A wrong address, or a server that says no: the page comes back with the text.
    const wrong = await call("/posthus/mail/send", { method: "POST", cookie: gitta, body: form({ type: "ny", mappe: "INBOX", uid: "0", til: "pia@", cc: "", bcc: "", emne: "Hej", tekst: "Min lange tekst", handling: "send" }) });
    expect(wrong.status).toBe(400);
    const again = await wrong.text();
    expect(again).toContain("En af adresserne er ikke en mailadresse");
    expect(again).toContain("Min lange tekst");
    const down = await setup(true, true);
    const failed = await down.call("/posthus/mail/send", { method: "POST", cookie: down.gitta, body: down.form({ type: "ny", mappe: "INBOX", uid: "0", til: "pia@example.dk", cc: "", bcc: "", emne: "Hej", tekst: "Vigtig tekst", handling: "send" }) });
    expect(failed.status).toBe(400);
    expect(await failed.text()).toContain("Vigtig tekst");
    expect(down.mail.done).toEqual([]);
  });

  it("says so when team@ is not connected", async () => {
    const { call, gitta } = await setup(false);
    const page = await call("/posthus/mail", { cookie: gitta });
    expect(page.status).toBe(503);
    expect(await page.text()).toContain("team@ er ikke forbundet");
  });
});

describe("writing a mail", () => {
  it("reads written addresses, starts an answer, and builds a real message with nodemailer", async () => {
    expect(parseRecipients('Pia Lund <pia@x.dk>, "Hansen, Bo" <bo@y.dk>; ann@z.dk')).toEqual(["Pia Lund <pia@x.dk>", '"Hansen, Bo" <bo@y.dk>', "ann@z.dk"]);
    expect(parseRecipients("pia@x.dk, ikke en adresse")).toBeNull();
    expect(parseRecipients("")).toEqual([]);
    const draft = startDraft("ny", "Douglas Crawford", "team@holistisk.org", null);
    expect(draft.text).toBe("\n\nVenlig hilsen\nDouglas\nHjerterum");
    const built = await nodemailerSender({ host: "imap.one.com", user: "team@holistisk.org", password: "x" }, { from: '"Gitta | Hjerterum" <team@holistisk.org>', to: ["Pia <pia@example.dk>"], cc: [], bcc: ["skjult@example.dk"],
      subject: "Re: Leje af salen", text: "Ja, den er ledig. Æble.", inReplyTo: "<leje-1@example.dk>", references: "<leje-1@example.dk>",
      attachments: [{ filename: "program.pdf", contentType: "application/pdf", content: new TextEncoder().encode("%PDF-1.4") }] }, { draft: true, fetcher: fetch });
    const raw = new TextDecoder().decode(built.raw);
    expect(raw).toContain("Subject: Re: Leje af salen");
    expect(raw).toContain("In-Reply-To: <leje-1@example.dk>");
    expect(raw).toContain('From: "Gitta | Hjerterum" <team@holistisk.org>');
    expect(raw).toContain('filename=program.pdf');
    expect(raw).not.toContain("skjult@example.dk");
    expect(built.messageId).toMatch(/^<.+@.+>$/);
    const back = await parseMail(built.raw);
    expect(back.text.trim()).toBe("Ja, den er ledig. Æble.");
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
    expect(parsed).toMatchObject({ subject: "Leje af salen", from: "Pia Lund <pia@example.dk>", to: "team@holistisk.org, Bo <bo@example.dk>", cc: "Gitta <gitta@example.dk>" });
    expect(parsed.attachments.map(a => [a.filename, a.contentType, a.inline])).toEqual([["vedhæftning-1", "image/png", true], ["program.pdf", "application/pdf", false]]);
  });
});
