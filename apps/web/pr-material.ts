/** Requested (Gitta, via the chair): PR material on each teacher's own page - at least three photos, their consent and three one-line quotes.
 * "Vi går måske glip af nogle bookinger hvis det er et krav, så måske vi må nøjes med en kraftig opfordring? Måske gøre det helt klart at vi ikke
 * kan reklamere for dem uden?" - so nothing here is required; the page says plainly what it takes for Hjerterum to promote them. */

/** The words the teacher ticks. Gitta (3 Nov 2026): the content is right, but it should be simpler and shorter, and still cover future events and grouped
 * posts - the chair chose this wording ("A: Med steder"). It covers what the first wording did, so the consents given before still hold. */
export const PR_CONSENT_TEXT = "Hjerterum må bruge mine billeder og citater til at fortælle om mine events – nu og fremover – også i fælles opslag med andre events, på hjemmesiden, i nyhedsbrevet og på sociale medier. Jeg kan trække samtykket tilbage når som helst.";
/** Gitta's first words, which the consents given before 3 Nov 2026 were given to - kept, so each consent is shown with the words it was given to. */
export const PR_CONSENT_TEXT_V1 = "Må bruges til mit nuværende og mine fremtidige events, samt til grupperede opslag hvor mit event er iblandt - fx opslag for de næste to ugers dans, healing, yoga og lignende events - indtil jeg trækker mit samtykke tilbage.";
export const PR_CONSENT_V2_FROM_MS = Date.parse("2026-11-04T00:00:00+01:00");
/** The words a consent given at that moment was given to. */
export const consentTextAt = (ms: number | null) => ms !== null && ms < PR_CONSENT_V2_FROM_MS ? PR_CONSENT_TEXT_V1 : PR_CONSENT_TEXT;
export const PR_MIN_PHOTOS = 3;
export const PR_MAX_PHOTOS = 10;
/** Big enough for a post on Instagram or Facebook. */
export const PR_MIN_SIDE = 1080;
export const PR_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

/** instagram: the teacher's own Instagram username, so Hjerterum can invite them as a collaborator on its posts (Gitta, 3 Nov 2026). */
export type PrQuotes = { facilitator: string; offering: string; participant: string; participantName: string; instagram: string };
export type PrPhoto = { id: string; url: string; width: number | null; height: number | null };
export type PrMaterial = { photos: PrPhoto[]; quotes: PrQuotes; consentAt: number | null; withdrawnAt: number | null };

export const EMPTY_QUOTES: PrQuotes = { facilitator: "", offering: "", participant: "", participantName: "", instagram: "" };
const LIMITS: Record<keyof PrQuotes, number> = { facilitator: 200, offering: 200, participant: 200, participantName: 80, instagram: 80 };

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
  out.instagram = instagramName(out.instagram) ?? "";
  return out;
}

/** "@navn", "navn" or "instagram.com/navn" as the bare username Instagram knows - or null when it cannot be one. */
export function instagramName(input: string | null | undefined): string | null {
  const name = (input ?? "").trim().replace(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(name) ? name : null;
}

/** Whether Hjerterum may promote them: consent given (and not withdrawn) and at least three photos. */
export const readyForPr = (m: Pick<PrMaterial, "photos" | "consentAt">) => Boolean(m.consentAt) && m.photos.length >= PR_MIN_PHOTOS;
