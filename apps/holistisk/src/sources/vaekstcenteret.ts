import { collapse, decodeEntities, findHost, htmlToParagraphs } from "../text.js";
import { zonedToUtc } from "../time.js";
import { parsePrice } from "../price.js";
import { decodeBody } from "./http.js";
import { venueFor } from "./membershipworks.js";
import type { AdapterContext, FetchResult, SourceAdapter, SourceConfig, SourceEvent } from "./types.js";

/** Vækstcenteret (vaekstcenteret.dk/kurser/): the course list gives category, title, link, teachers, start date
 * (dd/mm/yyyy) and price; each course page gives the exact dates and times ("14/10/2026 kl. 09:00 - 17/10/2026
 * kl. 13:00") and the place ("Kursussted"). The list alone makes a dated, all-day event; the course page, looked up
 * for new and changed courses, gives it its times. Courses held online are left out. The site asks for 10 seconds
 * between requests (robots.txt Crawl-delay), which the HTTP client honours. Options: url, skipCategories. */

type Box = { title: string; link: string; category: string; teachers: string[]; startDate: string | null; price: string | null };

export function parseCourseList(html: string): Box[] {
  const out: Box[] = [];
  const parts = html.split(/<div class="new-course-box[^"]*">/).slice(1);
  for (const part of parts) {
    const link = /<div class="course-title">[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(part);
    if (!link) continue;
    const category = /<div class="course-category">\s*<a[^>]*>([\s\S]*?)<\/a>/.exec(part)?.[1] ?? "";
    const teachers = [...(/<div class="box teacher">([\s\S]*?)<\/div>\s*<\/div>/.exec(part)?.[1] ?? "").matchAll(/<a[^>]*>([\s\S]*?)<\/a>/g)].map(m => collapse(decodeEntities(m[1]!)));
    const date = /<div class="box date">\s*<span>(\d{2})\/(\d{2})\/(\d{4})<\/span>/.exec(part);
    const price = /<div class="box location">\s*([^<]+?)\s*<\/div>/.exec(part)?.[1] ?? null;
    out.push({
      title: collapse(decodeEntities(link[2]!.replace(/<[^>]+>/g, ""))),
      link: link[1]!,
      category: collapse(decodeEntities(category.replace(/<[^>]+>/g, ""))),
      teachers,
      startDate: date ? `${date[3]}-${date[2]}-${date[1]}` : null,
      price: price ? collapse(decodeEntities(price)) : null
    });
  }
  return out;
}

const DATE_TIME = /(\d{2})\/(\d{2})\/(\d{4})(?:\s*kl\.?\s*(\d{1,2})[:.](\d{2}))?/g;

/** "14/10/2026 kl. 09:00 - 17/10/2026 kl. 13:00" and the course place, from a course page. */
export function parseCoursePage(html: string): { start: { date: string; h: number | null; m: number | null } | null; end: { date: string; h: number | null; m: number | null } | null; place: string | null; paragraphs: string[] } {
  const dates = /<li class="multiple_dates">([\s\S]*?)<\/li>/.exec(html)?.[1] ?? "";
  const found = [...dates.replace(/<[^>]+>/g, " ").matchAll(DATE_TIME)].map(m => ({ date: `${m[3]}-${m[2]}-${m[1]}`, h: m[4] ? Number(m[4]) : null, m: m[5] ? Number(m[5]) : null }));
  const place = /<div class="lbl">\s*Kursussted:\s*<\/div>\s*<div class="val">\s*([\s\S]*?)\s*<\/div>/.exec(html)?.[1];
  const content = /<div class="(?:entry-content|course-content|single-course-content)[^"]*">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
  return { start: found[0] ?? null, end: found[1] ?? null, place: place ? collapse(decodeEntities(place.replace(/<[^>]+>/g, ""))) : null, paragraphs: htmlToParagraphs(content).slice(0, 40) };
}

const at = (date: string, h: number, m: number, zone: string) => {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  return zonedToUtc({ year: y, month: mo, day: d, hour: h, minute: m }, zone);
};

function place(config: SourceConfig, text: string) {
  return venueFor(text, config.defaults.venues);
}

export const vaekstcenteret: SourceAdapter = {
  async fetch(config: SourceConfig, ctx: AdapterContext): Promise<FetchResult> {
    const url = String(config.options.url ?? "https://vaekstcenteret.dk/kurser/");
    const skip = new RegExp(String(config.options.skipCategories ?? "online"), "i");
    const res = await ctx.http.get(url, { headers: { accept: "text/html" }, respectRobots: config.respectRobots });
    const boxes = parseCourseList(decodeBody(res.body, res.headers.get("content-type")));
    if (!boxes.length) throw new Error("vaekstcenteret_no_courses_found");
    const zone = config.defaults.timezone;
    const events: SourceEvent[] = [];
    let unreadable = 0;
    for (const b of boxes) {
      if (!b.startDate) { unreadable++; continue; }
      if (skip.test(b.category) || skip.test(b.title)) continue;
      const venue = place(config, `${b.category} ${b.title}`);
      const price = parsePrice(b.price ? [`Pris: ${b.price}`] : []);
      const start = at(b.startDate, 0, 0, zone);
      events.push({
        sourceEventId: b.link.replace(/\/+$/, "").split("/").pop() ?? b.link,
        title: b.title,
        paragraphs: [],
        startsAt: start,
        endsAt: at(b.startDate, 24, 0, zone),
        allDay: true,
        timezone: zone,
        organizerName: config.defaults.organizerName,
        organizerUrl: config.defaults.organizerUrl,
        hostName: b.teachers.join(", ") || null,
        venueName: venue?.name ?? null,
        address: venue?.address ?? null,
        postalCode: venue?.postalCode ?? null,
        city: venue?.city ?? null,
        lat: venue?.lat ?? null,
        lon: venue?.lon ?? null,
        locationText: `${b.category}`,
        categoryHints: [b.category, "Meditation"],
        price: price.minMinor === null && price.isFree === null ? null : { ...price, currency: "DKK" },
        signupUrl: b.link,
        sourceUrl: b.link,
        imageUrl: null,
        cancelled: false,
        qualityFlags: ["time_from_course_page"]
      });
    }
    const upcoming = events.filter(e => (e.endsAt ?? e.startsAt) >= ctx.now - 24 * 3600_000);
    return { events: upcoming, windowEnd: events.length ? Math.max(...events.map(e => e.startsAt)) : null, unreadable };
  },

  /** The course page: exact dates and times, and where the course is held. */
  async enrich(event: SourceEvent, config: SourceConfig, ctx: AdapterContext): Promise<SourceEvent> {
    if (!event.sourceUrl) return event;
    const res = await ctx.http.get(event.sourceUrl, { headers: { accept: "text/html" }, respectRobots: config.respectRobots });
    const page = parseCoursePage(decodeBody(res.body, res.headers.get("content-type")));
    const zone = config.defaults.timezone;
    const venue = place(config, [page.place, event.locationText, event.title].filter(Boolean).join(" "));
    const out: SourceEvent = { ...event, qualityFlags: event.qualityFlags.filter(f => f !== "time_from_course_page") };
    if (page.start) {
      const timed = page.start.h !== null;
      out.allDay = !timed;
      out.startsAt = at(page.start.date, page.start.h ?? 0, page.start.m ?? 0, zone);
      const end = page.end ?? page.start;
      out.endsAt = timed && end.h !== null ? at(end.date, end.h, end.m ?? 0, zone) : at(end.date, 24, 0, zone);
      if (out.endsAt < out.startsAt) out.endsAt = null;
    }
    if (page.paragraphs.length) { out.paragraphs = page.paragraphs; out.hostName = out.hostName ?? findHost(page.paragraphs); }
    if (venue) Object.assign(out, { venueName: venue.name, address: venue.address, postalCode: venue.postalCode, city: venue.city, lat: venue.lat, lon: venue.lon });
    if (page.place) out.locationText = page.place;
    return out;
  }
};
