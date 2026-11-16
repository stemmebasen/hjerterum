import { beforeAll, describe, expect, it } from "vitest";
import { handle } from "../src/index.js";
import { runIngest } from "../src/ingest/run.js";
import { SOURCES } from "../src/sources/registry.js";
import { saveInterests } from "../src/flokken/kickoff.js";
import { sendDueMails } from "../src/flokken/notify.js";
import { sendMail, type EmailBinding } from "../src/mail.js";
import type { Env } from "../src/env.js";
import { testDb } from "./d1.js";
import { fakeFetch, fixture, FEED_URL, MW_ROBOTS, noSleep } from "./helpers.js";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const ORIGIN = "https://portal.example";
type Sent = { to: string; subject: string; html: string; text: string };
const sent: Sent[] = [];
const binding: EmailBinding = { send: async m => { sent.push({ to: m.to, subject: m.subject, html: m.html, text: m.text }); return { messageId: "x" }; } };
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
    expect(asked.status).toBe(200);
    expect(asked.body).toContain("Tjek din indbakke");
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

  it("answers the same for an unknown address and sends nothing, and limits links per hour", async () => {
    sent.length = 0;
    const r = await call("/log-ind/mail", { form: { email: "ukendt@example.dk" } });
    expect(r.body).toContain("Tjek din indbakke");
    expect(sent).toHaveLength(0);
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
    const r = await sendMail({ RESEND_API_KEY: "re_test", CONTACT_EMAIL: "kontakt@example.dk" }, { to: "a@example.dk", subject: "Hej", text: "t", html: "<p>t</p>" }, fetcher);
    expect(r).toEqual({ ok: true });
    expect(seen!.url).toBe("https://api.resend.com/emails");
    expect((seen!.init.headers as Record<string, string>).authorization).toBe("Bearer re_test");
    expect(JSON.parse(String(seen!.init.body))).toMatchObject({ from: "Socialklubben <besked@socialklubben.dk>", to: ["a@example.dk"], reply_to: "kontakt@example.dk" });
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
