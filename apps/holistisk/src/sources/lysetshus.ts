import { collapse, findHost, htmlToParagraphs } from "../text.js";
import { localDate, wallClock, weekdayIndex, zonedToUtc } from "../time.js";
import { decodeBody } from "./http.js";
import type { AdapterContext, FetchResult, SourceAdapter, SourceConfig, SourceEvent } from "./types.js";

/** Lysets Hus (Foreningen Lyset, Posthussmøgen 11C, Aarhus) publishes its programme as text on its front page:
 *
 *   Onsdag 14.10 kl. 19.00. Entrepris 150,- kr.
 *   Karlinna J. V. Frederiksen                         <- speaker
 *   Foredrag: Håndlæsning – Kiromantien som …          <- title
 *   …description…  Link til billet: https://billetto.dk/e/…-1933517
 *   Lige uge - Healings meditation                     <- the free early evening on that same Wednesday
 *   Healings meditation fra 17.30-18.30.
 *
 * Dates carry no year: the year is the one that puts the date nearest ahead and makes the weekday match; a date whose
 * weekday matches no year near now is skipped rather than guessed. A free evening ("Ulige/Lige uge") is only taken
 * when it follows a dated evening and the week number's parity agrees. Options: url (default the front page). */

const WEEKDAYS = ["mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "søndag"];
const DATE_LINE = /^(mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)\s+(\d{1,2})\.(\d{1,2})\.?\s*kl\.?\s*(\d{1,2})(?:[.:](\d{2}))?(?:\s*[-–]\s*(\d{1,2})[.:](\d{2}))?\.?\s*(.*)$/i;
const FREE_LINE = /^(ulige|lige)\s+uge\s*[-–:]\s*(.+)$/i;
const TIME_RANGE = /(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})/;
const TICKET = /https:\/\/billetto\.dk\/e\/[a-z0-9-]+-(\d+)/i;

type Dated = { date: string; hour: number; minute: number; endHour: number | null; endMinute: number | null; rest: string; lines: string[] };

/** The year that makes "weekday d.m" true, looking from two months back to ten months ahead. */
export function resolveDate(weekday: string, day: number, month: number, now: number): string | null {
  const year = wallClock(now).year;
  const earliest = localDate(now - 60 * 86400_000), latest = localDate(now + 300 * 86400_000);
  for (const y of [year - 1, year, year + 1]) {
    const date = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const check = new Date(Date.UTC(y, month - 1, day));
    if (check.getUTCMonth() !== month - 1) continue;
    if (date < earliest || date > latest) continue;
    if (WEEKDAYS[weekdayIndex(date)] === weekday.toLowerCase()) return date;
  }
  return null;
}

/** ISO week number of a local date. */
export function isoWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7));
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

const at = (date: string, hour: number, minute: number, zone: string) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return zonedToUtc({ year: y, month: m, day: d, hour, minute }, zone);
};

function price(text: string): { minMinor: number; maxMinor: number; isFree: boolean; text: string } | null {
  const amount = /entr[ée]pris\s*:?\s*(\d+)/i.exec(text);
  if (amount) return { minMinor: Number(amount[1]) * 100, maxMinor: Number(amount[1]) * 100, isFree: false, text: collapse(text).replace(/\.$/, "") };
  if (/gratis|fri entr/i.test(text)) return { minMinor: 0, maxMinor: 0, isFree: true, text: "Gratis" };
  return null;
}

export function parseProgramme(html: string, config: SourceConfig, now: number): { events: SourceEvent[]; unreadable: number } {
  const zone = config.defaults.timezone;
  const venue = config.defaults.venues[0] ?? null;
  const lines = htmlToParagraphs(html, 2000);
  const events: SourceEvent[] = [];
  let unreadable = 0;
  let current: Dated | null = null;
  let free: { parity: string; title: string; lines: string[]; date: string } | null = null;

  const base = (): Omit<SourceEvent, "sourceEventId" | "title" | "paragraphs" | "startsAt" | "endsAt" | "hostName" | "price" | "signupUrl" | "categoryHints"> => ({
    allDay: false, timezone: zone,
    organizerName: config.defaults.organizerName, organizerUrl: config.defaults.organizerUrl,
    venueName: venue?.name ?? null, address: venue?.address ?? null, postalCode: venue?.postalCode ?? null, city: venue?.city ?? null,
    lat: venue?.lat ?? null, lon: venue?.lon ?? null, locationText: venue?.name ?? null,
    sourceUrl: config.homepageUrl, imageUrl: null, cancelled: false, qualityFlags: []
  });

  const flushDated = () => {
    if (!current) return;
    const [speakerLine, titleLine, ...description] = current.lines;
    const ticket = current.lines.map(l => TICKET.exec(l)).find(Boolean);
    const speaker = speakerLine ? collapse(speakerLine).replace(/[.,]+$/, "") : null;
    let title = titleLine ? collapse(titleLine).replace(/[.]+$/, "") : null;
    if (!speaker || !title) { unreadable++; current = null; return; }
    // "Klarsyn" alone says little: the speaker belongs in the title. "Foredrag: X" keeps its own words.
    if (title.length < 30 && !title.toLowerCase().includes(speaker.toLowerCase().split(" ")[0]!)) title = `${title} med ${speaker}`;
    const paragraphs = description.filter(l => !TICKET.test(l) && !/^(link til|billetbestilling|www\.)/i.test(l));
    const start = at(current.date, current.hour, current.minute, zone);
    const end = current.endHour !== null ? at(current.date, current.endHour, current.endMinute ?? 0, zone) : null;
    events.push({
      ...base(),
      sourceEventId: ticket ? `billetto-${ticket[1]}` : `${current.date}-${title.toLowerCase().replace(/[^a-z0-9æøå]+/g, "-").slice(0, 60)}`,
      title,
      paragraphs,
      startsAt: start,
      endsAt: end !== null && end > start ? end : null,
      hostName: speaker,
      price: (() => { const p = price(current.rest); return p ? { ...p, currency: "DKK" } : null; })(),
      signupUrl: ticket ? ticket[0] : config.homepageUrl,
      categoryHints: ["Foredrag", "Spiritualitet"],
      qualityFlags: end === null ? ["no_end_time"] : []
    });
    current = null;
  };

  const flushFree = () => {
    if (!free) return;
    const block = free.lines.join(" ");
    const range = TIME_RANGE.exec(block);
    const week = isoWeek(free.date);
    const parityOk = (free.parity.toLowerCase() === "lige") === (week % 2 === 0);
    if (!range || !parityOk) { unreadable++; free = null; return; }
    const host = free.lines.map(l => /\bmed\s+([A-ZÆØÅ][a-zæøåA-ZÆØÅ-]+(?:\s+[A-ZÆØÅ][a-zæøåA-ZÆØÅ-]+){0,3})/.exec(l)?.[1]).find(Boolean) ?? findHost(free.lines);
    const title = collapse(free.title);
    events.push({
      ...base(),
      sourceEventId: `${free.date}-${title.toLowerCase().replace(/[^a-z0-9æøå]+/g, "-").slice(0, 60)}`,
      title: /gratis/i.test(title) ? title : `Gratis ${title.charAt(0).toLowerCase()}${title.slice(1)}`,
      paragraphs: free.lines.filter(l => !/^klik her|^mere info/i.test(l)),
      startsAt: at(free.date, Number(range[1]), Number(range[2]), zone),
      endsAt: at(free.date, Number(range[3]), Number(range[4]), zone),
      hostName: host ? host.replace(/[.,]+$/, "") : null,
      price: { minMinor: 0, maxMinor: 0, isFree: true, text: "Gratis", currency: "DKK" },
      signupUrl: config.homepageUrl,
      categoryHints: [title]
    });
    free = null;
  };

  let lastDate: string | null = null;
  for (const line of lines) {
    const d = DATE_LINE.exec(line);
    if (d) {
      flushDated(); flushFree();
      const date = resolveDate(d[1]!, Number(d[2]), Number(d[3]), now);
      if (!date) { unreadable++; lastDate = null; continue; }
      lastDate = date;
      current = { date, hour: Number(d[4]), minute: Number(d[5] ?? 0), endHour: d[6] ? Number(d[6]) : null, endMinute: d[7] ? Number(d[7]) : null, rest: d[8] ?? "", lines: [] };
      continue;
    }
    const f = FREE_LINE.exec(line);
    if (f) {
      flushDated(); flushFree();
      if (lastDate) free = { parity: f[1]!, title: f[2]!, lines: [], date: lastDate };
      continue;
    }
    // A block ends at the next dated line; the caps keep the page's footer out of the last one.
    if (current) { if (current.lines.length < 30) current.lines.push(line); }
    else if (free) { if (free.lines.length < 6) free.lines.push(line); }
  }
  flushDated(); flushFree();
  return { events, unreadable };
}

export const lysetsHus: SourceAdapter = {
  async fetch(config: SourceConfig, ctx: AdapterContext): Promise<FetchResult> {
    const url = typeof config.options.url === "string" ? config.options.url : config.homepageUrl ?? "";
    if (!/^https:\/\//.test(url)) throw new Error("lysetshus_url_missing");
    const res = await ctx.http.get(url, { headers: { accept: "text/html" }, respectRobots: config.respectRobots });
    const { events, unreadable } = parseProgramme(decodeBody(res.body, res.headers.get("content-type")), config, ctx.now);
    if (!events.length) throw new Error("lysetshus_no_programme_found");
    const upcoming = events.filter(e => (e.endsAt ?? e.startsAt) >= ctx.now - 24 * 3600_000);
    return { events: upcoming, windowEnd: Math.max(...events.map(e => e.startsAt)), unreadable };
  }
};
