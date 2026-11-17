import { beforeAll, describe, expect, it } from "vitest";
import { handle } from "../src/index.js";
import { DAILY, pickDay, refreshPicks, scoreEvent, setCuration, titleKey, type Candidate } from "../src/curation.js";
import { sha256 } from "../src/flokken/auth.js";
import { ADMIN_COOKIE } from "../src/stats.js";
import type { Env } from "../src/env.js";
import { testDb } from "./d1.js";
import { seedCurationDays } from "./curationSeed.js";

// Tuesday evening 17 November 2026, the night Jake asked for fewer, better arrangements.
const NOW = Date.parse("2026-11-17T22:00:00Z");
const ORIGIN = "https://portal.example";
const ADMIN_TOKEN = "a".repeat(44);
let db: ReturnType<typeof testDb>;
let seeded: ReturnType<typeof seedCurationDays>;
const env = (): Env => ({ DB: db, ENVIRONMENT: "staging", ACTIVE_REGIONS: "ostjylland", EDITION: "portal" });
async function call(path: string, init: { form?: Record<string, string>; admin?: boolean } = {}): Promise<{ status: number; body: string; location: string | null }> {
  const headers: Record<string, string> = {};
  if (init.admin) headers.cookie = `${ADMIN_COOKIE}=${ADMIN_TOKEN}`;
  if (init.form) { headers.origin = ORIGIN; headers["content-type"] = "application/x-www-form-urlencoded"; }
  const r = await handle(new Request(ORIGIN + path, { method: init.form ? "POST" : "GET", headers, body: init.form ? new URLSearchParams(init.form) : null }), env(), NOW);
  return { status: r.status, body: await r.text(), location: r.headers.get("location") };
}
const idOf = (title: string) => seeded.find(e => e.title === title)!.id;
const slugOf = (title: string) => seeded.find(e => e.title === title)!.slug;
const pickedTitles = (day: string) => (db.raw.prepare("SELECT e.title FROM event_picks p JOIN events e ON e.id = p.event_id WHERE p.day = ? ORDER BY p.rank").all(day) as Array<{ title: string }>).map(r => r.title);
/** The calendar's rows for one day, from the page. */
function dayRows(body: string, day: string): string[] {
  const section = new RegExp(`<time datetime="${day}">[\\s\\S]*?</section>`).exec(body)?.[0] ?? "";
  return [...section.matchAll(/<span class="row-title">([^<]*)<\/span>/g)].map(m => m[1]!);
}

beforeAll(async () => {
  db = testDb();
  seeded = seedCurationDays(db, NOW);
  db.raw.prepare("INSERT INTO admin_tokens (token_hash, kind, created_at, expires_at) VALUES (?, 'session', ?, ?)").run(await sha256(ADMIN_TOKEN), NOW, NOW + 86_400_000);
});

const base: Candidate = {
  id: "x", slug: "x", title: "Koncert", starts_at: Date.parse("2026-11-19T19:00:00Z"), ends_at: null, all_day: 0, categories: "koncerter-musik",
  primary_source_id: "voxhall", organizer_id: "voxhall", venue_name: "VoxHall", image_url: "https://img.example/x.jpg", is_free: 0,
  price_min_minor: 15_000, price_text: "150 kr.", flock_count: 0
};

describe("scoring (Jake 2026-11-17: quality over quantity)", () => {
  it("puts an evening concert above a weekday morning workshop", () => {
    const evening = scoreEvent(base);
    const morning = scoreEvent({ ...base, starts_at: Date.parse("2026-11-19T09:00:00Z"), categories: "workshops-kurser" });
    expect("score" in evening && "score" in morning && evening.score > morning.score + 3).toBe(true);
  });

  it("leaves out sold-out arrangements, children's arrangements and notices", () => {
    expect(scoreEvent({ ...base, title: "UDSOLGT Albus Festival: Dyb tid" })).toEqual({ excluded: "udsolgt" });
    expect(scoreEvent({ ...base, title: "Fars legestue" })).toEqual({ excluded: "for børn" });
    expect(scoreEvent({ ...base, categories: "scenekunst,boern-familie" })).toEqual({ excluded: "for børn" });
    expect(scoreEvent({ ...base, title: "Alle har der har købt billet har fået besked" })).toEqual({ excluded: "ligner en besked" });
  });

  it("knows the same arrangement from two sources", () => {
    expect(titleKey("KRØYER [SUPPORT: Green Tea Bitches]")).toBe(titleKey("KRØYER"));
    expect(titleKey("DON QUIXOTE (FIN)")).toBe(titleKey("Don Quixote (FIN)"));
  });

  it("always keeps an arrangement where a flock is gathering, and a pinned one", () => {
    const weak = { ...base, id: "weak", title: "Morgenværksted", starts_at: Date.parse("2026-11-19T08:00:00Z"), categories: "workshops-kurser", organizer_id: "dokk1", image_url: null };
    const strong = Array.from({ length: 6 }, (_, i) => ({ ...base, id: `s${i}`, title: `Koncert ${"abcdef"[i]}`, organizer_id: `venue${i}`, categories: ["koncerter-musik", "scenekunst", "foredrag-debat", "quiz-fest", "natur", "dans-bevaegelse"][i]! }));
    expect(pickDay([weak, ...strong]).map(p => p.event.id)).not.toContain("weak");
    expect(pickDay([{ ...weak, flock_count: 1 }, ...strong]).map(p => p.event.id)).toContain("weak");
    expect(pickDay([{ ...weak, curation: "pin" }, ...strong]).map(p => p.event.id)).toContain("weak");
    expect(pickDay([{ ...weak, curation: "pin" }, ...strong])).toHaveLength(DAILY);
  });
});

describe("Dagens fem on three real days", () => {
  it("before the first pick, the calendar shows everything", async () => {
    expect(dayRows((await call("/kalender?fra=2026-11-21&til=2026-11-21")).body, "2026-11-21").length).toBeGreaterThan(20);
  });

  it("picks at most five a day, with variety", async () => {
    const result = await refreshPicks(db, NOW);
    expect(result.days).toBe(3);
    for (const day of ["2026-11-18", "2026-11-21", "2026-11-26"]) expect(pickedTitles(day).length).toBeLessThanOrEqual(DAILY);
    // Saturday 21 November: 37 arrangements, most of them Dokk1's children's festival.
    expect(pickedTitles("2026-11-21")).toEqual(expect.arrayContaining(["Jacob Bellens + Support Lykke", "Trouble Cats - blues og rootsrock på Resonans", "Åben scene med Unge Danske Digtere"]));
    expect(pickedTitles("2026-11-21").filter(t => /krøyer/i.test(t))).toHaveLength(1);
    expect(pickedTitles("2026-11-21").filter(t => /albus|udsolgt/i.test(t))).toEqual([]);
    // Wednesday 18 November: no notice, one Don Quixote, one Dokk1 at most.
    expect(pickedTitles("2026-11-18")).not.toContain("Alle har der har købt billet har fået besked");
    expect(pickedTitles("2026-11-18").filter(t => /don quixote/i.test(t))).toHaveLength(1);
  });

  it("the calendar, I dag and the front page show the pick; a search shows everything", async () => {
    const calendar = (await call("/kalender?fra=2026-11-18&til=2026-11-30")).body;
    expect(dayRows(calendar, "2026-11-21")).toHaveLength(pickedTitles("2026-11-21").length);
    expect(calendar).toContain("Dagens fem");
    const search = (await call("/kalender?q=albus")).body;
    expect(search).toContain("Albus Festival: Smag på historien");
    const front = (await call("/")).body;
    expect(front).not.toContain("Albus Festival: Smag på historien");
  });

  it("the admin can pin and hide; hidden is gone from search too, but its own page still opens", async () => {
    const pinned = "Strikkehækleklub";
    expect(pickedTitles("2026-11-18")).not.toContain(pinned);
    let r = await call(`/admin/udvalg/${slugOf(pinned)}`, { form: { handling: "fastgoer", dag: "2026-11-18" }, admin: true });
    expect(r.status).toBe(303);
    expect(r.location).toContain("/admin/udvalg?dag=2026-11-18");
    expect(pickedTitles("2026-11-18")).toContain(pinned);

    const hidden = "Jacob Bellens + Support Lykke";
    r = await call(`/admin/udvalg/${slugOf(hidden)}`, { form: { handling: "skjul", dag: "2026-11-21" }, admin: true });
    expect(r.status).toBe(303);
    expect(pickedTitles("2026-11-21")).not.toContain(hidden);
    expect((await call("/kalender?q=bellens")).body).not.toContain(hidden);
    expect((await call("/events/jacob-bellens-support-lykke-fe74d3")).status).toBe(200);

    await setCuration(db, idOf(hidden), null, NOW);
    expect(pickedTitles("2026-11-21")).toContain(hidden);
  });

  it("the admin page shows the day's picks with points, and the rest with why", async () => {
    const page = (await call("/admin/udvalg?dag=2026-11-21", { admin: true })).body;
    expect(page).toContain("Dagens fem");
    expect(page).toContain("Ikke med");
    expect(page).toContain("udsolgt");
    expect(page).toContain("for børn");
    expect((await call("/admin/udvalg?dag=2026-11-21")).location).toBe("/admin");
  });
});
