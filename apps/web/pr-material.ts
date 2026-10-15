/** Requested (Gitta, via the chair): PR material on each teacher's own page - at least three photos, their consent and three one-line quotes.
 * "Vi går måske glip af nogle bookinger hvis det er et krav, så måske vi må nøjes med en kraftig opfordring? Måske gøre det helt klart at vi ikke
 * kan reklamere for dem uden?" - so nothing here is required; the page says plainly what it takes for Hjerterum to promote them. */

/** Gitta's words, as the teacher ticks them. */
export const PR_CONSENT_TEXT = "Må bruges til mit nuværende og mine fremtidige events, samt til grupperede opslag hvor mit event er iblandt - fx opslag for de næste to ugers dans, healing, yoga og lignende events - indtil jeg trækker mit samtykke tilbage.";
export const PR_MIN_PHOTOS = 3;
export const PR_MAX_PHOTOS = 10;
/** Big enough for a post on Instagram or Facebook. */
export const PR_MIN_SIDE = 1080;
export const PR_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

export type PrQuotes = { facilitator: string; offering: string; participant: string; participantName: string };
export type PrPhoto = { id: string; url: string; width: number | null; height: number | null };
export type PrMaterial = { photos: PrPhoto[]; quotes: PrQuotes; consentAt: number | null; withdrawnAt: number | null };

export const EMPTY_QUOTES: PrQuotes = { facilitator: "", offering: "", participant: "", participantName: "" };
const LIMITS: Record<keyof PrQuotes, number> = { facilitator: 200, offering: 200, participant: 200, participantName: 80 };

export function parsePrQuotes(input: unknown): PrQuotes {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_quotes");
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some(key => !(key in LIMITS))) throw new Error("invalid_quotes");
  const out = { ...EMPTY_QUOTES };
  for (const [key, limit] of Object.entries(LIMITS) as Array<[keyof PrQuotes, number]>) {
    const value = data[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length > limit) throw new Error("invalid_quotes");
    out[key] = value.replace(/\s+/g, " ").trim();
  }
  return out;
}

/** Whether Hjerterum may promote them: consent given (and not withdrawn) and at least three photos. */
export const readyForPr = (m: Pick<PrMaterial, "photos" | "consentAt">) => Boolean(m.consentAt) && m.photos.length >= PR_MIN_PHOTOS;
