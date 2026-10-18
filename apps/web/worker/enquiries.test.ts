import { describe, expect, it } from "vitest";
import config from "./config-entry.js";
import { handleEnquiry } from "./enquiries.js";
import { handleStatsApi } from "./site-stats.js";
import { connectTeamMail, type ImapOpener } from "./saga/teamMail.js";
import { deps, fakeServices, sagaEnv, testDatabase } from "./saga/test-support.js";
import { ENQUIRY_TOPICS } from "../site/enquiries.js";
import { SITE_PAGES } from "../site/pages.js";

// Requested: "Hjerterum skal dog have flere henvendelsesformularer ligesom på stemmebasen.dk" - "Her skal vi i hvert fald
// have: Henvendelse vedr. opsætning af event, … deltagelse i et event, … medlemsskab, … samarbejde, … økonomi og
// fakturering, Generel henvendelse".

const SITE = "https://hjerterum.info";
const NOW = Date.parse("2026-10-04T10:00:00Z");

function mailbox() {
  const appended: string[] = [];
  const opener: ImapOpener = async () => ({ async open() { return { uidValidity: "1", uidNext: 1 }; }, async search() { return []; }, async fetch() { return []; },
    async append(raw) { appended.push(new TextDecoder().decode(raw)); }, async close() { /* */ } });
  return { appended, opener };
}
const decode = (raw: string) => [...raw.matchAll(/Content-Transfer-Encoding: base64\r\n(?:[^\r\n]+\r\n)*\r\n([A-Za-z0-9+/=\r\n]+)/g)].map(m => { try { return new TextDecoder().decode(Uint8Array.from(atob(m[1]!.replace(/\s+/g, "")), c => c.charCodeAt(0))); } catch { return ""; } }).join("\n");
const subject = (raw: string) => { const b64 = /^Subject: =\?UTF-8\?B\?([^?]+)\?=/m.exec(raw)?.[1]; return b64 ? new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0))) : /^Subject: (.*)$/m.exec(raw)?.[1]; };

async function setup(connected = true) {
  const env = sagaEnv(testDatabase(), { SAGA_TELEGRAM_WEBHOOK_SECRET: "webhook-secret-0123456789", STATS_API_SECRET: "stats-secret" }), box = mailbox();
  if (connected) await connectTeamMail(env, env.DB!, { address: "team@holistisk.org", password: "pw", by: "Jacob Hauge", nowMs: NOW }, box.opener);
  const send = (fields: Record<string, unknown>, o: { ip?: string; origin?: string; method?: string } = {}) => handleEnquiry(new Request(`${SITE}/api/henvendelse`, {
    method: o.method ?? "POST", ...(o.method === "GET" ? {} : { body: JSON.stringify({ topic: "medlemskab", name: "Mette Holm", email: "Mette@Example.dk", message: "Hvordan får jeg reduceret pris?",
      path: "/medlemskab", lang: "da", started: NOW - 30_000, ...fields }) }), headers: { origin: o.origin ?? SITE, "cf-connecting-ip": o.ip ?? "1.2.3.4" } }), env, deps(fakeServices().fetcher, NOW), box.opener);
  const counted = () => env.DB!.prepare("SELECT * FROM site_enquiries ORDER BY id").all<Record<string, unknown>>().then(r => r.results ?? []);
  return { env, box, send, counted };
}

describe("the website's enquiry forms", () => {
  it("lays an enquiry in team@'s inbox under its topic, answered to the sender, and counts nothing but day, topic and page", async () => {
    const { env, box, send, counted } = await setup();
    const response = await send({ topic: "event-opsaetning", detail: "En lørdag i november, ca. 25 deltagere", phone: "+45 12 34 56 78", callback: true, path: "/brug-hjerterum" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(box.appended).toHaveLength(1);
    const raw = box.appended[0]!, body = decode(raw);
    expect(subject(raw)).toBe("Henvendelse vedr. opsætning af event: Mette Holm");
    expect(raw).toMatch(/^Reply-To: Mette Holm <mette@example\.dk>/m);
    expect(raw).toMatch(/^To: Hjerterum <team@holistisk\.org>/m);
    for (const text of ["Emne: Henvendelse vedr. opsætning af event", "Navn: Mette Holm", "E-mail: mette@example.dk", "Telefon: +45 12 34 56 78", "Ring op: Ja, vil gerne ringes op",
      "Ønsket dato og forventet antal deltagere: En lørdag i november, ca. 25 deltagere", "Sendt fra: https://hjerterum.info/brug-hjerterum", "Besked: Hvordan får jeg reduceret pris?"]) expect(body).toContain(text);
    const rows = await counted();
    expect(rows).toEqual([{ id: 1, day: "2026-10-04", at_ms: NOW, topic: "event-opsaetning", path: "/brug-hjerterum" }]);

    // The statistics count it: enquiries, conversion, and the day it came.
    const stats = await (await handleStatsApi(new Request(`${SITE}/api/stats/site?days=7`, { headers: { authorization: "Bearer stats-secret" } }), env, NOW)).json() as Record<string, any>;
    expect(stats.tracksEnquiries).toBe(true);
    expect(stats.totals).toEqual({ visitors: 0, pageViews: 0, enquiries: 1, conversionRate: null });
    expect(stats.series.at(-1)).toEqual({ day: "2026-10-04", visitors: 0, pageViews: 0, enquiries: 1 });
  });

  it("has the six topics, each with its own details, and keeps a detail only where the topic asks for one", async () => {
    expect(ENQUIRY_TOPICS.map(t => t.label.da)).toEqual(["Henvendelse vedr. opsætning af event", "Henvendelse vedr. deltagelse i et event", "Henvendelse vedr. medlemskab",
      "Henvendelse vedr. samarbejde", "Henvendelse vedr. økonomi og fakturering", "Generel henvendelse"]);
    const { box, send } = await setup();
    for (const topic of ENQUIRY_TOPICS) expect((await send({ topic: topic.key, detail: "Faktura 1042" }, { ip: topic.key })).status).toBe(200);
    expect(box.appended.map(subject)).toEqual(ENQUIRY_TOPICS.map(t => `${t.label.da}: Mette Holm`));
    expect(decode(box.appended[4]!)).toContain("Faktura- eller ordrenummer: Faktura 1042");
    expect(decode(box.appended[2]!)).not.toContain("Faktura 1042");
  });

  it("asks for what is missing, and for a phone number when the sender wants to be called", async () => {
    const { box, send, counted } = await setup();
    expect(await (await send({ name: "", email: "ikke-en-mail", message: "" })).json()).toEqual({ error: "missing_fields", fields: ["name", "email", "message"] });
    expect(await (await send({ topic: "noget-andet" })).json()).toEqual({ error: "missing_fields", fields: ["topic"] });
    expect(await (await send({ callback: true, phone: "" })).json()).toEqual({ error: "missing_fields", fields: ["phone"] });
    expect((await send({ topic: "noget-andet" })).status).toBe(400);
    expect(box.appended).toHaveLength(0);
    expect(await counted()).toHaveLength(0);
  });

  it("tells a robot all went well and sends nothing; takes forms only from its own pages; a few an hour from one address", async () => {
    const { box, send, counted } = await setup();
    expect(await (await send({ website: "https://spam.example" })).json()).toEqual({ ok: true });
    expect(await (await send({ started: NOW - 500 })).json()).toEqual({ ok: true });
    expect((await send({}, { origin: "https://evil.example" })).status).toBe(403);
    expect((await send({}, { method: "GET" })).status).toBe(405);
    expect(box.appended).toHaveLength(0);
    for (let i = 0; i < 5; i++) expect((await send({}, { ip: "9.9.9.9" })).status).toBe(200);
    expect((await send({}, { ip: "9.9.9.9" })).status).toBe(429);
    expect(box.appended).toHaveLength(5);
    expect(await counted()).toHaveLength(5);
  });

  it("says so when the team's inbox is not connected, and counts nothing", async () => {
    const { send, counted } = await setup(false);
    const response = await send({});
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "not_delivered" });
    expect(await counted()).toHaveLength(0);
  });

  it("is answered on the website's addresses", async () => {
    const env = sagaEnv(testDatabase());
    const response = await config.fetch(new Request(`${SITE}/api/henvendelse`, { method: "POST", body: JSON.stringify({ started: Date.now() - 30_000 }), headers: { origin: SITE } }), env as never);
    expect(await response.json()).toEqual({ error: "missing_fields", fields: ["topic", "name", "email", "message"] });
  });

  it("is placed on the pages where each question arises, and every placement names a topic", () => {
    const placed = SITE_PAGES.flatMap(page => [...page.body.matchAll(/^\{\{enquiry-([a-z-]+)\}\}$/gm)].map(m => ({ path: page.path, topic: m[1]! })));
    for (const { topic } of placed) expect(ENQUIRY_TOPICS.map(t => t.key)).toContain(topic);
    expect(placed).toEqual(expect.arrayContaining([
      { path: "/kontakt", topic: "generel" }, { path: "/events", topic: "event-deltagelse" }, { path: "/brug-hjerterum", topic: "event-opsaetning" }, { path: "/brug-hjerterum/lejepriser", topic: "event-opsaetning" },
      { path: "/medlemskab", topic: "medlemskab" }, { path: "/om-os", topic: "samarbejde" }, { path: "/brug-hjerterum/vilkaar", topic: "oekonomi" }, { path: "/en", topic: "generel" }]));
    expect(SITE_PAGES.find(page => page.path === "/privatliv")!.body).toContain("{#henvendelser}");
  });
});
