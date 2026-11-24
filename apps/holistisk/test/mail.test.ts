import { beforeAll, describe, expect, it } from "vitest";
import { handle } from "../src/index.js";
import { runIngest } from "../src/ingest/run.js";
import { SOURCES } from "../src/sources/registry.js";
import { saveInterests } from "../src/flokken/kickoff.js";
import { sendDueMails } from "../src/flokken/notify.js";
import { sendMail, type EmailBinding } from "../src/mail.js";
import { MAILS_PER_DAY } from "../src/flokken/contact.js";
import { welcomeMail } from "../src/flokken/welcome.js";
import { joinMail, sendJoinInvites } from "../src/flokken/join.js";
import { englishPath } from "../src/i18n/paths.js";
import type { Env } from "../src/env.js";
import { testDb } from "./d1.js";
import { fakeFetch, fixture, FEED_URL, MW_ROBOTS, noSleep } from "./helpers.js";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const ORIGIN = "https://portal.example";
type Sent = { to: string; subject: string; html: string; text: string; replyTo?: string };
const sent: Sent[] = [];
const binding: EmailBinding = { send: async m => { sent.push({ to: m.to, subject: m.subject, html: m.html, text: m.text, ...(m.replyTo ? { replyTo: m.replyTo } : {}) }); return { messageId: "x" }; } };
let env: Env;
let db: ReturnType<typeof testDb>;
let event: { id: string; slug: string; title: string; starts_at: number };

beforeAll(async () => {
  db = testDb();
  const { fetcher } = fakeFetch({
    "https://api.membershipworks.com/robots.txt": { body: MW_ROBOTS }, [FEED_URL]: { body: fixture("hjerterum-rss.xml") },
    "https://lysetshus.dk/robots.txt": { status: 404 }, "https://lysetshus.dk/": { body: fixture("lysetshus.html") }
  });
  await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: SOURCES.filter(s => ["hjerterum", "lysetshus"].includes(s.id)) });
  env = { DB: db, ENVIRONMENT: "staging", ACTIVE_REGIONS: "ostjylland", EDITION: "portal", EMAIL: binding };
  event = (db.raw.prepare("SELECT id, slug, title, starts_at FROM events WHERE status = 'scheduled' AND starts_at > ? AND venue_name IS NOT NULL ORDER BY starts_at").all(NOW + 4 * 86_400_000) as Array<typeof event>)[0]!;
});

type Res = { status: number; body: string; headers: Headers };
async function call(path: string, init: { form?: Record<string, string>; cookie?: string; env?: Env } = {}, now = NOW): Promise<Res> {
  const headers: Record<string, string> = {};
  if (init.cookie) headers.cookie = init.cookie;
  if (init.form) { headers.origin = ORIGIN; headers["content-type"] = "application/x-www-form-urlencoded"; }
  const r = await handle(new Request(ORIGIN + path, { method: init.form ? "POST" : "GET", headers, body: init.form ? new URLSearchParams(init.form) : null }), init.env ?? env, now);
  return { status: r.status, body: await r.text(), headers: r.headers };
}
const cookieOf = (r: Res) => /flok_session=[^;]+/.exec(r.headers.get("set-cookie") ?? "")?.[0] ?? "";
const noMail = (): Env => { const { EMAIL: _, ...rest } = env; return rest; };
const linkIn = (m: Sent) => /https:\/\/[^\s"]+\/log-ind\/link\?t=([A-Za-z0-9_-]+)/.exec(m.text)!;

async function member(name: string, email: string): Promise<string> {
  const r = await call("/bliv-medlem", { form: { fornavn: name, naeste: "/flokke" } });
  const cookie = cookieOf(r);
  expect((await call("/profil", { cookie, form: { fornavn: name, alder: "30-39", om_mig: `${name} her, glæder mig`, email } })).status).toBe(303);
  return cookie;
}
const idOf = (name: string) => (db.raw.prepare("SELECT id FROM members WHERE first_name = ?").all(name)[0] as { id: string }).id;

describe("login with a link on e-mail", () => {
  it("sends a link to a profile's address; opening it does not log in, pressing the button does, once", async () => {
    await member("Lone", "lone@example.dk");
    sent.length = 0;
    const page = await call("/log-ind");
    expect(page.body).toContain("Send mig et login-link");
    expect(page.body).toContain("Log ind med din personlige kode");
    const asked = await call("/log-ind/mail", { form: { email: " Lone@Example.dk ", naeste: "/kom-godt-i-gang" } });
    // Post/Redirect/Get: going back or reloading never asks to send the form again.
    expect(asked.status).toBe(303);
    expect(asked.headers.get("location")).toBe("/log-ind?naeste=%2Fkom-godt-i-gang&besked=mail_sendt");
    const note = /flok_mail_sendt=[^;]+/.exec(asked.headers.get("set-cookie") ?? "")?.[0] ?? "";
    const shown = await call("/log-ind?naeste=%2Fkom-godt-i-gang&besked=mail_sendt", { cookie: note });
    expect(shown.body).toContain("Tjek din indbakke");
    expect(shown.body).toContain("Lone@Example.dk");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("lone@example.dk");
    expect(sent[0]!.subject).toBe("Dit login-link til Socialklubben");
    expect(sent[0]!.text).toContain("Hej Lone");
    const [url, token] = linkIn(sent[0]!) as unknown as [string, string];
    expect(url.startsWith(ORIGIN + "/log-ind/link?t=")).toBe(true);

    const opened = await call(`/log-ind/link?t=${token}`);
    expect(opened.status).toBe(200);
    expect(cookieOf(opened)).toBe("");
    expect(opened.body).toContain(`name="t" value="${token}"`);
    const used = await call("/log-ind/link", { form: { t: token } });
    expect(used.status).toBe(303);
    expect(used.headers.get("location")).toBe("/kom-godt-i-gang?besked=logget_ind");
    const cookie = cookieOf(used);
    expect((await call("/flokke", { cookie })).body).toContain("Hej Lone");
    // Used: a second press does not log in again; opened again while logged in goes straight on.
    const again = await call("/log-ind/link", { form: { t: token } });
    expect(again.status).toBe(400);
    expect(again.body).toContain("Linket er allerede brugt.");
    expect(cookieOf(again)).toBe("");
  });

  it("answers the same for an unknown address, mails a newcomer a way to sign up, and limits mails per hour", async () => {
    sent.length = 0;
    const r = await call("/log-ind/mail", { form: { email: "ukendt@example.dk", naeste: "/events/x/interesse" } });
    expect(r.headers.get("location")).toMatch(/besked=mail_sendt$/);
    // Someone new who typed their e-mail gets a welcome with a button to make a profile, not a login link.
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe("Velkommen til Socialklubben");
    expect(sent[0]!.text).toContain(`${ORIGIN}/log-ind?naeste=%2Fevents%2Fx%2Finteresse#ny`);
    expect(sent[0]!.text).not.toContain("/log-ind/link");
    for (let i = 0; i < 5; i++) await call("/log-ind/mail", { form: { email: "ukendt@example.dk" } });
    expect(sent).toHaveLength(3);
    sent.length = 0;
    await member("Mads", "mads@example.dk");
    for (let i = 0; i < 5; i++) await call("/log-ind/mail", { form: { email: "mads@example.dk" } });
    expect(sent).toHaveLength(3);
    expect((await call("/log-ind/mail", { form: { email: "ikke en mail" } })).status).toBe(400);
  });

  it("expires after an hour", async () => {
    sent.length = 0;
    await member("Ida", "ida@example.dk");
    await call("/log-ind/mail", { form: { email: "ida@example.dk" } });
    const token = linkIn(sent[0]!)[1]!;
    const late = await call("/log-ind/link", { form: { t: token } }, NOW + 61 * 60_000);
    expect(late.body).toContain("Linket er udløbet.");
    expect(cookieOf(late)).toBe("");
  });

  it("lets someone who signed up as a member (name and e-mail, no profile) log in, making their profile", async () => {
    sent.length = 0;
    expect((await call("/bliv-medlem/meld-ind", { form: { navn: "Birgit Holm", email: "Birgit@Example.dk" } })).status).toBe(303);
    sent.length = 0;
    await call("/log-ind/mail", { form: { email: "birgit@example.dk" } });
    expect(sent[0]!.text).toContain("Hej Birgit");
    const used = await call("/log-ind/link", { form: { t: linkIn(sent[0]!)[1]! } });
    expect(used.headers.get("location")).toBe("/flokke?besked=velkommen_mail");
    const row = db.raw.prepare("SELECT first_name, email FROM members WHERE email = 'birgit@example.dk'").all()[0] as { first_name: string };
    expect(row.first_name).toBe("Birgit");
    expect((await call("/flokke", { cookie: cookieOf(used) })).body).toContain("Hej Birgit");
  });

  it("says so when no mail service is set up, and the code still works", async () => {
    const off = await call("/log-ind/mail", { form: { email: "lone@example.dk" }, env: noMail() });
    expect(off.status).toBe(503);
    expect(off.body).toContain("Vi kan ikke sende e-mails lige nu");
    expect((await call("/log-ind/link?t=" + "x".repeat(43))).body).toContain("Linket virker ikke.");
  });
});

describe("the 'Velkommen som medlem' mail", () => {
  it("welcomes a new member once, with the start-up period, never obliged, how it works and the info meeting", async () => {
    sent.length = 0;
    expect((await call("/bliv-medlem/meld-ind", { form: { navn: "Karen Lund", email: "karen@example.dk" } })).status).toBe(303);
    expect(sent).toHaveLength(1);
    const m = sent[0]!;
    expect(m.to).toBe("karen@example.dk");
    expect(m.subject).toBe("Velkommen som medlem af Socialklubben");
    expect(m.text).toContain("Hej Karen");
    expect(m.text).toContain("nystartet forening");
    expect(m.text).toContain("frem til 1. marts 2027");
    expect(m.text).toContain("aldrig forpligtet");
    expect(m.text).toContain("\"Jeg vil gerne med!\"");
    expect(m.text).toContain("12. januar 2027 kl. 19.30–20.45 i Guldsmedgade 26B");
    expect(m.text).toContain(`Tilmeld dig informationsmødet (${ORIGIN}/informationsmoede)`);
    expect(m.text).toContain(`Se kalenderen: ${ORIGIN}/kalender`);
    expect(m.text).toContain("kontakt@socialklubben.dk");
    expect(m.html).toContain('<html lang="da">');
    expect(m.html).toContain(`href="${ORIGIN}/informationsmoede"`);
    for (const word of ["gave", "rabat", "støttemedlem", "event", "gratis"]) expect(m.text.toLowerCase()).not.toContain(word);
    db.raw.prepare("SELECT kind, status FROM mail_log WHERE kind = 'welcome'").all().forEach(r => expect(r).toEqual({ kind: "welcome", status: "sent" }));
    // Signing up again with the same address sends nothing.
    await call("/bliv-medlem/meld-ind", { form: { navn: "Karen Lund", email: "KAREN@example.dk" } });
    expect(sent).toHaveLength(1);
  });

  it("is in English when the sign-up was on the English page, and drops what has passed", async () => {
    sent.length = 0;
    expect((await call("/en/membership/meld-ind", { form: { navn: "Sam", email: "sam@example.dk" } })).status).toBe(303);
    const m = sent[0]!;
    expect(m.subject).toBe("Welcome as a member of Socialklubben");
    expect(m.text).toContain("Hi Sam");
    expect(m.text).toContain("until 1 March 2027");
    expect(m.text).toContain("\"I'd like to come along!\"");
    expect(m.text).toContain(`${ORIGIN}/en/calendar`);
    // The English sign-up page's own path (/en/information-meeting once that page is there).
    expect(m.text).toContain(`${ORIGIN}${englishPath("/informationsmoede")}`);
    expect(m.text).toContain("Warm regards");
    expect(m.html).toContain('<html lang="en">');
    const later = welcomeMail("x@example.dk", "Ole", ORIGIN, "da", Date.parse("2027-03-02T12:00:00Z"));
    expect(later.text).not.toContain("1. marts 2027");
    expect(later.text).not.toContain("informationsmøde");
    expect(later.text).toContain("aldrig forpligtet");
  });
});

describe("the 'Vil du være medlem?' mail", () => {
  it("asks someone who showed interest but is not a member, once; the link makes them a member", async () => {
    const cookie = await member("Mette", "mette@example.dk");
    sent.length = 0;
    expect((await call(`/events/${event.slug}/interesse`, { cookie, form: {} })).status).toBe(303);
    expect(sent).toHaveLength(1);
    const m = sent[0]!;
    expect(m.to).toBe("mette@example.dk");
    expect(m.subject).toBe("Vil du være medlem af Socialklubben?");
    expect(m.text).toContain("Hej Mette");
    expect(m.text).toContain("aldrig forpligtet");
    expect(m.text).toContain("frem til 1. marts 2027");
    expect(m.text).toContain("Tilmeld dig her (");
    for (const word of ["gave", "rabat", "støttemedlem", "event", "gratis"]) expect(m.text.toLowerCase()).not.toContain(word);
    const token = /\/bliv-medlem\/ja\?t=([A-Za-z0-9_-]+)/.exec(m.text)![1]!;
    // Opening the link (as a mail program checking it would) makes nobody a member.
    const opened = await call(`/bliv-medlem/ja?t=${token}`);
    expect(opened.body).toContain("Ja, jeg vil gerne være medlem");
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM membership_signups WHERE email = 'mette@example.dk'").all()[0]).toEqual({ n: 0 });
    const yes = await call("/bliv-medlem/ja", { form: { t: token } });
    expect(yes.body).toContain("Velkommen som medlem!");
    expect(db.raw.prepare("SELECT name FROM membership_signups WHERE email = 'mette@example.dk'").all()[0]).toEqual({ name: "Mette" });
    expect(sent.at(-1)!.subject).toBe("Velkommen som medlem af Socialklubben");
    expect((await call("/bliv-medlem/ja", { form: { t: token } })).body).toContain("Du er allerede medlem");
    // Another tick sends nothing more, and nor does the cron.
    sent.length = 0;
    await call(`/events/${event.slug}/interesse/fjern`, { cookie, form: {} });
    await call(`/events/${event.slug}/interesse`, { cookie, form: {} });
    expect(await sendJoinInvites(db, env, ORIGIN, NOW)).toBe(0);
    expect(sent.filter(x => x.subject.includes("medlem"))).toHaveLength(0);
    expect((await call("/bliv-medlem/ja?t=" + "x".repeat(43))).body).toContain("Linket virker ikke");
    db.raw.prepare("DELETE FROM event_interests WHERE member_id = ?").run(idOf("Mette"));
  });

  it("is sent by the cron to those who ticked before, never twice and never to members", async () => {
    await member("Per", "per@example.dk");
    await member("Rikke", "rikke@example.dk");
    await call("/bliv-medlem/meld-ind", { form: { navn: "Rikke R", email: "RIKKE@example.dk" } });
    for (const name of ["Per", "Rikke"]) db.raw.prepare("INSERT INTO event_interests (member_id, event_id, status, created_at, updated_at) VALUES (?, ?, 'waiting', ?, ?)").run(idOf(name), event.id, NOW, NOW);
    sent.length = 0;
    expect(await sendJoinInvites(db, env, ORIGIN, NOW)).toBe(1);
    expect(sent.map(x => x.to)).toEqual(["per@example.dk"]);
    expect(await sendJoinInvites(db, env, ORIGIN, NOW + 3600_000)).toBe(0);
    for (const name of ["Per", "Rikke"]) db.raw.prepare("DELETE FROM event_interests WHERE member_id = ?").run(idOf(name));
    expect(joinMail("x@example.dk", "Sam", `${ORIGIN}/en/membership/ja?t=x`, ORIGIN, "en", NOW).text).toContain("Hi Sam");
  });
});

describe("mails about flock places", () => {
  it("mails each one offered a place once, with a login button, and reminds them before the deadline", async () => {
    const names = ["Asta", "Bo", "Cille"];
    for (const n of names) await member(n, `${n.toLowerCase()}@example.dk`);
    for (const n of names) await saveInterests(db, idOf(n), [event.slug], [], ["ostjylland"], NOW);
    sent.length = 0;
    expect(await sendDueMails(db, noMail(), NOW)).toEqual({ invitations: 0, reminders: 0 });
    expect(await sendDueMails(db, env, NOW)).toEqual({ invitations: 3, reminders: 0 });
    expect(sent.map(m => m.to).sort()).toEqual(["asta@example.dk", "bo@example.dk", "cille@example.dk"]);
    const asta = sent.find(m => m.to === "asta@example.dk")!;
    expect(asta.subject).toBe(`Der er en plads til dig: ${event.title}`);
    expect(asta.text).toContain("Du og 2 andre vil gerne med");
    expect(asta.text).toContain("Husk, at du selv køber billet.");
    expect(asta.text).toContain("https://socialklubben.dk/log-ind/link?t=");
    expect(asta.html).not.toContain("<script");
    expect(await sendDueMails(db, env, NOW + 3600_000)).toEqual({ invitations: 0, reminders: 0 });

    // The button logs in and opens Mine flokke.
    const used = await call("/log-ind/link", { form: { t: linkIn(asta)[1]! } });
    expect(used.headers.get("location")).toBe("/flokke?besked=logget_ind");
    expect((await call("/flokke", { cookie: cookieOf(used) })).body).toContain("Din flok er klar!");

    // Bo says yes; the others are reminded when 12 hours are left.
    expect((await call(`/interesser/${event.slug}/bekraeft`, { cookie: cookieOf(await call("/log-ind/link", { form: { t: linkIn(sent.find(m => m.to === "bo@example.dk")!)[1]! } })), form: {} })).status).toBe(303);
    const respondBy = (db.raw.prepare("SELECT respond_by FROM event_interests WHERE member_id = ?").all(idOf("Asta"))[0] as { respond_by: number }).respond_by;
    sent.length = 0;
    expect(await sendDueMails(db, env, respondBy - 13 * 3600_000)).toEqual({ invitations: 0, reminders: 0 });
    expect(await sendDueMails(db, env, respondBy - 11 * 3600_000)).toEqual({ invitations: 0, reminders: 2 });
    expect(sent.map(m => m.to).sort()).toEqual(["asta@example.dk", "cille@example.dk"]);
    expect(sent[0]!.subject).toBe(`Husk at svare: din plads til ${event.title}`);
    expect(await sendDueMails(db, env, respondBy - 10 * 3600_000)).toEqual({ invitations: 0, reminders: 0 });
  });

  it("tries again on the next run when sending fails", async () => {
    const names = ["Dina", "Erik", "Frej"];
    const other = (db.raw.prepare("SELECT slug FROM events WHERE status = 'scheduled' AND starts_at > ? AND slug != ? AND venue_name IS NOT NULL ORDER BY starts_at").all(NOW + 4 * 86_400_000, event.slug)[0] as { slug: string }).slug;
    for (const n of names) await member(n, `${n.toLowerCase()}@example.dk`);
    for (const n of names) await saveInterests(db, idOf(n), [other], [], ["ostjylland"], NOW);
    const failing: Env = { ...env, EMAIL: { send: async () => { throw Object.assign(new Error("nope"), { code: "E_RATE_LIMIT_EXCEEDED" }); } } };
    expect((await sendDueMails(db, failing, NOW)).invitations).toBe(0);
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE status = 'failed'").all()[0] as { n: number }).n).toBe(3);
    expect((await sendDueMails(db, env, NOW)).invitations).toBe(3);
  });
});

describe("Resend", () => {
  it("posts the mail to Resend's API with the key", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetcher = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response("{\"id\":\"1\"}", { status: 200 }); }) as unknown as typeof fetch;
    const r = await sendMail({ RESEND_API_KEY: "re_test", CONTACT_EMAIL: "privat@example.dk" }, { to: "a@example.dk", subject: "Hej", text: "t", html: "<p>t</p>" }, fetcher);
    expect(r).toEqual({ ok: true });
    expect(seen!.url).toBe("https://api.resend.com/emails");
    expect((seen!.init.headers as Record<string, string>).authorization).toBe("Bearer re_test");
    expect(JSON.parse(String(seen!.init.body))).toMatchObject({ from: "Socialklubben <besked@socialklubben.dk>", to: ["a@example.dk"], reply_to: "kontakt@socialklubben.dk" });
    // The contact form: the reply goes to the sender.
    await sendMail({ RESEND_API_KEY: "re_test" }, { to: "a@example.dk", subject: "Hej", text: "t", html: "t", replyTo: "sofie@example.dk" }, fetcher);
    expect(JSON.parse(String(seen!.init.body)).reply_to).toBe("sofie@example.dk");
    const bad = (async () => new Response("invalid key", { status: 401 })) as unknown as typeof fetch;
    expect(await sendMail({ RESEND_API_KEY: "re_bad" }, { to: "a@example.dk", subject: "Hej", text: "t", html: "t" }, bad)).toEqual({ ok: false, error: "resend 401: invalid key" });
  });
});

describe("the 'Bekræftet e-mail' mark", () => {
  it("comes with logging in by a link to the profile's e-mail, and goes when the e-mail is changed", async () => {
    const cookie = await member("Vera", "vera@example.dk");
    const verified = () => (db.raw.prepare("SELECT email_verified_at FROM members WHERE id = ?").all(idOf("Vera"))[0] as { email_verified_at: number | null }).email_verified_at;
    expect(verified()).toBeNull();
    sent.length = 0;
    await call("/log-ind/mail", { form: { email: "vera@example.dk", naeste: "/profil" } });
    const [, token] = linkIn(sent[0]!) as unknown as [string, string];
    const used = await call("/log-ind/link", { form: { t: token } });
    expect(used.status).toBe(303);
    expect(verified()).toBe(NOW);
    const page = (await call("/profil", { cookie })).body;
    expect(page).toContain('<span class="badge" title="Har logget ind med et link sendt til sin e-mail">Bekræftet e-mail</span>');
    // Saving the profile with the same address (any case) keeps it; a new address clears it.
    await call("/profil", { cookie, form: { fornavn: "Vera", alder: "30-39", om_mig: "Vera her", email: "Vera@Example.dk" } });
    expect(verified()).toBe(NOW);
    await call("/profil", { cookie, form: { fornavn: "Vera", alder: "30-39", om_mig: "Vera her", email: "vera2@example.dk" } });
    expect(verified()).toBeNull();
  });
});

describe("the header's login button", () => {
  it("shows Log ind to guests and Mine flokke to the logged in, and pages vary by cookie", async () => {
    const guest = await call("/");
    expect(guest.body).toContain('<a class="my-flocks" href="/log-ind">Log ind</a>');
    expect(guest.headers.get("vary")).toBe("Cookie");
    expect(guest.headers.get("cache-control")).toMatch(/^private/);
    const cookie = await member("Nora", "nora@example.dk");
    const inside = await call("/om", { cookie });
    expect(inside.body).toContain('<a class="my-flocks" href="/flokke">Mine flokke</a>');
    expect(inside.body).toContain('<a href="/profil">Min profil</a>');
    expect(inside.body).not.toContain('class="my-flocks" href="/log-ind"');
  });
});

describe("the contact form", () => {
  const form = (extra: Record<string, string> = {}) => ({ emne: "spoergsmaal", navn: "Sofie Holm", email: "sofie@example.dk", besked: "Hej! Hvordan kommer jeg med i en flok?", t: String(NOW - 30_000), ...extra });
  const count = () => (db.raw.prepare("SELECT COUNT(*) AS n FROM contact_messages").all()[0] as { n: number }).n;

  it("mails the message to the contact address with the sender as reply-to, and sends nothing to the sender", async () => {
    const page = await call("/kontakt?emne=arrangoer");
    expect(page.status).toBe(200);
    expect(page.body).toContain("<h1>Skriv til os</h1>");
    expect(page.body).toContain('<option value="arrangoer" selected>');
    expect(page.body).toContain('name="website_url"');
    expect(page.body).not.toContain("jacobhauge");
    sent.length = 0;
    const r = await call("/kontakt", { form: form({ besked: "Hej <b>der</b>\nTo linjer" }) });
    expect(r.headers.get("location")).toBe("/kontakt?besked=tak#formular");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "kontakt@socialklubben.dk", replyTo: "sofie@example.dk", subject: "Kontakt: Sofie Holm" });
    expect(sent[0]!.text).toContain("Emne: Et spørgsmål");
    expect(sent[0]!.html).toContain("Hej &lt;b&gt;der&lt;/b&gt;");
    expect((await call("/kontakt?besked=tak")).body).toContain("Tak for din besked");
    // The inbox can be a secret, never in the code.
    sent.length = 0;
    await call("/kontakt", { form: form({ navn: "Ib", emne: "arrangoer", organisation: "Voxhall" }), env: { ...env, CONTACT_INBOX: "indbakke@example.dk" } });
    expect(sent[0]).toMatchObject({ to: "indbakke@example.dk", subject: "Arrangør: Ib (Voxhall)" });
  });

  it("asks for what is missing, and an organiser for the name of the place", async () => {
    const r = await call("/kontakt", { form: form({ emne: "arrangoer", navn: "", email: "nej", besked: "" }) });
    expect(r.status).toBe(400);
    for (const t of ["Skriv dit navn.", "Skriv din e-mail", "Skriv foreningens eller stedets navn.", "Skriv din besked."]) expect(r.body).toContain(t);
    const links = await call("/kontakt", { form: form({ besked: "https://a.dk https://b.dk www.c.dk http://d.dk" }) });
    expect(links.body).toContain("Højst 3 links");
  });

  it("stops robots: the hidden field, sending too fast, and too many messages", async () => {
    sent.length = 0;
    const before = count();
    expect((await call("/kontakt", { form: form({ website_url: "x" }) })).headers.get("location")).toBe("/kontakt?besked=tak#formular");
    const fast = await call("/kontakt", { form: form({ t: String(NOW - 500) }) });
    expect(fast.status).toBe(400);
    expect(fast.body).toContain("Det gik lidt for hurtigt");
    expect(fast.body).toContain("Sofie Holm");
    expect(count()).toBe(before);
    expect(sent).toHaveLength(0);
    // Three an hour from one sender (two were sent above, from the same address).
    expect((await call("/kontakt", { form: form() })).status).toBe(303);
    const fourth = await call("/kontakt", { form: form() });
    expect(fourth.status).toBe(429);
    expect(fourth.body).toContain("flere beskeder på kort tid");
    expect(fourth.body).toContain("kontakt@socialklubben.dk");
    // An hour later it works again.
    expect((await call("/kontakt", { form: form() }, NOW + 3601_000)).status).toBe(303);
  });

  it("keeps messages beyond the day's mail budget without mailing them", async () => {
    const insert = db.raw.prepare("INSERT INTO contact_messages (id, topic, name, email, message, sender, mail, created_at) VALUES (?, 'andet', 'Robot', 'r@example.dk', 'x', 'other', 'sent', ?)");
    for (let i = 0; i < MAILS_PER_DAY; i++) insert.run(`budget-${i}`, NOW + 7200_000);
    sent.length = 0;
    expect((await call("/kontakt", { form: form({ navn: "Sen Besked" }) }, NOW + 7300_000)).status).toBe(303);
    expect(sent).toHaveLength(0);
    expect((db.raw.prepare("SELECT mail FROM contact_messages WHERE name = 'Sen Besked'").all()[0] as { mail: string }).mail).toBe("held");
  });
});
