import { beforeAll, describe, expect, it } from "vitest";
import { handle } from "../src/index.js";
import { runIngest } from "../src/ingest/run.js";
import { SOURCES } from "../src/sources/registry.js";
import { forgetTitles, looksDanish, sourceHash, translateEvents, TRANSLATE_CRON } from "../src/i18n/machine.js";
import type { Env } from "../src/env.js";
import { testDb } from "./d1.js";
import { fakeFetch, fixture, FEED_URL, MW_ROBOTS, noSleep } from "./helpers.js";

// Jake 2026-11-18, "og selve eventet": arrangements' own text in English, machine-translated once and kept.
const NOW = Date.parse("2026-10-10T12:00:00Z");
const SITE = "https://socialklubben.dk";
let db: ReturnType<typeof testDb>;
let ev: { id: string; slug: string; title: string; description: string };
const asked: Array<{ title: string; text: string }> = [];

/** A stand-in for Workers AI: "translates" by marking the text, and keeps one title as a name. */
const fakeAi = {
  async run(_model: string, input: Record<string, unknown>) {
    const messages = input.messages as Array<{ role: string; content: string }>;
    const q = JSON.parse(messages[1]!.content) as { title: string; text: string };
    asked.push(q);
    const title = q.title === "Bob Dylan" ? q.title : `EN ${q.title}`;
    return { response: "Here you go: " + JSON.stringify({ title, text: q.text.split("\n").map(p => `EN ${p}`).join("\n") }) };
  }
};

beforeAll(async () => {
  db = testDb();
  const { fetcher } = fakeFetch({ "https://api.membershipworks.com/robots.txt": { body: MW_ROBOTS }, [FEED_URL]: { body: fixture("hjerterum-rss.xml") } });
  await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: SOURCES.filter(s => s.id === "hjerterum") });
  ev = (db.raw.prepare("SELECT id, slug, title, description FROM events WHERE starts_at > ? AND description IS NOT NULL ORDER BY starts_at LIMIT 1").all(NOW) as Array<typeof ev>)[0]!;
});

const env = (): Env => ({ DB: db, ENVIRONMENT: "staging", ACTIVE_REGIONS: "ostjylland", EDITION: "portal", INGEST_TOKEN: "t".repeat(32), AI: fakeAi });
const get = async (path: string) => { const r = await handle(new Request(SITE + path), env(), NOW); return { status: r.status, body: await r.text() }; };

describe("machine translation of arrangements", () => {
  it("tells Danish from English", () => {
    expect(looksDanish("Julebag med Værdibørsen")).toBe(true);
    expect(looksDanish("Vi bager småkager og hygger os sammen")).toBe(true);
    expect(looksDanish("Deep Shamanic Healing Journey")).toBe(false);
    expect(looksDanish("Bob Dylan")).toBe(false);
  });

  it("does nothing without the AI binding, and says so", async () => {
    const out = await translateEvents({ DB: db }, NOW);
    expect(out.error).toBe("ai_unbound");
    expect(out.pending).toBeGreaterThan(0);
  });

  it("translates the soonest arrangements once, and again only when their text changes", async () => {
    const first = await translateEvents(env(), NOW, 50);
    expect(first.error).toBeNull();
    expect(first.translated + first.kept).toBeGreaterThan(0);
    expect(first.pending).toBe(0);
    const row = db.raw.prepare("SELECT * FROM event_translations WHERE event_id = ?").all(ev.id)[0];
    expect(row).toBeTruthy();
    const count = asked.length;
    expect((await translateEvents(env(), NOW, 50)).translated).toBe(0);
    expect(asked.length).toBe(count);
    db.raw.prepare("UPDATE events SET description = description || ? WHERE id = ?").run("\nNy linje med mere tekst om aftenen.", ev.id);
    const again = await translateEvents(env(), NOW, 50);
    expect(again.translated + again.kept).toBe(1);
    db.raw.prepare("UPDATE events SET description = ? WHERE id = ?").run(ev.description, ev.id);
    await translateEvents(env(), NOW, 50);
  });

  it("shows the English text on the English event page, with the Danish original kept", async () => {
    db.raw.prepare("UPDATE event_translations SET status = 'translated', title_en = ?, description_en = ?, source_hash = ? WHERE event_id = ?")
      .run("Christmas baking", "We bake Christmas biscuits together.", sourceHash(ev.title, ev.description.split(/\n+/).map(p => p.trim()).filter(Boolean).join("\n")), ev.id);
    forgetTitles();
    const en = await get(`/en/events/${ev.slug}`);
    expect(en.body).toContain("<h1>Christmas baking</h1>");
    expect(en.body).toContain("<p>We bake Christmas biscuits together.</p>");
    expect(en.body).toContain("Automatically translated from Danish");
    expect(en.body).toContain("<summary lang=\"en\">Original in Danish</summary>");
    // The original stays as the organiser wrote it, title included.
    const original = /<div translate="no" lang="da">([\s\S]*?)<\/details>/.exec(en.body)?.[1] ?? "";
    expect(original).toContain(ev.title.replace(/&/g, "&amp;").replace(/'/g, "&#39;").slice(0, 10));
    // Lists and search use the English title too.
    expect((await get("/en/calendar")).body).toContain("Christmas baking");
    // The Danish page is untouched.
    const da = await get(`/events/${ev.slug}`);
    expect(da.body).not.toContain("Christmas baking");
    expect(da.body).not.toContain("Original in Danish");
  });

  it("runs from its own cron and from the token-protected endpoint", async () => {
    const denied = await handle(new Request(SITE + "/api/translate/run", { method: "POST" }), env(), NOW);
    expect(denied.status).toBe(401);
    const ok = await handle(new Request(SITE + "/api/translate/run?antal=3", { method: "POST", headers: { authorization: `Bearer ${"t".repeat(32)}` } }), env(), NOW);
    expect(ok.status).toBe(200);
    expect((await ok.json() as { model: string }).model).toContain("llama");
    const { default: worker } = await import("../src/index.js");
    await worker.scheduled({ cron: TRANSLATE_CRON, scheduledTime: NOW }, env());
  });
});
