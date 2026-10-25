import { categoryBySlug } from "../categories.js";
import type { D1Database } from "../db.js";
import { regionBySlug } from "../geo.js";
import { priceLabel } from "../price.js";
import { addDays, capitalize, dayLabel, hhmm, localDate, startOfLocalDay, weekdayIndex } from "../time.js";
import { html, jsonScript } from "./html.js";
import { page, type Crumb, type PageContext } from "./layout.js";
import type { View } from "./pages.js";
import { eventPath } from "./components.js";
import { mapEvents } from "./queries.js";

/** The map (/kort): every coming event with a place, as pins on a map of the city, two weeks ahead. The page carries
 * the data; public/assets/map.js draws the map (Leaflet, public/assets/vendor/leaflet) and the panel below it: the
 * area in view, a bar per day, all / with a flock / free, and the activities. Without JavaScript it points to the
 * calendar. */

export const MAP_DAYS = 14;
const WEEKDAY_LETTERS = ["M", "T", "O", "T", "F", "L", "S"];

export type MapData = {
  centre: { lat: number; lon: number };
  region: string;
  areas: Array<{ name: string; lat: number; lon: number }>;
  days: Array<{ d: string; letter: string; num: number; label: string }>;
  categories: Array<{ slug: string; name: string }>;
  /** p path, t title, d day, h time ("" all day), y/x position, v place, c activity, g free, k price, n flocks */
  events: Array<{ p: string; t: string; d: string; h: string; y: number; x: number; v: string; c: string; g: 0 | 1; k: string; n: number }>;
};

export async function mapData(db: D1Database, ctx: PageContext, regions: string[]): Promise<MapData> {
  const today = localDate(ctx.now);
  const dates = Array.from({ length: MAP_DAYS }, (_, i) => addDays(today, i));
  const until = startOfLocalDay(addDays(today, MAP_DAYS)) ?? ctx.now + MAP_DAYS * 86400_000;
  const rows = await mapEvents(db, regions, ctx.now, until);
  const counts = new Map<string, number>();
  const events = rows.map(e => {
    const c = (e.categories ?? "").split(",")[0] ?? "";
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    // An event that began before today (still going on) is shown today.
    const day = localDate(e.starts_at) < today ? today : localDate(e.starts_at);
    return {
      p: eventPath(e), t: e.title, d: day, h: e.all_day ? "" : hhmm(e.starts_at), y: e.lat!, x: e.lon!,
      v: e.venue_name ?? e.city ?? "", c, g: e.is_free === 1 ? 1 as const : 0 as const, k: priceLabel(e) ?? "", n: e.flock_count ?? 0
    };
  });
  return {
    centre: ctx.areas[0]?.centre ?? { lat: 56.1572, lon: 10.2107 },
    region: regionBySlug(regions[0] ?? "")?.name ?? ctx.regionLabel,
    areas: ctx.areas.map(a => ({ name: a.place, lat: a.centre.lat, lon: a.centre.lon })),
    days: dates.map((d, i) => ({
      d, letter: WEEKDAY_LETTERS[weekdayIndex(d)]!, num: Number(d.slice(8)),
      label: i === 0 ? "I dag" : i === 1 ? "I morgen" : capitalize(dayLabel(startOfLocalDay(d)! + 12 * 3600_000, ctx.now))
    })),
    categories: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([slug]) => ({ slug, name: categoryBySlug(slug)?.short ?? slug })),
    events
  };
}

export async function mapPage(db: D1Database, ctx: PageContext, regions: string[]): Promise<View> {
  const data = await mapData(db, ctx, regions);
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Kort", path: "/kort" }];
  const body = html`
<div class="map-page" data-map-page>
  <div class="map" data-map role="region" aria-label="Kort over kommende events"></div>
  <button class="map-locate" type="button" data-locate hidden aria-label="Vis hvor jeg er"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M20.5 3.5 3.8 10.4l7 2.1 2 7 7.7-16Z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></button>
  <section class="map-sheet" data-sheet aria-labelledby="map-title">
    <div class="sheet-overview" data-overview>
      <div class="sheet-head">
        <h1 class="sheet-title" id="map-title" data-place>${data.areas[0]?.name ?? data.region}</h1>
        <div class="seg" role="group" aria-label="Vis">
          <button type="button" data-kind="alle" aria-pressed="true">Alle</button>
          <button type="button" data-kind="flokke" aria-pressed="false">Flokke</button>
          <button type="button" data-kind="gratis" aria-pressed="false">Gratis</button>
        </div>
      </div>
      <div class="day-bars" data-days role="group" aria-label="Vælg en dag"></div>
      <p class="sheet-count"><strong data-day-label>De næste ${MAP_DAYS} dage</strong> · <span data-count>${data.events.length} events</span> <button class="link-button" type="button" data-all-days hidden>Alle ${MAP_DAYS} dage</button></p>
      <div class="map-chips" data-chips role="group" aria-label="Aktivitet"></div>
    </div>
    <div class="sheet-place" data-place-view hidden>
      <div class="sheet-head"><button class="back-button" type="button" data-back aria-label="Tilbage til oversigten">←</button><h2 class="sheet-title" data-place-name></h2></div>
      <ol class="sheet-list" data-list></ol>
    </div>
    <noscript><p>Kortet kræver JavaScript. <a href="/kalender">Se alle events i kalenderen</a>.</p></noscript>
  </section>
</div>
<script type="application/json" id="kort-data">${jsonScript(data)}</script>`;
  return {
    status: 200,
    body: page(ctx, {
      title: `Kort over events i ${ctx.regionLabel}`,
      description: `Se de næste ${MAP_DAYS} dages koncerter, foredrag, workshops og flokke i ${ctx.regionLabel} på et kort – dag for dag, gratis eller med en flok.`,
      canonical: "/kort", breadcrumbs: crumbs, bare: true,
      styles: ["/assets/vendor/leaflet/leaflet.css?v=1.9.4"],
      scripts: ["/assets/vendor/leaflet/leaflet.js?v=1.9.4", "/assets/map.js?v=1"]
    }, body)
  };
}
