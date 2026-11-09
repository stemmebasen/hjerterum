import { decodeEntities } from "../text.js";
import { zonedToUtc } from "../time.js";
import { parsePrice } from "../price.js";
import { decodeBody } from "./http.js";
import { parseCurtain, parseDanishRange, productionEvents, stageText, upcoming, type Production } from "./stage.js";
import type { AdapterContext, FetchResult, SourceAdapter, SourceConfig, SourceEvent } from "./types.js";

/** Aarhus' small stages, read from the theatres' own pages. Most sell tickets through Billetten.dk, whose shop does not
 * answer automated requests, so only performances whose date and time the theatre's own page gives are shown
 * (see stage.ts). Teatret Gruppe 38 and Svalegangen print only runs ("29. november – 17. december") and are not
 * collected for that reason. */

const price = (text: string | null): SourceEvent["price"] => {
  if (!text) return null;
  // "From DKK 95 – 210": both ends are prices.
  const t = text.replace(/\bdkk\s*(\d+)\s*[–-]\s*(\d+)/gi, "$1 kr. – $2 kr.").replace(/\bdkk\s*(\d+)/gi, "$1 kr.");
  const p = parsePrice([/pris|kr|,-|gratis/i.test(t) ? t : `Pris: ${t}`]);
  return p.minMinor !== null || p.isFree ? { ...p, text, currency: "DKK" } : null;
};

async function page(url: string, config: SourceConfig, ctx: AdapterContext): Promise<string> {
  const res = await ctx.http.get(url, { headers: { accept: "text/html" }, respectRobots: config.respectRobots });
  return decodeBody(res.body, res.headers.get("content-type"));
}

const result = (events: SourceEvent[], unreadable: number): FetchResult =>
  ({ events, windowEnd: events.length ? Math.max(...events.map(e => e.startsAt)) : null, unreadable });

// ---------------------------------------------------------------------------------------------------------------
/** Teaterhuset Filuren (filuren.dk/kalender/): every performance as
 *   <a class="visning" href="…/forestillinger/familiedans/" aria-label="…"><div class="day">lørdag</div>
 *   <div class="date">14/11<span class="year current"> 2026</span></div><div class="time">10.00</div><div class="titel">Familiedans</div>
 *   <div class="status">… */
export function parseFiluren(html: string, config: SourceConfig): { events: SourceEvent[]; unreadable: number } {
  const zone = config.defaults.timezone;
  const venue = config.defaults.venues[0] ?? null;
  const events: SourceEvent[] = [];
  let unreadable = 0;
  for (const m of html.matchAll(/<a class="visning" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const [, href, block] = m as unknown as [string, string, string];
    const date = /class="date">\s*(\d{1,2})\/(\d{1,2})\s*<span[^>]*>\s*(\d{4})/.exec(block);
    const time = /class="time">\s*(\d{1,2})[.:](\d{2})/.exec(block);
    const title = /class="titel">([\s\S]*?)<\/div>/.exec(block)?.[1];
    if (!date || !title) { unreadable++; continue; }
    const [y, mo, d] = [Number(date[3]), Number(date[2]), Number(date[1])];
    const startsAt = zonedToUtc({ year: y, month: mo, day: d, hour: time ? Number(time[1]) : 0, minute: time ? Number(time[2]) : 0 }, zone);
    const status = stageText(/class="status">([\s\S]*?)<\/div>/.exec(block)?.[1] ?? "");
    const slug = /\/forestillinger\/([^/]+)/.exec(href)?.[1] ?? href;
    events.push({
      sourceEventId: `${slug}@${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${time ? `${time[1]}${time[2]}` : ""}`,
      title: stageText(title), paragraphs: [],
      startsAt, endsAt: time ? null : zonedToUtc({ year: y, month: mo, day: d, hour: 24, minute: 0 }, zone), allDay: !time, timezone: zone,
      organizerName: config.defaults.organizerName, organizerUrl: config.defaults.organizerUrl, hostName: null,
      venueName: venue?.name ?? null, address: venue?.address ?? null, postalCode: venue?.postalCode ?? null, city: venue?.city ?? null,
      lat: venue?.lat ?? null, lon: venue?.lon ?? null, locationText: venue?.name ?? null,
      categoryHints: [], price: null, signupUrl: decodeEntities(href), sourceUrl: decodeEntities(href), imageUrl: null,
      cancelled: /aflyst/i.test(status), qualityFlags: /udsolgt/i.test(status) ? ["sold_out"] : []
    });
  }
  return { events, unreadable };
}

export const filuren: SourceAdapter = {
  async fetch(config, ctx) {
    const { events, unreadable } = parseFiluren(await page(String(config.options.url), config, ctx), config);
    if (!events.length && !unreadable) throw new Error("filuren_no_calendar_found");
    return result(upcoming(events, ctx.now), unreadable);
  }
};

// ---------------------------------------------------------------------------------------------------------------
/** Teater Katapult (katapult.dk/saeson-2026/): each event as <h5>11. november 2026</h5><h4>StorySlam</h4> and a
 * "Læs mere" link. The event's page has "Spilleperiode 18. – 19. november 2026", "Tidspunkt 19:30",
 * "Spillested Teater Katapult // Black Box" and "Priser inkl. gebyr … Standard 230,-"; the coming events' pages are
 * read in the same run (a handful). */
export type KatapultItem = { date: string; title: string; url: string };

export function parseKatapultList(html: string, base: string): KatapultItem[] {
  const items: KatapultItem[] = [];
  for (const m of html.matchAll(/<h5>([\s\S]*?)<\/h5>\s*<h4>([\s\S]*?)<\/h4>\s*<\/div>\s*<a [^>]*href="([^"]+)"/g)) {
    const url = new URL(decodeEntities(m[3]!), base).toString();
    if (!items.some(i => i.url === url)) items.push({ date: stageText(m[1]!), title: stageText(m[2]!), url });
  }
  return items;
}

/** The text after a label on a Katapult event page ("Tidspunkt", "Spillested", "Spilleperiode"). */
function after(lines: string[], label: RegExp): string | null {
  const i = lines.findIndex(l => label.test(l));
  return i >= 0 ? lines[i + 1] ?? null : null;
}

export function katapultProduction(item: KatapultItem, html: string | null, fallbackYear: number): Production | null {
  const main = html ? (/<div class="container main-content"[\s\S]*/.exec(html)?.[0] ?? html) : "";
  const lines = main.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").split(/<[^>]+>/).map(l => stageText(l)).filter(Boolean);
  const run = parseDanishRange(item.date, fallbackYear);
  if (!run) return null;
  const venue = after(lines, /^spillested$/i);
  const prices = lines.slice(lines.findIndex(l => /^priser/i.test(l)) + 1).find(l => /\d+\s*,-/.test(l)) ?? null;
  const ticket = html ? /href="(https?:\/\/[^"]*billetten\.dk[^"]*)"/.exec(html)?.[1] ?? null : null;
  return {
    id: new URL(item.url).pathname.replace(/^\/|\/$/g, ""), url: item.url, title: item.title, teaser: null,
    image: html ? /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1] ?? null : null,
    start: run.start, end: run.end, time: parseCurtain(after(lines, /^tidspunkt$/i)),
    price: price(prices ? `Pris: ${prices}` : null), signupUrl: ticket ? decodeEntities(ticket) : null,
    venueName: venue ? venue.replace(/\s*\/\/\s*/g, ", ") : null
  };
}

export const katapult: SourceAdapter = {
  async fetch(config, ctx) {
    const url = String(config.options.url);
    const items = parseKatapultList(await page(url, config, ctx), url);
    if (!items.length) throw new Error("katapult_no_programme_found");
    const year = new Date(ctx.now).getUTCFullYear();
    const events: SourceEvent[] = [];
    let unreadable = 0;
    for (const item of items) {
      // "Hele året – GRATIS": installations open all year, not an evening.
      if (!/\d/.test(item.date)) continue;
      const run = parseDanishRange(item.date, year);
      if (!run) { unreadable++; continue; }
      const end = zonedToUtc({ year: run.end.y, month: run.end.m, day: run.end.d, hour: 24, minute: 0 }, config.defaults.timezone);
      if (end < ctx.now) continue;
      // Events held elsewhere (e.g. Grand Slam in Musikhuset) link off the site; they keep the list's facts.
      const own = new URL(item.url).host === new URL(url).host;
      if (own) item.url = item.url.replace(/^http:/, "https:");
      const p = katapultProduction(item, own ? await page(item.url, config, ctx) : null, year);
      if (!p) { unreadable++; continue; }
      events.push(...productionEvents(p, config));
    }
    return result(upcoming(events, ctx.now), unreadable);
  }
};

// ---------------------------------------------------------------------------------------------------------------
/** Bora Bora – dans og visuelt teater (bora-bora.dk): the front page lists the season as <article>s with the
 * production's link (…/forestillinger/wired/), picture, artist, title, "17. – 19. november 2026" and "From DKK 95 – 210".
 * The production's page has "17. - 19. november 2026, 19:30"; the coming productions' pages are read in the same run. */
export type BoraItem = { url: string; title: string; artist: string | null; date: string; price: string | null; image: string | null; label: string | null };

export function parseBoraList(html: string): BoraItem[] {
  const items: BoraItem[] = [];
  for (const m of html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/g)) {
    const block = m[1]!;
    const url = /href="(https:\/\/bora-bora\.dk\/forestillinger\/[^"]+)"/.exec(block)?.[1];
    if (!url || items.some(i => i.url === url)) continue;
    // A festival's umbrella entry spans weeks; its performances are listed one by one.
    if (/>\s*festival\s*<\/div>/i.test(block)) continue;
    const lines = block.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").split(/<[^>]+>/).map(l => stageText(l)).filter(Boolean);
    const di = lines.findIndex(l => /\d{1,2}\.\s*(?:[-–]\s*\d{1,2}\.\s*)?[a-zæøå]+\.?\s+\d{4}/i.test(l));
    if (di < 1) continue;
    items.push({
      url, title: lines[di - 1]!, artist: di >= 2 ? lines[di - 2]! : null, date: lines[di]!,
      price: lines.find(l => /dkk|kr\.|gratis/i.test(l)) ?? null,
      image: /background-image:\s*url\(([^)]+)\)/.exec(block)?.[1] ?? null,
      label: lines.find((l, i) => i > di && !/dkk|kr\.|billet/i.test(l)) ?? null
    });
  }
  return items;
}

export function boraProduction(item: BoraItem, html: string | null): Production | null {
  const lines = html ? html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").split(/<[^>]+>/).map(l => stageText(l)).filter(Boolean) : [];
  const detail = lines.find(l => /^\d{1,2}\.[^,]*\d{4},\s*\d{1,2}[:.]\d{2}$/.test(l)) ?? null;
  const run = parseDanishRange(detail ?? item.date);
  if (!run) return null;
  const teaser = html ? /<meta (?:name|property)="(?:og:)?description" content="([^"]*)"/.exec(html)?.[1] : null;
  return {
    id: new URL(item.url).pathname.replace(/^\/forestillinger\/|\/$/g, ""), url: item.url,
    title: item.artist && !/^(foredrag|dansefest)/i.test(item.title) ? `${item.title} – ${item.artist}` : item.title,
    teaser: teaser ? stageText(teaser) || null : null, image: item.image,
    start: run.start, end: run.end, time: parseCurtain(detail?.split(",").pop() ?? null), price: price(item.price),
    hints: item.label ? [item.label] : []
  };
}

export const borabora: SourceAdapter = {
  async fetch(config, ctx) {
    const items = parseBoraList(await page(String(config.options.url), config, ctx));
    if (!items.length) throw new Error("borabora_no_programme_found");
    const events: SourceEvent[] = [];
    let unreadable = 0;
    const budget = Number(config.options.maxPages ?? 20);
    let read = 0;
    for (const item of items) {
      const run = parseDanishRange(item.date);
      if (!run) { unreadable++; continue; }
      if (zonedToUtc({ year: run.end.y, month: run.end.m, day: run.end.d, hour: 24, minute: 0 }, config.defaults.timezone) < ctx.now) continue;
      const html = read < budget ? (read++, await page(item.url, config, ctx)) : null;
      const p = boraProduction(item, html);
      if (!p) { unreadable++; continue; }
      events.push(...productionEvents(p, config));
    }
    return result(upcoming(events, ctx.now), unreadable);
  }
};
