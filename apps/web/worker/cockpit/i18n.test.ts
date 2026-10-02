import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { translateHtml, worthTranslating } from "./i18n.js";
import { scheduledTranslations, translatePage } from "./translate.js";
import { processNextMinutes } from "../saga/saga.js";
import { claimJob, saveBoardMessage } from "../saga/store.js";
import { BOARD, deps, fakeServices, OWNER, sagaEnv, testDatabase } from "../saga/test-support.js";

// Requested: "Der bør vær en engelsk oversættelses knap - Douglas taler engelsk. Eller hvad forslår du?" - the suggestion:
// a language chosen once per member; menus, buttons and Saga's short texts in English, Saga answering in English, the
// minutes and decisions in Danish as written, with "Read in English" on each minutes - "Ja byg det sådan".
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-10-01T10:00:00Z"); // a Thursday
const SATURDAY = Date.parse("2026-10-03T10:00:00Z");
const NOW_TEXT = "Det summer af forberedelser til generalforsamlingen, og Lisbeth har styr på dirigentrollen.";

describe("the cockpit in English", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("translates the cockpit's own words - never the board's text, the page's code or what it cannot place", () => {
    const page = translateHtml(`<html lang="da"><title>Møder · Hjerterum bestyrelse</title><nav><a href="/">Overblik</a><a href="/opgaver">Opgaver</a></nav>
<input placeholder="Skriv dit spørgsmål"><button type="button">Hvad er mine to-do&#39;s?</button><p class="who">Stillet af Lisbeth 2. okt. 2026 · frist 9. okt. 2026</p>
<div translate="no"><p>Opgaver</p><p>Mødet holdes torsdag den 1. oktober 2026</p></div><p>Budgettet er vedtaget</p><script>const t="Saga tænker …";if(a<b)x("Opgaver")</script><p>Næste møde</p>`);
    expect(page).toContain('<html lang="en"><title>Meetings · Hjerterum board</title><nav><a href="/">Overview</a><a href="/opgaver">Tasks</a></nav>');
    expect(page).toContain('placeholder="Write your question"');
    expect(page).toContain("What are my to-dos?");
    expect(page).toContain("Proposed by Lisbeth 2 Oct 2026 · deadline 9 Oct 2026");
    expect(page).toContain('<div translate="no"><p>Opgaver</p><p>Mødet holdes torsdag den 1. oktober 2026</p></div><p>Budgettet er vedtaget</p>');
    expect(page).toContain('<script>const t="Saga is thinking …";if(a<b)x("Opgaver")</script><p>Next meeting</p>');
  });

  it("lets a member choose English once; Saga's front-page text is translated on weekdays, and Saga answers in English", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    let lastSystem = "", lastUser = "";
    const services = fakeServices({ ai: (system, user) => { lastSystem = system; lastUser = user;
      if (system.startsWith("You translate the minutes")) return "# Minutes - board meeting 30 September 2026\n## Decisions\n- The budget is adopted";
      if (system.startsWith("You translate texts")) return JSON.stringify({ texts: (JSON.parse(user) as { texts: string[] }).texts.map(t => t === NOW_TEXT ? "Preparations for the general assembly are buzzing, and Lisbeth has the chairing in hand." : `EN: ${t}`) });
      return system.includes("referat") ? "# Referat - bestyrelsesmøde 30. september 2026\n## Beslutninger\n- Budgettet er vedtaget\n## Opgaver\n- Gitta - Lav event-mail - 15. oktober" : "The membership costs 222 DKK a month."; } });
    const stored = new Map<string, ArrayBuffer>();
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026", BOARD_RECORDINGS: { put: async (key: string, value: ArrayBuffer) => { stored.set(key, value); return {}; },
      get: async (key: string) => stored.has(key) ? { arrayBuffer: async () => stored.get(key)! } : null } as never });
    for (const [i, [name, id]] of ([["Jacob Hauge", OWNER], ["Douglas", "201"]] as const).entries())
      await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: id, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
    const call = (path: string, init: RequestInit & { cookie?: string; json?: boolean } = {}) => handleCockpitRequest(new Request(ORIGIN + path, { ...init, redirect: "manual",
      headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.json ? { "content-type": "application/json" } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, NOW));
    const form = (f: Record<string, string | Blob>) => { const d = new FormData(); for (const [k, v] of Object.entries(f)) d.append(k, v); return d; };
    const session = ((await call("/login", { method: "POST", body: form({ password: "hjerte-2026" }) })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const douglas = `${session}; hjerterum_cockpit_who=Douglas`, jacob = `${session}; hjerterum_cockpit_who=${encodeURIComponent("Jacob Hauge")}`;
    await db.prepare("INSERT INTO board_now (text, newest_source_ms, created_at_ms) VALUES (?, ?, ?)").bind(NOW_TEXT, NOW - 1000, NOW - 1000).run();

    expect(await (await call("/profil", { cookie: douglas })).text()).toContain("Sprog / Language");
    expect((await call("/sprog", { method: "POST", cookie: douglas, body: form({ lang: "en" }) })).headers.get("location")).toBe("/profil");
    // Chosen once, the front page is in English - Saga's text too, translated when the member chose English.
    const home = await (await call("/", { cookie: douglas })).text();
    expect(home).toContain('<html lang="en">');
    expect(home).toContain("<h2>The board right now</h2>");
    expect(home).toContain("Preparations for the general assembly are buzzing");
    expect(home).toContain("Hi Douglas 🙂 I'm Saga.");
    // Everyone else keeps Danish.
    const danish = await (await call("/", { cookie: jacob })).text();
    expect(danish).toContain("<h2>Bestyrelsen lige nu</h2>");
    expect(danish).toContain(NOW_TEXT);

    // A new text is translated in Saga's weekday round - not at the weekend.
    await db.prepare("INSERT INTO board_now (text, newest_source_ms, created_at_ms) VALUES ('Stille uge i huset.', ?, ?)").bind(NOW, NOW).run();
    await scheduledTranslations(env, deps(services.fetcher, SATURDAY), db, (key, slot) => claimJob(db, key, slot, SATURDAY));
    expect(await (await call("/", { cookie: douglas })).text()).toContain("Stille uge i huset.");
    await scheduledTranslations(env, deps(services.fetcher, NOW), db, (key, slot) => claimJob(db, key, slot, NOW));
    expect(await (await call("/", { cookie: douglas })).text()).toContain("EN: Stille uge i huset.");

    // Saga answers in English.
    await call("/saga", { method: "POST", json: true, cookie: douglas, body: JSON.stringify({ question: "Hvad koster et medlemskab?", history: [] }) });
    expect(lastUser).toContain("Douglas spørger (læser cockpittet på engelsk - svar på engelsk)");
    expect(lastSystem).toContain("Svar på det sprog");

    // The minutes stay Danish as written, with "Read in English".
    await call("/upload", { method: "POST", cookie: jacob, body: form({ recording: new File([new Uint8Array([1, 2, 3])], "m.m4a", { type: "audio/mp4" }), meeting_date: "2026-09-30" }) });
    const id = (await db.prepare("SELECT id FROM board_minutes").first<{ id: number }>())!.id;
    expect(await processNextMinutes(env, deps(services.fetcher, NOW))).toBe(true);
    {
      const before = await (await call(`/referat/${id}`, { cookie: douglas })).text();
      expect(before).toContain("Budgettet er vedtaget");
      expect(before).toContain(">Read in English</button>");
      await call(`/referat/${id}/engelsk`, { method: "POST", cookie: douglas });
      const after = await (await call(`/referat/${id}`, { cookie: douglas })).text();
      expect(after).toContain("The budget is adopted");
      expect(after).toContain("Show the Danish original");
      expect(await (await call(`/referat/${id}?original=1`, { cookie: douglas })).text()).toContain("Budgettet er vedtaget");
    }
  });
});

describe("whole pages in English", () => {
  // Requested: "I think that overview, tasks, and decisions should be automatically translated".
  const page = `<!doctype html><html lang="da"><body><h1>Opgaver</h1><ul><li>Ring til udlejeren om nøglerne</li><li>Jacob</li><li>3.600</li></ul><p translate="no">Hjerterum ApS kontrakt</p></body></html>`;

  it("translates what the dictionary does not know, once, and keeps it", async () => {
    const db = testDatabase();
    let calls = 0;
    const services = fakeServices({ ai: (_system, user) => { calls += 1; const { texts } = JSON.parse(user) as { texts: string[] };
      return JSON.stringify({ texts: texts.map(t => t === "Ring til udlejeren om nøglerne" ? "Call the landlord about the keys" : `EN ${t}`) }); } });
    const env = sagaEnv(db);
    const weekday = Date.parse("2026-10-02T10:00:00Z");
    const first = await translatePage(env, deps(services.fetcher, weekday), db, page);
    expect(first).toContain("<li>Call the landlord about the keys</li>");
    expect(first).toContain("<h1>Tasks</h1>");
    expect(first).toContain("<li>Jacob</li>");
    expect(first).toContain("<li>3.600</li>");
    expect(first).toContain("Hjerterum ApS kontrakt");
    expect(calls).toBe(1);
    expect(await translatePage(env, deps(services.fetcher, weekday), db, page)).toContain("Call the landlord about the keys");
    expect(calls).toBe(1);
  });

  it("does not call the AI at the weekend; kept translations still show", async () => {
    const db = testDatabase();
    let calls = 0;
    const services = fakeServices({ ai: () => { calls += 1; return JSON.stringify({ texts: ["x"] }); } });
    const saturday = Date.parse("2026-10-03T10:00:00Z");
    const out = await translatePage(sagaEnv(db), deps(services.fetcher, saturday), db, page);
    expect(out).toContain("Ring til udlejeren om nøglerne");
    expect(calls).toBe(0);
  });

  it("leaves names, numbers and addresses alone", () => {
    expect(worthTranslating("Jacob")).toBe(false);
    expect(worthTranslating("team@holistisk.org")).toBe(false);
    expect(worthTranslating("Køb kaffe")).toBe(true);
    expect(worthTranslating("Book the room")).toBe(true);
  });
});
