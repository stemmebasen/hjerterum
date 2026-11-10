import { ORGANIZERS, type OrganizerProfile, type Schedule } from "../organizers.js";
import { addDays, localDate, weekdayIndex, zonedToUtc } from "../time.js";
import { isoWeek } from "./lysetshus.js";
import type { AdapterContext, FetchResult, SourceAdapter, SourceConfig, SourceEvent } from "./types.js";

/** Standing weekly offerings ("Faste ugentlige tilbud") as calendar entries: each organiser offering with a schedule
 * (src/organizers.ts) becomes one event per meeting in the coming weeks, so it shows in the calendar and people can
 * start a flock for it. Nothing is fetched; the times are the ones the organiser states on its own site (the offering's
 * source). Options: days (how far ahead, default 28). */

export const WEEKLY_SOURCE_ID = "faste-tilbud";
export const WEEKLY_FLAG = "fast-hver-uge";

function at(date: string, time: string, zone: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  return zonedToUtc({ year: y, month: m, day: d, hour, minute }, zone);
}

/** The dates in [from, from + days) a schedule meets on. */
export function meetingDates(s: Schedule, from: string, days: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    if (!s.days.includes(weekdayIndex(date))) continue;
    if (s.weeks && (isoWeek(date) % 2 === 0) !== (s.weeks === "lige")) continue;
    out.push(date);
  }
  return out;
}

export function weeklyEvents(profiles: OrganizerProfile[], config: SourceConfig, now: number): SourceEvent[] {
  const zone = config.defaults.timezone;
  const days = typeof config.options.days === "number" ? config.options.days : 28;
  const out: SourceEvent[] = [];
  for (const p of profiles) p.offerings.forEach((o, i) => {
    const s = o.schedule;
    if (!s) return;
    for (const date of meetingDates(s, localDate(now), days)) {
      const startsAt = at(date, s.start, zone);
      if (startsAt <= now) continue;
      out.push({
        sourceEventId: `${p.slug}-${i}-${date}`,
        title: s.title,
        paragraphs: [s.about ?? o.text, `Et fast tilbud hos ${p.name}. Tjek altid arrangørens egen side, før du går, hvis det skulle være aflyst.`],
        startsAt, endsAt: s.end ? at(date, s.end, zone) : null, allDay: false, timezone: zone,
        organizerName: p.name, organizerUrl: p.website, hostName: null,
        venueName: p.name, address: p.address, postalCode: p.postalCode, city: p.city, lat: p.lat, lon: p.lon, locationText: p.name,
        categoryHints: s.categories ?? [],
        price: s.free ? { minMinor: 0, maxMinor: 0, isFree: true, text: "Gratis", currency: "DKK" } : null,
        signupUrl: null, sourceUrl: o.source, imageUrl: null, cancelled: false, qualityFlags: [WEEKLY_FLAG]
      });
    }
  });
  return out;
}

export const weekly: SourceAdapter = {
  async fetch(config: SourceConfig, ctx: AdapterContext): Promise<FetchResult> {
    const days = typeof config.options.days === "number" ? config.options.days : 28;
    return { events: weeklyEvents(ORGANIZERS, config, ctx.now), windowEnd: ctx.now + days * 86400_000, unreadable: 0 };
  }
};
