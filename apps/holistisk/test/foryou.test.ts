import { beforeAll, describe, expect, it } from "vitest";
import { handle } from "../src/index.js";
import { runIngest } from "../src/ingest/run.js";
import { SOURCES } from "../src/sources/registry.js";
import type { Env } from "../src/env.js";
import { dayList } from "../src/web/components.js";
import { forYou, readTaste, scoreEvent, tasteFromFilters, TASTE_COOKIE } from "../src/web/foryou.js";
import { kickoffEvents, type EventRow } from "../src/web/queries.js";
import { testDb } from "./d1.js";
import { fakeFetch, fixture, FEED_URL, MW_ROBOTS, noSleep } from "./helpers.js";

const NOW = Date.parse("2026-10-10T12:00:00Z");
let env: Env;
let db: ReturnType<typeof testDb>;

beforeAll(async () => {
  db = testDb();
  const { fetcher } = fakeFetch({
    "https://api.membershipworks.com/robots.txt": { body: MW_ROBOTS }, [FEED_URL]: { body: fixture("hjerterum-rss.xml") },
    "https://lysetshus.dk/robots.txt": { status: 404 }, "https://lysetshus.dk/": { body: fixture("lysetshus.html") },
    "https://buddha.dk/robots.txt": { status: 404 }, "https://buddha.dk/": { body: fixture("buddha-dk.html") }
  });
  await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: SOURCES.filter(s => ["hjerterum", "lysetshus", "buddhistisk-center-aarhus"].includes(s.id)).map(s => ({ ...s, enabled: () => true })) });
  env = { DB: db, ENVIRONMENT: "staging", ACTIVE_REGIONS: "ostjylland", EDITION: "portal" };
});

const get = (path: string, cookie?: string) => handle(new Request(`https://portal.example${path}`, cookie ? { headers: { cookie } } : {}), env, NOW);

const at = (iso: string) => Date.parse(iso);
let n = 0;
const ev = (over: Partial<EventRow>): EventRow => ({
  id: `e${++n}`, slug: `e${n}`, title: `Event ${n}`, starts_at: at("2026-10-12T16:00:00Z"), ends_at: null, all_day: 0, status: "scheduled",
  organizer_id: null, organizer_name: null, venue_name: null, categories: null, image_url: null, is_free: 0, primary_source_id: "x",
  ...over
} as unknown as EventRow);

describe("a fair mix in the calendar", () => {
  it("shows at most two events per organiser a day and folds the rest under one line", () => {
    const day = [1, 2, 3, 4, 5].map(i => ev({ title: `Dokk1 ${i}`, organizer_id: "dokk1", organizer_name: "Dokk1", starts_at: at("2026-10-12T10:00:00Z") + i * 3600_000 }));
    const other = ev({ title: "Koncert", organizer_id: "voxhall", organizer_name: "VoxHall", starts_at: at("2026-10-12T18:00:00Z") });
    const out = String(dayList([...day, other], NOW));
    expect(out).toContain("+ 3 mere fra Dokk1");
    // Nothing is gone: the folded ones are still there behind the line.
    for (const e of [...day, other]) expect(out).toContain(e.title);
    expect(out.indexOf("Koncert")).toBeLessThan(out.indexOf("+ 3 mere fra Dokk1"));
  });

  it("shows a weekly offering once, at its first date, with the later dates", () => {
    const a = ev({ title: "Åbent Lab", organizer_id: "dokk1", organizer_name: "Dokk1", starts_at: at("2026-10-13T14:00:00Z") });
    const b = ev({ title: "Åbent Lab", organizer_id: "dokk1", organizer_name: "Dokk1", starts_at: at("2026-10-15T14:00:00Z") });
    const out = String(dayList([a, b], NOW));
    expect(out).toContain("Også tor 15/10");
    expect(out).toContain("+ 1 mere fra Dokk1");
  });

  it("an organiser's own page lists all of theirs", () => {
    const day = [1, 2, 3].map(i => ev({ organizer_id: "dokk1", organizer_name: "Dokk1", starts_at: at("2026-10-12T10:00:00Z") + i * 3600_000 }));
    expect(String(dayList(day, NOW, { spread: false }))).not.toContain("mere fra");
  });
});

describe("Til dig", () => {
  it("only shows up once the person has chosen something, and says why in one line", async () => {
    expect(await (await get("/")).text()).not.toContain('id="h-for-you"');
    const picked = await get("/kalender?gruppe=fordybelse");
    const cookie = picked.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${TASTE_COOKIE}=fordybelse:2`);
    expect(picked.headers.get("cache-control")).toBe("private, no-cache");
    const home = await (await get("/", cookie.split(";")[0])).text();
    expect(home).toContain('id="h-for-you">Til dig</h2>');
    expect(home).toContain("Fordi du kan lide Fordybelse");
    expect(home).toContain('href="/til-dig/nulstil?tilbage=%2F"');
  });

  it("can be reset", async () => {
    const r = await get("/til-dig/nulstil?tilbage=/kalender", `${TASTE_COOKIE}=krea:2`);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/kalender");
    expect(r.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await get("/til-dig/nulstil?tilbage=//evil.example")).headers.get("location")).toBe("/");
  });

  it("remembers choices, not page views, and no choice outweighs the rest by being repeated", () => {
    const t = readTaste(new Request("https://x/", { headers: { cookie: `${TASTE_COOKIE}=krea:6~ukendt:3~koncerter-musik:2` } }));
    expect([...t]).toEqual([["krea", 6], ["koncerter-musik", 2]]);
    expect(tasteFromFilters(t, { group: "krea", categories: [], page: 1, q: "" })).toBeNull();
    expect(tasteFromFilters(t, { group: null, categories: [], page: 1, q: "" })).toBeNull();
    expect(tasteFromFilters(t, { group: "oplysning", categories: [], page: 2, q: "" })).toBeNull();
    expect(tasteFromFilters(t, { group: "oplysning", categories: [], page: 1, q: "" })?.get("oplysning")).toBe(2);
  });

  it("for a member, counts the events they ticked and lifts those where people their age are going", async () => {
    // One event from Hjerterum the member ticked, and a later one at another house where someone their age waits.
    const ev1 = [
      db.raw.prepare("SELECT id FROM events WHERE organizer_id = 'hjerterum' AND starts_at > ? ORDER BY starts_at LIMIT 1").all(NOW + 3 * 86400_000)[0],
      db.raw.prepare("SELECT id FROM events WHERE organizer_id <> 'hjerterum' AND starts_at BETWEEN ? AND ? ORDER BY starts_at DESC LIMIT 1").all(NOW + 3 * 86400_000, NOW + 13 * 86400_000)[0]
    ] as unknown as Array<{ id: string }>;
    db.raw.prepare("INSERT INTO members (id, first_name, code_hash, created_at, last_seen_at, age_group) VALUES ('m1', 'Ane', 'h1', ?1, ?1, '30-39'), ('m2', 'Bo', 'h2', ?1, ?1, '30-39')").run(NOW);
    db.raw.prepare("INSERT INTO event_interests (member_id, event_id, status, created_at, updated_at) VALUES ('m1', ?, 'waiting', ?, ?), ('m2', ?, 'waiting', ?, ?)")
      .run(ev1[0]!.id, NOW, NOW, ev1[1]!.id, NOW, NOW);
    const fy = await forYou(db, ["ostjylland"], NOW, new Map(), { id: "m1" });
    expect(fy).not.toBeNull();
    expect(fy!.events.map(e => e.id)).not.toContain(ev1[0]!.id);
    expect(fy!.events.map(e => e.id)).toContain(ev1[1]!.id);
    expect(fy!.sameAge).toBe(true);
  });

  it("leaves children's events out unless they were chosen", () => {
    const kids = ev({ categories: "boern-familie,koncerter-musik" });
    expect(scoreEvent(kids, new Map([["underholdning", 4]]))).toBe(0);
    expect(scoreEvent(kids, new Map([["boern-familie", 2]]))).toBeGreaterThan(0);
  });
});

describe("the interest list's variety", () => {
  it("shows one event per organiser in each ten, and a weekly offering once", async () => {
    // Ten Dokk1 events tomorrow, five of them the same weekly workshop: copies of a real event under Dokk1.
    const cols = (db.raw.prepare("PRAGMA table_info(events)").all() as Array<{ name: string }>).map(c => c.name);
    const src = db.raw.prepare("SELECT id FROM events WHERE starts_at > ? ORDER BY starts_at LIMIT 1").all(NOW + 86400_000)[0] as { id: string };
    db.raw.prepare("INSERT OR IGNORE INTO organizers (id, name, created_at, updated_at) VALUES ('dokk1', 'Dokk1', ?1, ?1)").run(NOW);
    for (let i = 0; i < 10; i++) {
      const set: Record<string, string> = { id: `'dk${i}'`, slug: `'dokk1-${i}'`, title: i < 5 ? "'Åbent Lab'" : `'Dokk1 værksted ${i}'`, organizer_id: "'dokk1'", starts_at: String(NOW + 13 * 3600_000 + i * 600_000) };
      db.raw.prepare(`INSERT INTO events (${cols.join(",")}) SELECT ${cols.map(c => set[c] ?? c).join(",")} FROM events WHERE id = ?`).run(src.id);
    }
    const list = await kickoffEvents(db, ["ostjylland"], NOW, [], 10);
    expect(list.length).toBe(10);
    // Dokk1's first event, then every other organiser's, before Dokk1 gets more (here there are few others, so it does).
    const first = list.findIndex(e => e.organizer_id === "dokk1");
    const others = list.map((e, i) => ({ e, i })).filter(x => x.e.organizer_id !== "dokk1");
    const second = list.findIndex((e, i) => i > first && e.organizer_id === "dokk1");
    expect(others.length).toBeGreaterThan(0);
    if (second >= 0) expect(second).toBeGreaterThan(others[others.length - 1]!.i);
    // The weekly workshop only once among the varied ones.
    expect(list.slice(0, others.length + 1).filter(e => e.title === "Åbent Lab").length).toBeLessThanOrEqual(1);
  });
});
