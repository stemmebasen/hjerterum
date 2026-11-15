import { ORGANIZERS, type OrganizerProfile } from "../organizers.js";
import { html, raw, type SafeHtml } from "./html.js";
import type { EventRow } from "./queries.js";

/** "Om stedet" on an event page (Jake 2026-11-15): a small section about the place the event is held – its name, the
 * portal's own short description when the place has a profile in the directory, the address, a little map and the
 * ways to get there. The place is found from the event's own venue and address, never from the organiser alone
 * (VoxHall's concerts at Radar are at Radar). Sources give no pictures of the places, so there is none. */

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9æøåéü' ]+/g, " ").replace(/\s+/g, " ").trim();
/** "Hack Kampmanns Plads 2, 1. sal" → "hack kampmanns plads 2" */
const street = (s: string | null | undefined) => norm((s ?? "").split(",")[0]);

type Venue = Pick<EventRow, "venue_name" | "address" | "postal_code" | "city">;

/** The directory profile of the place an event is held, if it has one. */
export function venueProfile(e: Venue): OrganizerProfile | undefined {
  const name = norm(e.venue_name);
  const addr = street(e.address);
  return ORGANIZERS.find(p => {
    const pname = norm(p.name);
    if (name && pname && (name === pname || name.startsWith(pname + " ") || pname.startsWith(name + " "))) {
      // Same name, and no address that says otherwise.
      return !addr || !p.address || street(p.address) === addr;
    }
    return !!addr && !!p.address && street(p.address) === addr && (!e.postal_code || !p.postalCode || e.postal_code === p.postalCode);
  });
}

// ——— The little map: OpenStreetMap tiles drawn in an SVG, so it needs no script and no inline style (the CSP forbids both).

const ZOOM = 16;
const W = 560;
const H = 240;

function worldPixel(lat: number, lon: number): { x: number; y: number } {
  const scale = 256 * 2 ** ZOOM;
  const r = (lat * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * scale, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * scale };
}

export function miniMap(lat: number, lon: number, label: string): SafeHtml {
  const p = worldPixel(lat, lon);
  // The pin's tip sits a little below the middle, so the pin itself is centred.
  const left = p.x - W / 2;
  const top = p.y - H / 2 - 18;
  const tiles: SafeHtml[] = [];
  for (let tx = Math.floor(left / 256); tx <= Math.floor((left + W) / 256); tx++) {
    for (let ty = Math.floor(top / 256); ty <= Math.floor((top + H) / 256); ty++) {
      tiles.push(html`<image href="https://tile.openstreetmap.org/${ZOOM}/${tx}/${ty}.png" x="${Math.round(tx * 256 - left)}" y="${Math.round(ty * 256 - top)}" width="256" height="256"/>`);
    }
  }
  const px = Math.round(p.x - left);
  const py = Math.round(p.y - top);
  return html`<svg class="venue-map-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${`Kort over ${label}`}">
    <g class="venue-map-tiles">${tiles}</g>
    <g class="venue-map-pin" transform="translate(${px} ${py})">
      <ellipse cx="0" cy="0" rx="9" ry="3.5" class="venue-map-shadow"/>
      ${raw(`<path d="M0 0C-4-11-16-19-16-31a16 16 0 0 1 32 0c0 12-12 20-16 31z"/>`)}
      <circle cx="0" cy="-31" r="6.5" class="venue-map-dot"/>
    </g>
  </svg>`;
}

/** The section, or nothing when the event names no place. */
export function venueSection(e: EventRow, over: boolean): SafeHtml {
  const profile = venueProfile(e);
  const name = e.venue_name ?? profile?.name ?? null;
  if (!name && !e.address) return html``;
  const addressLine = [e.address ?? profile?.address, [e.postal_code ?? profile?.postalCode, e.city ?? profile?.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const hasPoint = e.lat !== null && e.lon !== null;
  const destination = hasPoint ? `${e.lat},${e.lon}` : [name, addressLine].filter(Boolean).join(", ");
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
  const osm = hasPoint ? `https://www.openstreetmap.org/?mlat=${e.lat}&mlon=${e.lon}#map=17/${e.lat}/${e.lon}` : null;
  const mapHref = hasPoint && !over ? `/kort?event=${e.slug}` : osm;
  const links: SafeHtml[] = [
    html`<a href="${directions}" rel="noopener" target="_blank">Find vej<span class="visually-hidden"> (åbner i nyt vindue)</span></a>`,
    ...(hasPoint && !over ? [html`<a href="/kort?event=${e.slug}">Se hvad der ellers sker i nærheden</a>`] : []),
    ...(profile ? [html`<a href="/arrangoerer/${profile.slug}">Flere arrangementer her</a>`, html`<a href="${profile.website}" rel="noopener">Stedets hjemmeside</a>`] : [])
  ];
  return html`<section class="venue" id="stedet" aria-labelledby="h-venue">
  <div class="venue-text">
    <p class="kicker">Om stedet</p>
    <h2 id="h-venue">${name ?? addressLine}</h2>
    ${profile ? html`<p class="venue-about">${profile.about}</p>` : ""}
    ${name && addressLine ? html`<p class="venue-address">${addressLine}</p>` : ""}
    <ul class="venue-links">${links.map(l => html`<li>${l}</li>`)}</ul>
  </div>
  ${hasPoint ? html`<figure class="venue-map">
    ${mapHref ? html`<a href="${mapHref}"${mapHref.startsWith("http") ? raw(' rel="noopener"') : ""}>${miniMap(e.lat!, e.lon!, name ?? addressLine)}</a>` : miniMap(e.lat!, e.lon!, name ?? addressLine)}
    <figcaption>© <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap</a></figcaption>
  </figure>` : ""}
</section>`;
}
