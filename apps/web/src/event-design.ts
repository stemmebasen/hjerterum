import { apiFetch, type ClerkBrowser } from "./clerk";
import { chooseVariant, drawPoster, LOGO_FILE, photoFits, wordsOf, type VariantKey } from "./event-poster";
import type { PosterChoiceValue } from "./poster-choice";

/** Requested: "Hvorfor vises der ikke det flotte layout i det aflange eventfoto? Det giver jo mening, at det er vores nye design,
 * der skal være overalt på hjemmesiden og ikke kun på sociale medier". When an event is saved, its chosen design is drawn in the
 * wide frame (1920 × 1005) and kept with the event (worker/event-designs.ts); the website shows that instead of the bare photo.
 * Their own finished poster is not drawn wide - then the site keeps the photo. */

const image = (src: string) => new Promise<HTMLImageElement | null>(resolve => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = src; });
const FONTS = ["400 100px \"Playfair Display\"", "italic 400 100px \"Playfair Display\"", "600 30px Inter", "400 30px \"Space Mono\""];

export type DesignInput = { title: string; startsAt: string; endsAt: string | null; teacher: string; cover: File | null; coverUrl: string | null };

/** The design as a jpg in the wide frame, or null when it cannot be drawn. */
export async function drawDesign(clerk: ClerkBrowser, choice: PosterChoiceValue["choice"], input: DesignInput): Promise<Blob | null> {
  if (choice === "eget") return null;
  let url: string | null = null;
  try {
    if (input.cover) url = URL.createObjectURL(input.cover);
    else if (input.coverUrl) { const r = await apiFetch(clerk, input.coverUrl).catch(() => null); if (r?.ok) url = URL.createObjectURL(await r.blob()); }
    await Promise.all(FONTS.map(f => document.fonts.load(f).catch(() => [])));
    const [photo, logo] = await Promise.all([url ? image(url) : Promise.resolve(null), image(LOGO_FILE)]);
    const event = { id: input.title || "event", title: input.title, startsAt: input.startsAt, endsAt: input.endsAt, host: input.teacher, category: null, imageUrl: photo ? "photo" : null };
    const size = photo ? { width: photo.naturalWidth, height: photo.naturalHeight } : null;
    // The member's design when the photo is good enough for it in this frame; else the system's choice.
    const variant: VariantKey = choice !== "auto" && photoFits(choice, "cover", size).ok ? choice : chooseVariant(event, size, "cover");
    const canvas = document.createElement("canvas");
    drawPoster(canvas, variant, wordsOf(event), { photo, logo }, "cover");
    return await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
  } catch { return null; }
  finally { if (url) URL.revokeObjectURL(url); }
}

/** After the event is saved: draw its design wide and keep it with the event, or let it go when their own poster was chosen. */
export async function saveDesign(clerk: ClerkBrowser, bookingId: number, choice: PosterChoiceValue["choice"], input: DesignInput): Promise<void> {
  try {
    if (choice === "eget") { await apiFetch(clerk, `/api/room-bookings/${bookingId}/design`, { method: "DELETE" }); return; }
    const blob = await drawDesign(clerk, choice, input);
    if (blob) await apiFetch(clerk, `/api/room-bookings/${bookingId}/design`, { method: "PUT", headers: { "content-type": blob.type }, body: blob });
  } catch { /* the photo is shown until the design can be drawn - the next save tries again */ }
}
