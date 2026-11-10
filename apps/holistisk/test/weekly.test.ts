import { describe, expect, it } from "vitest";
import { handle } from "../src/index.js";
import { runIngest } from "../src/ingest/run.js";
import { SOURCES } from "../src/sources/registry.js";
import { meetingDates, WEEKLY_SOURCE_ID } from "../src/sources/weekly.js";
import { ALL_ORGANIZERS, ORGANIZERS } from "../src/organizers.js";
import type { Env } from "../src/env.js";
import { testDb } from "./d1.js";
import { fakeFetch, noSleep } from "./helpers.js";

// Saturday 10 October 2026, 14:00 in Aarhus.
const NOW = Date.parse("2026-10-10T12:00:00Z");

describe("standing weekly offerings in the calendar", () => {
  it("meets on the listed weekdays, and only in even or odd weeks when asked", () => {
    expect(meetingDates({ title: "x", days: [0, 3], start: "18:30" }, "2026-10-10", 14)).toEqual(["2026-10-12", "2026-10-15", "2026-10-19", "2026-10-22"]);
    // 14 October is in ISO week 42 (even), 21 October in week 43.
    expect(meetingDates({ title: "x", days: [2], start: "17:30", weeks: "lige" }, "2026-10-10", 14)).toEqual(["2026-10-14"]);
    expect(meetingDates({ title: "x", days: [2], start: "17:30", weeks: "ulige" }, "2026-10-10", 14)).toEqual(["2026-10-21"]);
  });

  it("hides the meditations of the organisers switched off for a broad selection", () => {
    expect(ORGANIZERS.some(o => o.slug === "brahma-kumaris-aarhus" || o.slug === "buddhistisk-center-aarhus")).toBe(false);
  });

  it("puts each meeting of the next four weeks in the calendar, marked Fast hver uge, and lets people start a flock", async () => {
    // The two offerings with times are hidden on the site since 2026-11-10; show them again for this test.
    const shown = ALL_ORGANIZERS.filter(o => o.hidden && o.offerings.some(x => x.schedule)).map(o => ({ ...o, hidden: false }));
    ORGANIZERS.push(...shown);
    try { await weeklyRun(); } finally { ORGANIZERS.splice(ORGANIZERS.length - shown.length, shown.length); }
  });
});

async function weeklyRun() {
  const db = testDb();
  const { fetcher } = fakeFetch({});
  await runIngest({ DB: db }, { trigger: "test", now: NOW, fetcher, sleep: noSleep, sources: SOURCES.filter(s => s.id === WEEKLY_SOURCE_ID) });
  const rows = db.raw.prepare("SELECT title, starts_at, organizer_id, area, is_free, quality_flags FROM events WHERE status = 'scheduled' ORDER BY starts_at").all() as Array<{ title: string; starts_at: number; organizer_id: string; area: string; is_free: number | null; quality_flags: string }>;
  const evening = rows.filter(r => r.title === "Aftenmeditation");
  // Monday, Tuesday, Thursday and Friday for four weeks.
  expect(evening).toHaveLength(16);
  expect(evening[0]!.starts_at).toBe(Date.parse("2026-10-12T16:30:00Z"));
  expect(evening.every(r => r.organizer_id === "brahma-kumaris-aarhus" && r.area === "aarhus")).toBe(true);
  const karmapa = rows.filter(r => r.title === "16. Karmapa-meditation");
  expect(karmapa).toHaveLength(4);
  expect(karmapa[0]!.is_free).toBe(1);
  expect(rows.every(r => r.quality_flags.includes("fast-hver-uge"))).toBe(true);
  expect(rows.every(r => r.starts_at < NOW + 28 * 86400_000)).toBe(true);

  const env: Env = { DB: db, ENVIRONMENT: "staging", ACTIVE_REGIONS: "ostjylland", EDITION: "portal" };
  const body = await (await handle(new Request("https://portal.example/kalender"), env, NOW)).text();
  expect(body).toContain('<span class="kicker-weekly">Fast hver uge</span>');
  expect(body).toContain('<span class="row-title">Aftenmeditation</span>');
  // Meditation is not shown among the front page's standing offerings (a broad selection, src/mainstream.ts).
  const front = await (await handle(new Request("https://portal.example/"), env, NOW)).text();
  expect(front).not.toContain('<a href="/kalender?q=Aftenmeditation">Se datoerne i kalenderen</a>');
  const slug = (db.raw.prepare("SELECT slug FROM events WHERE title = 'Aftenmeditation' ORDER BY starts_at LIMIT 1").all()[0] as { slug: string }).slug;
  const page = await (await handle(new Request(`https://portal.example/events/${slug}`), env, NOW)).text();
  expect(page).toContain("Et fast tilbud hos Brahma Kumaris Aarhus.");
  expect(page).toContain(`href="/log-ind?naeste=${encodeURIComponent(`/events/${slug}/opret-flok`)}"`);

  // A run a week later drops the meetings that are over and adds the new week.
  const later = NOW + 7 * 86400_000;
  await runIngest({ DB: db }, { trigger: "test", now: later, fetcher, sleep: noSleep, sources: SOURCES.filter(s => s.id === WEEKLY_SOURCE_ID) });
  const coming = db.raw.prepare("SELECT COUNT(*) AS n FROM events WHERE status = 'scheduled' AND title = 'Aftenmeditation' AND starts_at > ?").all(later)[0] as { n: number };
  expect(coming.n).toBe(16);
}
