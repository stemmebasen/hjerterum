/** Where a gathered flock is suggested to meet: always outdoors, in front of or at a landmark everybody can find,
 * never inside a café or a building (Jake 2026-11-11). The nearest point to the venue wins; when no point is close
 * enough, the flock meets in front of the venue itself, and the chat can always settle on something else. */

export type MeetingPoint = {
  /** As it reads after "I mødes …", e.g. "foran Domkirken". Starts in lower case. */
  place: string;
  lat: number;
  lon: number;
  /** Lower-case words in a venue name that place the venue here when the event has no coordinates. */
  venues?: string[];
};

/** Aarhus. Coordinates are the spot to stand, not the building's centre. */
export const MEETING_POINTS: MeetingPoint[] = [
  { place: "foran Domkirken", lat: 56.1566, lon: 10.2104, venues: ["domkirke"] },
  { place: "på Lille Torv", lat: 56.1581, lon: 10.2086 },
  { place: "ved Klostertorvet", lat: 56.1592, lon: 10.2062, venues: ["vor frue kirke"] },
  { place: "foran Føtex i Guldsmedgade", lat: 56.1587, lon: 10.2095 },
  { place: "foran Aarhus Teater på Bispetorv", lat: 56.1571, lon: 10.2122, venues: ["aarhus teater"] },
  { place: "foran Magasin ved Immervad", lat: 56.1556, lon: 10.2090 },
  { place: "foran Salling på Søndergade", lat: 56.1554, lon: 10.2068 },
  { place: "på Hack Kampmanns Plads foran Dokk1", lat: 56.1530, lon: 10.2130, venues: ["dokk1"] },
  { place: "foran Rådhuset på Rådhuspladsen", lat: 56.1525, lon: 10.2035, venues: ["rådhus"] },
  { place: "foran Hovedbanegården", lat: 56.1504, lon: 10.2047 },
  { place: "foran Bruuns Galleri", lat: 56.1490, lon: 10.2043, venues: ["bruuns galleri"] },
  { place: "på Ingerslevs Plads", lat: 56.1466, lon: 10.2063, venues: ["frederiksbjerg"] },
  { place: "foran Musikhuset", lat: 56.1535, lon: 10.1990, venues: ["musikhuset", "musikhus"] },
  { place: "foran ARoS", lat: 56.1540, lon: 10.2000, venues: ["aros"] },
  { place: "foran Godsbanen", lat: 56.1541, lon: 10.1955, venues: ["godsbanen", "radar", "folkestedet", "voxhall", "katapult"] },
  { place: "foran indgangen til Den Gamle By", lat: 56.1584, lon: 10.1925, venues: ["den gamle by"] },
  { place: "ved Nørreport", lat: 56.1617, lon: 10.2084 },
  { place: "foran Stakladen i Universitetsparken", lat: 56.1667, lon: 10.2043, venues: ["stakladen", "studenterhus", "naturhistorisk", "universitet"] }
];

/** Farther than this from every point, the flock meets in front of the venue instead. */
export const MAX_DISTANCE_M = 800;

/** Metres between two points (equirectangular; plenty for a city). */
export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

/** The point nearest the venue, or one the venue's name gives away, or null. */
export function nearestMeetingPoint(e: { lat: number | null; lon: number | null; venue_name: string | null }): MeetingPoint | null {
  if (e.lat != null && e.lon != null) {
    let best: MeetingPoint | null = null;
    let bestD = MAX_DISTANCE_M;
    for (const p of MEETING_POINTS) {
      const d = distanceM({ lat: e.lat, lon: e.lon }, p);
      if (d <= bestD) { best = p; bestD = d; }
    }
    return best;
  }
  const name = (e.venue_name ?? "").toLowerCase();
  if (!name) return null;
  return MEETING_POINTS.find(p => p.venues?.some(v => name.includes(v))) ?? null;
}

/** The suggested meeting place as stored on the flock, e.g. "Foran Domkirken". */
export function suggestedMeetingPlace(e: { lat: number | null; lon: number | null; venue_name: string | null }): string {
  const p = nearestMeetingPoint(e);
  if (p) return p.place.charAt(0).toUpperCase() + p.place.slice(1);
  const venue = e.venue_name?.split(",")[0]?.trim();
  return venue ? `Foran indgangen til ${venue}` : "Aftales i chatten";
}

/** The point a stored meeting place names, for a precise map link. */
export function meetingPointByPlace(place: string): MeetingPoint | null {
  const p = place.trim().toLowerCase();
  return MEETING_POINTS.find(m => m.place.toLowerCase() === p) ?? null;
}
