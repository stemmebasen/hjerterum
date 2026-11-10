/**
 * Socialklubben shows single events only: an evening, a day or a weekend one can join on its own. A course over
 * several weeks, a group that runs a season ("3 mdr. forløb", "gr. A, 6. år"), an education or a subscription is
 * left out. A weekly class one can drop in to is a single event each week and stays.
 *
 * The words are read carefully: "Et Kursus i Mirakler" is a book, "coachingforløb" is the teacher's bio, a lecture
 * may be about "uddannelse". So the title must say it plainly, or the description must name the length of the
 * course ("3-dages drejekursus", "8 ugers forløb", "tilmelding til hele forløbet").
 */

const NUMBER = "(?:[2-9]|[1-9]\\d+|to|tre|fire|fem|seks|syv|otte|ni|ti|tolv|two|three|four|five|six|seven|eight|nine|ten|twelve)";
const MAX_HOURS = 8 * 24;

// In the title: plainly a run, not one evening.
const TITLE: RegExp[] = [
  /forløb\b/i,
  /\b(?:hold)?opstart\b/i,
  /\babonnement\b/i,
  new RegExp(`\\b${NUMBER}\\s*(?:mdr\\.?|måneders|ugers|uger)(?![a-zæøå])`, "i"),
  /\b(?:to|tre|fire|fem|seks)(?:måneders|ugers)\b/i,
  // A school's yearly group: "gr. A, 6. år".
  /\b(?:gr\.|gruppe|hold)\s*[a-z0-9]\b.*\b\d+\.\s*år\b/i,
  /\b(?:\d+|multi)[- ]?week\b/i
];

// In the description: the length of the course is named.
const DESCRIPTION: RegExp[] = [
  new RegExp(`\\b${NUMBER}[- ]?(?:dages|ugers|måneders)\\s+\\S*(?:kursus|forløb|uddannelse|holdforløb)`, "i"),
  new RegExp(`\\b${NUMBER}[- ]?(?:ugers|måneders)\\s+\\S*retreat`, "i"),
  new RegExp(`\\b(?:kurset|forløbet|holdet|uddannelsen)\\s+(?:består af|strækker sig over|løber over|er på|varer)\\s+${NUMBER}\\s+(?:gange|mødegange|aftener|uger|måneder|moduler|weekender|lørdage|søndage|mandage|tirsdage|onsdage|torsdage|fredage)\\b`, "i"),
  new RegExp(`\\b(?:over|i alt|fordelt på)\\s+${NUMBER}\\s+(?:mødegange|kursusgange|moduler|weekender)\\b`, "i"),
  /\btilmelding(?:en)?\s+(?:er\s+)?(?:til|for)\s+(?:hele|alle)\s+(?:forløbet|kurset|holdet|gange|datoer)/i,
  /\b(?:på|hele|gennem)\s+uddannelsen\b|\ber\s+en\s+uddannelse\b/i,
  new RegExp(`\\b${NUMBER}[- ]week\\s+(?:course|program|programme|training)\\b`, "i")
];

// A class one may join once is fine however long the season.
const DROP_IN = /\bdrop[- ]?in\b|\benkelt(?:billet|gang|time)\b|\bpr\.?\s*gang\b|\bper\s+gang\b/i;

export type SeriesInput = { title: string; description: string; startsAt: number; endsAt: number | null };

/** Why an event is a longer run and not a single event, or null when it is a single event. */
export function seriesReason(e: SeriesInput): string | null {
  if (e.endsAt !== null && e.endsAt - e.startsAt > MAX_HOURS * 3600_000) return "long_duration";
  const title = e.title;
  const text = `${title}\n${e.description}`;
  if (DROP_IN.test(text)) return null;
  for (const re of TITLE) if (re.test(title)) return `title:${re.source.slice(0, 40)}`;
  for (const re of DESCRIPTION) if (re.test(e.description)) return `description:${re.source.slice(0, 40)}`;
  return null;
}

export const isSeries = (e: SeriesInput): boolean => seriesReason(e) !== null;
