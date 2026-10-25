import type { VenueRule } from "./sources/types.js";

/** Coordinates for events whose source gives an address but no position, so they can be shown on the map.
 * First the source's own venues (registry.ts), then well-known addresses in Aarhus. The coordinates are the address
 * points in OpenStreetMap (© OpenStreetMap contributors, ODbL), looked up once by hand. */

type Place = { address: RegExp; lat: number; lon: number };

const AARHUS: Place[] = [
  { address: /^hack kampmanns plads 2(?!\d)/, lat: 56.153436, lon: 10.213776 }, // Dokk1
  { address: /^kalkværksvej 13(?!\d)/, lat: 56.149355, lon: 10.211238 }, // Train, TRACK
  { address: /^kalkværksvej 25(?!\d)/, lat: 56.149257, lon: 10.210124 }, // Porter's
  { address: /^kystpromenaden 2(?!\d)/, lat: 56.163204, lon: 10.218896 }, // VinDanmark
  { address: /^valdemarsgade 1(?!\d)/, lat: 56.151826, lon: 10.199036 }, // HeadQuarters
  { address: /^sankt lucas kirkeplads 1(?!\d)/, lat: 56.144757, lon: 10.193743 }, // Skt. Lukas Kirke
  { address: /^mejlgade 53(?!\d)/, lat: 56.159936, lon: 10.212867 }, // Phono
  { address: /^karen wegeners gade 6(?!\d)/, lat: 56.153242, lon: 10.194083 }, // Radar
  { address: /^ankersgade 21(?!\d)/, lat: 56.1478, lon: 10.190332 } // Folkehuset Ankersgade
];

const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export function coordinatesFor(
  e: { venueName: string | null; address: string | null; postalCode: string | null; city: string | null; locationText: string | null },
  venues: VenueRule[]
): { lat: number; lon: number } | null {
  const address = norm(e.address);
  const inAarhus = (e.postalCode ?? "").startsWith("8") || /aarhus/i.test(e.city ?? "");
  const place = inAarhus && address ? AARHUS.find(p => p.address.test(address)) : undefined;
  if (place) return { lat: place.lat, lon: place.lon };
  // A source's venue, unless the event names another address (VoxHall's concerts at Radar are not at VoxHall).
  const text = [e.venueName, e.address, e.locationText].filter(Boolean).join(", ");
  const venue = text ? venues.find(v => v.lat !== null && v.lon !== null && v.match.test(text) && (!address || !v.address || address.startsWith(norm(v.address).split(",")[0]!))) : undefined;
  return venue?.lat != null && venue.lon != null ? { lat: venue.lat, lon: venue.lon } : null;
}
