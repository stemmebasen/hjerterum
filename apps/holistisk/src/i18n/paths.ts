/** Socialklubben in English (Jake 2026-11-18): every page of the event portal also lives under /en/, with English
 * addresses for the main pages ("/en/calendar" for "/kalender"). Activity, city, organiser and event addresses keep
 * their Danish slug after /en/ ("/en/meditation", "/en/events/<slug>"). */

/** The first path segment in Danish and its English counterpart. Only whole segments are swapped. */
export const EN_SEGMENTS: Record<string, string> = {
  "kalender": "calendar",
  "i-dag": "today",
  "kort": "map",
  "kategorier": "activities",
  "arrangoerer": "organisers",
  "om": "about",
  "moed-nye-mennesker": "meet-new-people",
  "ny-i-aarhus": "new-in-aarhus",
  "ting-at-lave-i-aarhus": "things-to-do-in-aarhus",
  "gratis-og-billigt": "free-and-cheap",
  "find-en-flok": "join-a-group",
  "bliv-medlem": "membership",
  "tryghed": "safety",
  "samarbejde": "for-organisers",
  "kontakt": "contact",
  "log-ind": "log-in",
  "log-ud": "log-out",
  "kom-godt-i-gang": "get-started",
  "profil": "profile",
  "flokke": "my-groups",
  "informationsmoede": "information-meeting",
  "afmeld": "unsubscribe"
};
const DA_SEGMENTS: Record<string, string> = Object.fromEntries(Object.entries(EN_SEGMENTS).map(([da, en]) => [en, da]));

/** Paths that have no English page: files, the machine endpoints and the admin. */
const UNTRANSLATED = /^\/(assets\/|api\/|admin(\/|$)|favicon|robots\.txt|sitemap|til-dig\/)|\.(ics|xml|txt|png|jpe?g|svg|ico|css|js|webmanifest)$/;

export const EN_PREFIX = "/en";

/** "/kalender?x" -> "/en/calendar?x"; "/" -> "/en". Paths without an English page are returned unchanged. */
export function englishPath(path: string): string {
  const m = /^([^?#]*)(.*)$/.exec(path)!;
  const p = m[1]!, rest = m[2]!;
  if (!p.startsWith("/") || p.startsWith("//") || UNTRANSLATED.test(p) || p === EN_PREFIX || p.startsWith(EN_PREFIX + "/")) return path;
  if (p === "/") return EN_PREFIX + rest;
  const [, first, tail] = /^\/([^/]*)(.*)$/.exec(p)!;
  return `${EN_PREFIX}/${EN_SEGMENTS[first!] ?? first}${tail}${rest}`;
}

/** "/en/calendar" -> "/kalender" (the path the portal's routes know). Null when the path is not an English one. */
export function danishPath(path: string): string | null {
  if (path !== EN_PREFIX && !path.startsWith(EN_PREFIX + "/")) return null;
  const p = path.slice(EN_PREFIX.length) || "/";
  if (p === "/") return "/";
  const [, first, tail] = /^\/([^/]*)(.*)$/.exec(p)!;
  return `/${DA_SEGMENTS[first!] ?? first}${tail}`;
}

/** An English address written with the Danish word ("/en/kalender") has a proper English one to move to. */
export function englishCanonicalOf(path: string): string | null {
  const p = path.slice(EN_PREFIX.length);
  const first = /^\/([^/]*)/.exec(p)?.[1];
  return first && EN_SEGMENTS[first] && !DA_SEGMENTS[first] ? englishPath(p) : null;
}
