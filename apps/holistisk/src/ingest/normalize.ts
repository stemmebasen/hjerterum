import { classify, isHolisticRelevant } from "../categories.js";
import { placeEvent, regionForText, type Area } from "../geo.js";
import { localDate } from "../time.js";
import { collapse, normalizeTitle, searchText, sha256Hex, slugify, summarize } from "../text.js";
import type { SourceConfig, SourceEvent } from "../sources/types.js";
import { categoryName } from "../categories.js";
import { classifyTopics } from "../activities.js";
import { coordinatesFor } from "../places.js";

/** An event as the portal stores it (the events table), plus its categories. */
export type EventRecord = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  summary: string | null;
  starts_at: number;
  ends_at: number | null;
  all_day: number;
  timezone: string;
  organizer_id: string | null;
  organizer_name: string | null;
  organizer_url: string | null;
  host_name: string | null;
  venue_name: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  area: string | null;
  region: string | null;
  lat: number | null;
  lon: number | null;
  price_min_minor: number | null;
  price_max_minor: number | null;
  price_currency: string | null;
  price_text: string | null;
  is_free: number | null;
  signup_url: string | null;
  image_url: string | null;
  image_credit: string | null;
  primary_source_id: string;
  source_url: string | null;
  status: "scheduled" | "cancelled";
  fingerprint: string;
  search_text: string;
  quality_flags: string;
  categories: string[];
  topics: string[];
};

export type Normalized = { ok: true; record: EventRecord } | { ok: false; reason: string };

/** Raised when the way events are read or categorised changes, so every stored event is processed again once. */
export const NORMALIZE_VERSION = 7;

/** The fields that decide whether a source's record changed (before any enrichment). */
export async function contentHash(e: SourceEvent): Promise<string> {
  return sha256Hex(JSON.stringify([NORMALIZE_VERSION,
    e.title, e.paragraphs, e.startsAt, e.endsAt, e.allDay, e.timezone, e.organizerName, e.hostName, e.venueName, e.address, e.postalCode,
    e.city, e.lat, e.lon, e.locationText, e.categoryHints, e.price, e.signupUrl, e.sourceUrl, e.imageUrl, e.cancelled
  ]));
}

/** The portal's id for an event is fixed by the first source record it was seen in. */
export async function eventIdFor(sourceId: string, sourceEventId: string): Promise<string> {
  return "e" + (await sha256Hex(`${sourceId}:${sourceEventId}`)).slice(0, 15);
}

/** A source's links to an address that has moved (options.rewriteHosts: { "holistisk.org": "hjerterum.info" }). */
export function rewriteHosts(text: string, config: SourceConfig): string {
  const map = config.options.rewriteHosts;
  if (!map || typeof map !== "object") return text;
  let out = text;
  for (const [from, to] of Object.entries(map as Record<string, string>)) {
    const host = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`https?://(?:www\\.)?${host}(?=[/?#\\s]|$)`, "gi"), `https://${to}`);
  }
  return out;
}

const httpUrl = (value: string | null): string | null => {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch { return null; }
};

export async function normalize(e: SourceEvent, config: SourceConfig): Promise<Normalized> {
  const title = collapse(e.title).slice(0, 200);
  if (!title) return { ok: false, reason: "no_title" };
  if (!Number.isFinite(e.startsAt)) return { ok: false, reason: "no_start" };
  const description = e.paragraphs.join("\n");
  if (config.requireRelevance && !isHolisticRelevant(`${title} ${description} ${e.categoryHints.join(" ")}`)) return { ok: false, reason: "not_holistic" };

  const area: Area | null = placeEvent({ postalCode: e.postalCode, city: e.city, freeText: [e.locationText, e.venueName].filter(Boolean).join(" ") });
  // Only a region named ("Østjylland"): listed in the region, not in any town.
  const regionOnly = area ? null : regionForText([e.locationText, e.venueName, e.city].filter(Boolean).join(" "));
  // A source may correct the word-based categories: some it never has (Raja Yoga is meditation, not yoga), some it
  // always has when the words find none (a temple's English titles), topics it always concerns.
  const opt = config.options;
  const list = (v: unknown) => Array.isArray(v) ? v.map(String) : [];
  let categories = (opt.descriptionIsSummary
    ? classify({ title, summary: description, hints: e.categoryHints })
    : classify({ title, description, hints: e.categoryHints })).filter(c => !list(opt.excludeCategories).includes(c));
  // A source's own genre names that map straight to a category (Musikhuset's "comedy" -> scenekunst) come first.
  const hintMap = opt.hintCategories && typeof opt.hintCategories === "object" ? opt.hintCategories as Record<string, string> : {};
  const fromHints = e.categoryHints.map(h => hintMap[h.toLowerCase()]).filter((c): c is string => !!c);
  if (fromHints.length) categories = [...new Set([...fromHints, ...categories])].slice(0, 3);
  if (!categories.length) categories = list(opt.defaultCategories);
  // A venue that is one kind of place (a concert venue) always gives its events that category, first.
  if (list(opt.alwaysCategories).length) categories = [...new Set([...list(opt.alwaysCategories), ...categories])].slice(0, 3);
  const topics = [...new Set([...classifyTopics({ title, description }), ...list(opt.alwaysTopics)])];
  const flags = new Set(e.qualityFlags);
  if (!area) flags.add(regionOnly ? "region_only" : "area_unknown");
  if (!categories.length) flags.add("uncategorized");
  if (e.endsAt === null) flags.add("no_end_time");
  // A position for the map: the source's own, else its venue's or a known address's.
  const position = e.lat !== null && e.lon !== null ? { lat: e.lat, lon: e.lon } : coordinatesFor(e, config.defaults.venues);
  if (!position) flags.add("no_coordinates");
  if (!e.price) flags.add("price_unknown");

  const id = await eventIdFor(config.id, e.sourceEventId);
  const paragraphs = config.descriptionPolicy === "none" ? [] : e.paragraphs.slice(0, 80).map(p => rewriteHosts(p, config));
  const stored = config.descriptionPolicy === "full" ? paragraphs.join("\n\n").slice(0, 12_000) : null;
  const summary = summarize(paragraphs);
  const organizerName = e.organizerName ? collapse(e.organizerName).slice(0, 120) : null;
  const image = config.imagePolicy === "allowed" ? httpUrl(e.imageUrl) : null;

  return {
    ok: true,
    record: {
      id,
      slug: `${slugify(title, 60)}-${id.slice(1, 7)}`,
      title,
      description: stored ?? (config.descriptionPolicy === "excerpt" ? summary : null),
      summary,
      starts_at: e.startsAt,
      ends_at: e.endsAt,
      all_day: e.allDay ? 1 : 0,
      timezone: e.timezone,
      organizer_id: organizerName ? slugify(organizerName, 60) : null,
      organizer_name: organizerName,
      organizer_url: httpUrl(e.organizerUrl),
      host_name: e.hostName ? collapse(e.hostName).slice(0, 120) : null,
      venue_name: e.venueName ? collapse(e.venueName).slice(0, 160) : null,
      address: e.address ? collapse(e.address).slice(0, 200) : null,
      postal_code: e.postalCode,
      city: e.city ? collapse(e.city).slice(0, 80) : null,
      area: area?.slug ?? null,
      region: area?.region ?? regionOnly?.slug ?? null,
      lat: position?.lat ?? null,
      lon: position?.lon ?? null,
      price_min_minor: e.price?.minMinor ?? null,
      price_max_minor: e.price?.maxMinor ?? null,
      price_currency: e.price ? e.price.currency : null,
      price_text: e.price?.text ?? null,
      is_free: e.price?.isFree === undefined || e.price?.isFree === null ? null : e.price.isFree ? 1 : 0,
      signup_url: httpUrl(e.signupUrl),
      image_url: image,
      image_credit: image ? config.attribution : null,
      primary_source_id: config.id,
      source_url: httpUrl(e.sourceUrl),
      status: e.cancelled ? "cancelled" : "scheduled",
      fingerprint: `${normalizeTitle(title)}|${localDate(e.startsAt, e.timezone)}`,
      search_text: searchText(title, e.hostName, organizerName, e.venueName, e.city, area?.name, categories.map(categoryName).join(" "), description.slice(0, 3000)),
      quality_flags: JSON.stringify([...flags].sort()),
      categories,
      topics
    }
  };
}
