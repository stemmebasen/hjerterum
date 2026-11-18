import { beforeAll, describe, expect, it } from "vitest";
import { handle } from "../src/index.js";
import { runIngest } from "../src/ingest/run.js";
import { SOURCES } from "../src/sources/registry.js";
import { toLocalInput } from "../src/flokken/forms.js";
import { ALL_ORGANIZERS } from "../src/organizers.js";
import { MEETING_POINTS } from "../src/flokken/meetingPoints.js";
import type { Env } from "../src/env.js";
import { testDb } from "./d1.js";
import { fakeFetch, fixture, FEED_URL, MW_ROBOTS, noSleep } from "./helpers.js";

// Jake 2026-11-18: "Ikke alt er blevet oversat". Every English page a visitor or member can reach is rendered here,
// signed out and signed in (on an interest list, in a group), and any Danish left in our own text fails the test.
// Organisers' text (titles, descriptions, venues, names) is allowed to stay Danish.
const NOW = Date.parse("2026-10-10T12:00:00Z");
const SITE = "https://socialklubben.dk";
let env: Env;
let db: ReturnType<typeof testDb>;
let organiserText = "";
let ev: { slug: string; starts_at: number };

beforeAll(async () => {
  db = testDb();
  const { fetcher } = fakeFetch({
    "https://api.membershipworks.com/robots.txt": { body: MW_ROBOTS }, [FEED_URL]: { body: fixture("hjerterum-rss.xml") },
    "https://lysetshus.dk/robots.txt": { status: 404 }, "https://lysetshus.dk/": { body: fixture("lysetshus.html") }
  });
  await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: SOURCES.filter(s => ["hjerterum", "lysetshus"].includes(s.id)) });
  env = { DB: db, ENVIRONMENT: "staging", ACTIVE_REGIONS: "ostjylland", INGEST_TOKEN: "x".repeat(32), EDITION: "portal" };
  ev = (db.raw.prepare("SELECT slug, starts_at FROM events WHERE status = 'scheduled' AND starts_at > ? AND venue_name IS NOT NULL ORDER BY starts_at").all(NOW + 86_400_000) as Array<typeof ev>)[0]!;
  const parts: string[] = [];
  for (const t of ["events", "venues", "organizers", "sources"]) {
    try { for (const row of db.raw.prepare(`SELECT * FROM ${t}`).all() as Array<Record<string, unknown>>) for (const v of Object.values(row)) if (typeof v === "string") parts.push(v); } catch { /* no such table */ }
  }
  for (const o of ALL_ORGANIZERS) parts.push(o.name, o.address ?? "", o.city ?? "", [o.address, o.postalCode, o.city].filter(Boolean).join(", "), [o.address, o.city].filter(Boolean).join(", "));
  for (const m of MEETING_POINTS) parts.push(...Object.values(m).filter((v): v is string => typeof v === "string"));
  organiserText = decode(parts.join("\n")).toLowerCase();
});

async function call(path: string, init: { form?: Record<string, string>; cookie?: string | undefined } = {}) {
  const headers: Record<string, string> = {};
  if (init.cookie) headers.cookie = init.cookie;
  if (init.form) { headers.origin = SITE; headers["content-type"] = "application/x-www-form-urlencoded"; }
  const r = await handle(new Request(SITE + path, { method: init.form ? "POST" : "GET", headers, body: init.form ? new URLSearchParams(init.form) : null }), env, NOW);
  return { status: r.status, body: await r.text(), headers: r.headers };
}

function decode(s: string): string {
  return s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

const DANISH = /[æøåÆØÅ]|\b(og|er|på|til|med|ikke|eller|du|dig|din|dit|dine|mig|jeg|vi|jer|kan|skal|vil|hvor|hvad|hvordan|når|også|fra|har|bliv|ingen|nogen|hos|efter|før|endnu|kun|alle|flok|flokke|flokken|arrangør|arrangøren|arrangement|arrangementer|medlem|tilmeld|gem|tilbage|næste|forrige|uge|dag|i dag|kl)\b/i;

/** Our own visible text on an English page that still looks Danish. */
function danishLeft(page: string): string[] {
  const body = page.replace(/<(script|style|textarea)\b[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const bits: string[] = [];
  for (const m of body.matchAll(/>([^<]+)</g)) bits.push(m[1]!);
  for (const m of body.matchAll(/\s(?:aria-label|placeholder|title|alt|content)="([^"]*)"/g)) bits.push(m[1]!);
  const out = new Set<string>();
  for (const raw of bits) {
    const text = decode(raw).replace(/\s+/g, " ").trim();
    // Proper names keep their Danish letters (Nørregade, Højbjerg); judge the rest of the words.
    if (!text || !DANISH.test(text.replace(/(^|[\s(])[A-ZÆØÅ][\p{L}'’-]*/gu, "$1"))) continue;
    if (/^https?:\/\//.test(text)) continue;
    if (text === "På dansk" || text === "Dansk" || text === "Kaffe først") continue; // Danish on purpose, or what the member typed // the way back to Danish, marked lang="da"
    // Organisers' own words may sit inside our English ("According to the description: …", "… at Hjerterum · …").
    const ours = text.replace(/…$/, "").split(/\s[·|–]\s|: |(?<=\.) /).map(s => s.trim()).filter(s => s && DANISH.test(s) && !organiserText.includes(s.toLowerCase()) && !organiserText.includes(s.replace(/^[A-Z][a-z]+ \d+ [A-Z][a-z]+ \d\d:\d\d at /, "").toLowerCase()));
    if (!ours.length) continue;
    out.add(text);
  }
  return [...out];
}

const OPEN = ["/en", "/en/calendar", "/en/calendar?periode=idag", "/en/calendar?periode=weekend", "/en/today", "/en/map", "/en/activities",
  "/en/organisers", "/en/about", "/en/meet-new-people", "/en/new-in-aarhus", "/en/things-to-do-in-aarhus", "/en/free-and-cheap",
  "/en/join-a-group", "/en/membership", "/en/safety", "/en/for-organisers", "/en/contact", "/en/log-in", "/en/aarhus", "/en/meditation",
  "/en/meditation/aarhus", "/en/klarsyn/aarhus", "/en/calendar?q=yoga", "/en/calendar?q=zzzzqqq", "/en/findes-ikke"];

describe("no Danish left on the English pages", () => {
  it("finds none, signed out or signed in", async () => {
    const found: Record<string, string[]> = {};
    const check = async (path: string, cookie?: string) => {
      const r = await call(path, { cookie });
      const left = danishLeft(r.body);
      const key = path + (cookie ? " (signed in)" : "");
      if (left.length) found[key] = [...new Set([...(found[key] ?? []), ...left])];
      return r;
    };
    const cal = await check("/en/calendar");
    const venue = /href="(\/en\/(?:steder|venues|organisers)\/[a-z0-9-]+)"/.exec(cal.body)?.[1];
    for (const p of OPEN) await check(p);
    await check(`/en/events/${ev.slug}`);
    if (venue) await check(venue);
    const org = /href="(\/en\/organisers\/[a-z0-9-]+)"/.exec((await call("/en/organisers")).body)?.[1];
    if (org) await check(org);

    // A new member, in English.
    const joined = await call("/en/membership", { form: { fornavn: "Maria", naeste: "/flokke" } });
    const cookie = /flok_session=[^;]+/.exec(joined.headers.get("set-cookie") ?? "")?.[0] ?? "";
    const note = /flok_ny_kode=[^;]+/.exec(joined.headers.get("set-cookie") ?? "")?.[0] ?? "";
    await check(joined.headers.get("location")!, `${cookie}; ${note}`);
    for (const p of ["/en/profile", "/en/my-groups", "/en/get-started", "/en", `/en/events/${ev.slug}`]) await check(p, cookie);
    // Forms sent back with mistakes show their messages in English too.
    const errorPages: Array<[string, Record<string, string>, string?]> = [["/en/profile", { fornavn: "", alder: "", om_mig: "", email: "nope" }, cookie],
      [`/en/events/${ev.slug}/opret-flok`, { moedested: "", tidspunkt: "", stoerrelse: "99", note: "" }, cookie],
      ["/en/membership", { fornavn: "<script>" }], ["/en/log-in", { email: "nope" }], ["/en/contact", { navn: "", email: "nope", tekst: "" }]];
    for (const [path, form, c] of errorPages) {
      const r = await call(path, { form, cookie: c });
      const left = danishLeft(r.body);
      if (left.length) found[`${path} (form with mistakes)`] = left;
    }
    await check(`/en/profile?naeste=${encodeURIComponent(`/events/${ev.slug}/interesse`)}&mail=1`, cookie);
    expect((await call("/en/profile", { cookie, form: { fornavn: "Maria", alder: "30-39", om_mig: "Maria her", email: "maria@example.com" } })).status).toBe(303);
    const tick = await call(`/en/events/${ev.slug}/interesse`, { cookie, form: { x: "1" } });
    expect(tick.status).toBe(303);
    await check(`/en/events/${ev.slug}`, cookie);
    await check("/en/my-groups", cookie);
    const made = await call(`/en/events/${ev.slug}/opret-flok`, { cookie, form: { moedested: "Klostertorvet", tidspunkt: toLocalInput(ev.starts_at - 30 * 60_000), stoerrelse: "3", note: "Kaffe først", offentligt: "ja" } });
    await check(`/en/events/${ev.slug}/opret-flok`, cookie);
    const flock = made.headers.get("location");
    if (flock) await check(flock, cookie);
    await check(`/en/events/${ev.slug}`, cookie);
    await check("/en/my-groups", cookie);
    await check("/en/join-a-group", cookie);
    await check("/en/profile", cookie);
    expect(found).toEqual({});
  });
});
