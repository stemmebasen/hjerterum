import { categoryName } from "../categories.js";
import { isoWithOffset } from "../time.js";
import { escapeHtml } from "./html.js";
import type { EventRow } from "./queries.js";
import { eventPath } from "./components.js";

/** schema.org Event for an event page (https://schema.org/Event, as search engines read it). */
export function eventJsonLd(e: EventRow, origin: string): Record<string, unknown> {
  const status = e.status === "cancelled" ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled";
  const offers = e.signup_url && (e.price_min_minor !== null || e.is_free === 1) ? {
    "@type": "Offer",
    url: e.signup_url,
    price: e.is_free === 1 ? 0 : (e.price_min_minor ?? 0) / 100,
    priceCurrency: e.price_currency ?? "DKK",
    availability: "https://schema.org/InStock"
  } : undefined;
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: e.title,
    startDate: e.all_day ? isoWithOffset(e.starts_at, e.timezone).slice(0, 10) : isoWithOffset(e.starts_at, e.timezone),
    ...(e.ends_at ? { endDate: e.all_day ? isoWithOffset(e.ends_at - 1, e.timezone).slice(0, 10) : isoWithOffset(e.ends_at, e.timezone) } : {}),
    eventStatus: status,
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    url: origin + eventPath(e),
    ...(e.summary ? { description: e.summary } : {}),
    ...(e.image_url ? { image: [e.image_url] } : {}),
    location: {
      "@type": "Place",
      name: e.venue_name ?? e.city ?? "Se arrangørens side",
      address: {
        "@type": "PostalAddress",
        ...(e.address ? { streetAddress: e.address } : {}),
        ...(e.postal_code ? { postalCode: e.postal_code } : {}),
        ...(e.city ? { addressLocality: e.city } : {}),
        addressCountry: "DK"
      },
      ...(e.lat !== null && e.lon !== null ? { geo: { "@type": "GeoCoordinates", latitude: e.lat, longitude: e.lon } } : {})
    },
    ...(e.organizer_name ? { organizer: { "@type": "Organization", name: e.organizer_name, ...(e.organizer_url ? { url: e.organizer_url } : {}) } } : {}),
    ...(e.host_name ? { performer: { "@type": "Person", name: e.host_name } } : {}),
    ...(offers ? { offers } : {}),
    ...(e.categories ? { keywords: e.categories.split(",").map(categoryName).join(", ") } : {})
  };
}

export function sitemapXml(origin: string, pages: string[], events: Array<{ slug: string; updated_at: number }>): string {
  const urls: Array<{ loc: string; lastmod?: string }> = [
    ...pages.map(p => ({ loc: origin + p })),
    ...events.map(e => ({ loc: `${origin}${eventPath(e)}`, lastmod: new Date(e.updated_at).toISOString().slice(0, 10) }))
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(u => `  <url><loc>${escapeHtml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`;
}

/** Only production may be indexed; staging and local answer "stay away". */
export function robotsTxt(origin: string, production: boolean): string {
  return production ? `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n` : "User-agent: *\nDisallow: /\n";
}

const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsUtc = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsDate = (ms: number, tz: string) => isoWithOffset(ms, tz).slice(0, 10).replace(/-/g, "");

/** A single event as an .ics file, for "Tilføj til kalender". Lines are folded at 75 octets as RFC 5545 asks. */
export function eventIcs(e: EventRow, origin: string, now: number): string {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Flokken//eventportal//DA", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.id}@holistisk.org`,
    `DTSTAMP:${icsUtc(now)}`,
    ...(e.all_day ? [`DTSTART;VALUE=DATE:${icsDate(e.starts_at, e.timezone)}`, ...(e.ends_at ? [`DTEND;VALUE=DATE:${icsDate(e.ends_at, e.timezone)}`] : [])]
      : [`DTSTART:${icsUtc(e.starts_at)}`, `DTEND:${icsUtc(e.ends_at ?? e.starts_at + 3600_000)}`]),
    `SUMMARY:${icsText(e.title)}`,
    ...(e.venue_name || e.address || e.city ? [`LOCATION:${icsText([e.venue_name, e.address, [e.postal_code, e.city].filter(Boolean).join(" ")].filter(Boolean).join(", "))}`] : []),
    `DESCRIPTION:${icsText(`${e.summary ?? ""}\n\nTilmelding hos arrangøren: ${e.signup_url ?? e.source_url ?? ""}\nMere: ${origin}${eventPath(e)}`.trim())}`,
    `URL:${origin}${eventPath(e)}`,
    ...(e.status === "cancelled" ? ["STATUS:CANCELLED"] : []),
    "END:VEVENT", "END:VCALENDAR"
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = "", size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) { out.push(current); current = ""; size = 0; }
    current += ch; size += n;
  }
  out.push(current);
  return out.join("\r\n ");
}
