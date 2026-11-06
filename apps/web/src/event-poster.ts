import { G, TEMPLATES } from "./poster-templates";
import type { PosterDesign } from "../site/poster-rules";
/** Requested: "Kan du lave 2-3 forslag til event designs" and then "Vi skal have fem varianter systemet kan vælge mellem".
 * An event's poster for social media in five designs, drawn on a canvas in the house's colours and type (Hjerterum Lys).
 * The system picks the one that suits the event (chooseVariant); the chair draws them all in admin, Plakater og opslag (poster-studio.tsx). */

export type PosterEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  host: string | null;
  category: string | null;
  /** Same-origin address of the photo (the worker's /api/poster-image for the membership system's photos), or none. */
  imageUrl: string | null;
};

export type VariantKey = PosterDesign;
/** cover: Facebook's event cover, 1920 × 1005 - "hvad med det aflange facebook cover format?" */
export type Format = "opslag" | "story" | "cover";

export const VARIANTS: Array<{ key: VariantKey; label: string; about: string }> = [
  { key: "rolig", label: "Rolig", about: "Lys baggrund, fotoet med bløde kanter og datoen i en cirkel." },
  { key: "foto", label: "Fuldt foto", about: "Fotoet over det hele med en varm toning og en glasboks." },
  { key: "organisk", label: "Organisk", about: "Bløde farveformer, fotoet som en sten og en stor dato." },
  { key: "typografi", label: "Typografi", about: "Uden foto: titlen stor på en varm farveflade." },
  { key: "split", label: "Delt", about: "Fotoet øverst med en blød bølge, teksten i et roligt felt under." },
  // Gitta's own looks.
  { key: "datoblok", label: "Datoblok", about: "Datoen i en karamelfarvet blok, titlen stor og fotoet i bunden." },
  { key: "cirkel", label: "Blød cirkel", about: "Datoen i en blød, salviegrøn cirkel og fotoet som en stribe." },
  { key: "boks", label: "Boks", about: "Fotoet over det hele med teksten i en mørk boks i midten." },
  { key: "aften", label: "Aften", about: "Fotoet glider over i en mørk aftenflade med teksten." },
  { key: "stribe", label: "Stribe", about: "En karamelfarvet stribe med datoen ned langs siden." },
  // Reported: "Many of them are very much alike. Can we make a little more variation?"
  { key: "plakat", label: "Plakat", about: "Kun typografi: titlen så stor som muligt på mørk bund." },
  { key: "billet", label: "Billet", about: "En adgangsbillet med fotoet på talonen." },
  { key: "polaroid", label: "Polaroid", about: "To skæve polaroidbilleder med tape og håndskrevet dato." },
  { key: "baand", label: "Bånd", about: "Fotoet over det hele med et roligt grønt bånd med teksten." },
  { key: "mosaik", label: "Mosaik", about: "Fotoet i tre udsnit, datoen og titlen i hver sin flise." },
  { key: "nat", label: "Nat", about: "Mørk bund med fotoet i en gylden cirkel." },
  // Shared from Hjerterum's Instagram: "Mere inspiration til Instagram design".
  { key: "underviser", label: "Mød underviseren", about: "Underviserens navn stort i en lys spalte ved siden af et portræt i fuld højde." },
  // Requested (5 Nov 2026): "Så giv mig flere muligheder og også gerne designs så jeg kan (gen) bruge event fotoet på kreative måder".
  { key: "kvadrat", label: "Kvadrat", about: "Fotoet som et stort kvadrat i en tynd ramme, teksten roligt under." },
  { key: "duotone", label: "Duotone", about: "Fotoet over det hele i husets to toner, cocoa og creme, med titlen stort." },
  { key: "filmstrimmel", label: "Filmstrimmel", about: "Tre udsnit af det samme foto som billeder på en filmstrimmel." },
  { key: "detalje", label: "Detalje", about: "Et nært udsnit af fotoet som baggrund med hele fotoet indsat som et lille billede." },
  { key: "bue", label: "Bue", about: "Fotoet i en blød bue på sandfarvet bund, som en dør ind til aftenen." },
  // "mange flere kreative forslag til opslagene - ligesom Canva har" (6 Nov 2026).
  { key: "ramme", label: "Passepartout", about: "Fotoet i en bred lys ramme som et kunsttryk, teksten i rammens bund." },
  { key: "spalte", label: "Spalte", about: "Fotoet i den ene halvdel, teksten i en farvet spalte ved siden af." },
  { key: "stordato", label: "Stor dato", about: "Datoen kæmpestor som grafik bag titlen, fotoet i en lille cirkel." },
  { key: "magasin", label: "Magasin", about: "Fotoet stort som en forside, titlen i store bogstaver hen over kanten." },
  { key: "minimal", label: "Minimal", about: "Masser af luft: et lille foto, en tynd linje og titlen roligt i hjørnet." },
  { key: "glas", label: "Glaskort", about: "Fotoet blødt sløret som baggrund og skarpt på et kort i midten." },
  { key: "diagonal", label: "Diagonal", about: "Fotoet skåret på skrå af en farvet flade med teksten." },
  { key: "ringe", label: "Ringe", about: "Fotoet i en cirkel med stille ringe omkring på mørk bund." }
];
/** The five with their own hand-made post and story layouts below; the others are drawn by poster-templates.ts in every format. */
const HANDMADE = new Set<VariantKey>(["rolig", "foto", "organisk", "typografi", "split"]);

/** Said: "Sommetider kommer underviserne selv med eventfotos" - often a finished flyer with its own text. That picture is kept
 * whole, on a soft background made of itself, with only Hjerterum's name and address under it; nothing is written over it. */
export const OWN_PICTURE = { key: "eget" as const, label: "Underviserens eget billede", about: "Billedet, som underviseren sendte det - helt, uden tekst ovenpå. Til en færdig plakat." };

/** Requested: "Vigtigt at vi først bruger den nye url når vi er begyndt at bruge den nye hjemmeside." The address the posters print: holistisk.org until the chair
 * says the new website is in use (worker/public-site.ts), then hjerterum.info. Plakater og opslag sets it from the server (setPosterSite). */
export let SITE_LABEL = "holistisk.org";
export const setPosterSite = (live: boolean) => { SITE_LABEL = live ? SITE_LABEL : "holistisk.org"; };

export const SIZES: Record<Format, { width: number; height: number; label: string }> = {
  opslag: { width: 1080, height: 1350, label: "Opslag (4:5)" },
  story: { width: 1080, height: 1920, label: "Story (9:16)" },
  cover: { width: 1920, height: 1005, label: "Facebook-cover (1,91:1)" }
};

export const C = { cream: "#f6f1e7", sand: "#efe4d6", ink: "#2a2622", muted: "#5b534b", terra: "#94503f", camel: "#c9976f", sage: "#e9efe1", blush: "#f3d9c9", dusk: "#2a1e18" };
/** Requested (the chair, 5 Nov 2026): "Er det muligt at få flere stills og video designs på kommando" - "Begge dele". Every design again in another of
 * the house's colour moods ("Vis flere designs"): the same layouts, the ink and the logo unchanged, the colours around them warm and soft. */
export type PaletteKey = "varm" | "salvie" | "skumring" | "hav" | "okker";
export const PALETTES: Array<{ key: PaletteKey; label: string; colors: Partial<typeof C> }> = [
  { key: "varm", label: "Varm", colors: {} },
  { key: "salvie", label: "Salvie", colors: { cream: "#f3f2ea", sand: "#e4e9da", terra: "#55704f", camel: "#a5b88b", sage: "#dce6cf", blush: "#e2ebd6", dusk: "#1d2a20" } },
  { key: "skumring", label: "Skumring", colors: { cream: "#f7f1f1", sand: "#ecdfe3", terra: "#6e4565", camel: "#c39aae", sage: "#ece4ef", blush: "#f0dbe5", dusk: "#251a26" } },
  { key: "hav", label: "Hav", colors: { cream: "#f1f4f3", sand: "#dfe8e8", terra: "#3b6470", camel: "#8fb2b5", sage: "#dcebe8", blush: "#d8e8eb", dusk: "#14242a" } },
  { key: "okker", label: "Okker", colors: { cream: "#faf3e6", sand: "#f1e2c8", terra: "#9a5f21", camel: "#dba556", sage: "#f0ead2", blush: "#f6e0bd", dusk: "#2b1d0f" } },
];

// The type the layouts read - lent for a drawing by its style (drawPoster), like the colours.
export let SERIF = "\"Playfair Display\", Georgia, serif";
export let SANS = "Inter, system-ui, sans-serif";

/** Asked (the chair, 6 Nov 2026): "Er der slet ikke mulighed for at få mange flere kreative forslag til opslagene - ligesom Canva har" - "Variationsmotor +
 * nye layouts". Every layout in any of the house's colour moods, with one of four pairs of type, a treatment of the photo, a little grain and a frame:
 * hundreds of combinations, always with the house's own logo. */
export type FontKey = "klassisk" | "elegant" | "moderne" | "varm";
export const FONT_PAIRS: Array<{ key: FontKey; label: string; serif: string; sans: string }> = [
  { key: "klassisk", label: "Klassisk skrift", serif: "\"Playfair Display\", Georgia, serif", sans: "Inter, system-ui, sans-serif" },
  { key: "elegant", label: "Elegant skrift", serif: "\"Cormorant Garamond\", Georgia, serif", sans: "Jost, system-ui, sans-serif" },
  { key: "moderne", label: "Moderne skrift", serif: "\"DM Serif Display\", Georgia, serif", sans: "\"DM Sans\", system-ui, sans-serif" },
  { key: "varm", label: "Varm skrift", serif: "Fraunces, Georgia, serif", sans: "\"Work Sans\", system-ui, sans-serif" },
];
/** The extra families, for the studio's page (Google Fonts, as the first pair). */
export const EXTRA_FONTS_URL = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=Jost:wght@400;500;600&family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@400;500;600&family=Fraunces:ital,wght@0,400;1,400&family=Work+Sans:wght@400;500;600&display=swap";
export type LookKey = "naturlig" | "sh" | "film" | "blod" | "kontrast";
export const LOOKS: Array<{ key: LookKey; label: string; filter: string }> = [
  { key: "naturlig", label: "Naturligt foto", filter: "" },
  { key: "sh", label: "Sort-hvid", filter: "grayscale(1) contrast(1.08)" },
  { key: "film", label: "Varm film", filter: "sepia(.32) saturate(1.1) contrast(1.05)" },
  { key: "blod", label: "Blødt lys", filter: "brightness(1.06) saturate(.82) contrast(.94)" },
  { key: "kontrast", label: "Klar kontrast", filter: "contrast(1.22) saturate(1.12)" },
];
export type Style = { palette: PaletteKey; fonts: FontKey; look: LookKey; grain: boolean; frame: boolean };
export const PLAIN_STYLE: Style = { palette: "varm", fonts: "klassisk", look: "naturlig", grain: false, frame: false };
/** The photo's treatment, read by cover() while a styled drawing is made. */
let PHOTO_FILTER = "";

/** "Skumring · Moderne skrift · Sort-hvid · korn" - what is not the plain style. */
export function styleLabel(style: Style): string {
  return [style.palette !== "varm" ? PALETTES.find(p => p.key === style.palette)?.label : "", style.fonts !== "klassisk" ? FONT_PAIRS.find(f => f.key === style.fonts)?.label : "",
    style.look !== "naturlig" ? LOOKS.find(l => l.key === style.look)?.label : "", style.grain ? "korn" : "", style.frame ? "ramme" : ""].filter(Boolean).join(" · ");
}

/** "Vis flere forslag": a batch of layouts in styles of their own - the same batch for the same seed, so the page does not change under the chair. */
export function styleBatch(seed: number, layouts: VariantKey[], count: number): Array<{ variant: VariantKey; style: Style }> {
  let t = seed >>> 0;
  const rnd = () => { t = (t + 0x6d2b79f5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rnd() * list.length)]!;
  return Array.from({ length: count }, () => ({ variant: pick(layouts), style: { palette: pick(PALETTES).key, fonts: pick(FONT_PAIRS).key, look: pick(LOOKS).key, grain: rnd() < 0.3, frame: rnd() < 0.25 } }));
}
const TZ = "Europe/Copenhagen";

// ---- The words on the poster ----

/** "Mediterende Yoga  |  Onsdage 16-17.20" → the title and what follows the bar as a line under it. */
export function splitTitle(title: string): { title: string; rest: string | null; teacher: string | null } {
  const [first, ...more] = title.split(/\s*[|·]\s*/);
  let main = (first ?? title).replace(/\s+/g, " ").trim() || title.trim();
  const rest: string[] = more.map(part => part.trim()).filter(Boolean);
  // "Source Breathwork (Rebirthing) with Douglas Crawford": the teacher goes under the title, the brackets beside it.
  let teacher: string | null = null;
  const by = /^(.{3,}?)\s+(?:with|med|ved|by)\s+([A-ZÆØÅ][\p{L}'.-]+(?:\s+[A-ZÆØÅ][\p{L}'.-]+){0,3})$/u.exec(main);
  if (by) { main = by[1]!.trim(); teacher = by[2]!.trim(); }
  const bracket = /^(.{3,}?)\s*\(([^()]{2,40})\)$/.exec(main);
  if (bracket) { main = bracket[1]!.trim(); rest.unshift(bracket[2]!.trim()); }
  return { title: main, rest: rest.join(" · ") || null, teacher };
}

/** The teacher, from the host or a line such as "Underviser: Søren Malmstrøm" / "Teacher: ..." / "FACILITATOR : ...". */
export function teacherOf(host: string | null, lines: string[] = []): string | null {
  const clean = (name: string) => name.replace(/\s+/g, " ").trim();
  if (host && host.trim() && host.trim().toLowerCase() !== "none") return clean(host);
  for (const line of lines.slice(0, 6)) {
    const m = /^(?:underviser|undervisere|teacher|facilitator|vært|host|med)\s*:\s*(.{3,48})$/i.exec(line.trim());
    if (m && !/[|:]/.test(m[1]!)) return clean(m[1]!);
  }
  return null;
}

const WEEKDAY = new Intl.DateTimeFormat("da-DK", { timeZone: TZ, weekday: "long" });
const NUM = new Intl.DateTimeFormat("da-DK", { timeZone: TZ, day: "numeric" });
const MONTH = new Intl.DateTimeFormat("da-DK", { timeZone: TZ, month: "long" });
const CLOCK = new Intl.DateTimeFormat("da-DK", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const clock = (iso: string) => CLOCK.format(new Date(iso)).replace(":", ".");
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "Onsdag 4. november", "19.00–21.15", "4", "november". */
export function whenOf(event: Pick<PosterEvent, "startsAt" | "endsAt">) {
  const start = new Date(event.startsAt);
  return {
    // Put together from its parts: browsers differ on "onsdag 4. november" and "onsdag den 4. november".
    day: `${capital(WEEKDAY.format(start))} ${NUM.format(start).replace(".", "")}. ${MONTH.format(start)}`,
    time: event.endsAt ? `${clock(event.startsAt)}–${clock(event.endsAt)}` : clock(event.startsAt),
    number: NUM.format(start).replace(".", ""),
    month: MONTH.format(start)
  };
}

/** A short word over the title: the category when there is one, else the kind of evening, else "Hjerterum". */
export function kickerOf(event: Pick<PosterEvent, "title" | "category">): string {
  // A category that says nothing about the evening ("Events & Workshops") gives way to what the title says.
  if (event.category && event.category.trim() && !/^(andet|other|events?|workshops?|events?\s*(?:&|og|and)\s*workshops?|arrangementer)$/i.test(event.category.trim())) return event.category.trim();
  const text = event.title.toLowerCase();
  if (/breath|åndedræt/.test(text)) return "Breathwork";
  if (/yoga/.test(text)) return "Yoga";
  if (/meditation|meditér/.test(text)) return "Meditation";
  if (/koncert|concert|kirtan/.test(text)) return "Koncert";
  if (/foredrag|talk/.test(text)) return "Foredrag";
  if (/dans|dance/.test(text)) return "Dans";
  if (/café|cafe/.test(text)) return "Café";
  return "I Hjerterum";
}

// ---- The system's choice ----

/** FNV-1a: ids that differ in one letter still land on different designs. */
const hash = (text: string) => [...text].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);

/** Requested: "Systemet skal sørge for at dimensionerne er i orden eller afvise". The box each design fills with the photo
 * (as drawPoster draws it). A photo may be enlarged a little - at most MAX_UPSCALE - never more, or it turns soft. */
export const MAX_UPSCALE = 1.25;
export function photoBox(variant: VariantKey, format: Format): { width: number; height: number } | null {
  const { width: W, height: H } = SIZES[format];
  if (variant !== "eget" && (format === "cover" || !HANDMADE.has(variant))) {
    const spot = TEMPLATES[variant]?.photo(W, H);
    return spot && !spot.optional ? { width: Math.round(spot.w), height: Math.round(spot.h) } : null;
  }
  const story = format === "story";
  switch (variant) {
    case "rolig": return { width: W - 380, height: story ? 860 : 640 };
    case "foto": return { width: W, height: H };
    case "organisk": { const d = Math.round((story ? 300 : 260) * 2.2); return { width: d, height: d }; }
    case "split": return { width: W, height: Math.round(H * (story ? 0.56 : 0.54)) + 60 };
    default: return null;
  }
}

/** cropped: the chair's own crop (poster-studio cropped()); shaped: a square, round, standing, wide or arched crop, which the designs put in whole
 * (cover below) where their photo place has another shape. */
export type PhotoSize = { width: number; height: number; cropped?: boolean; shaped?: boolean };

/** Requested (5 Nov 2026): "Meget hurtigt når jeg cropper et billede passer det ikke til de fleste designs - det er et problem". A crop is the chair's
 * own choice, made with the picture in front of them: it may be enlarged further (a little softer) before a design refuses it. */
export const MAX_UPSCALE_CROPPED = 2.2;
/** Same test as cover(): a shaped picture in a place of another shape is put in whole at 92 %, not stretched to fill. */
const putInWhole = (box: PhotoSize, photo: PhotoSize) => Boolean(photo.shaped) && Math.abs((box.width / box.height) / (photo.width / photo.height) - 1) > 0.12;

/** Whether the photo is sharp enough for the design, and if not, what to say. Typografi needs none. soft: it fits only because it is the chair's
 * crop, and will be a little soft. */
export function photoFits(variant: VariantKey, format: Format, photo: PhotoSize | null): { ok: true; soft?: true } | { ok: false; reason: string } {
  if (variant !== "eget" && !photoBox(variant, format)) return { ok: true };
  if (!photo || !photo.width || !photo.height) return { ok: false, reason: "Eventet har intet foto." };
  const limit = photo.cropped ? MAX_UPSCALE_CROPPED : MAX_UPSCALE;
  const judge = (scale: number, reason: string): { ok: true; soft?: true } | { ok: false; reason: string } =>
    scale <= MAX_UPSCALE ? { ok: true } : scale <= limit ? { ok: true, soft: true } : { ok: false, reason };
  const smaller = photo.cropped ? " Zoom lidt mindre ind, eller vælg en større beskæring." : "";
  if (variant === "eget") {
    const { width: W, height: H } = SIZES[format];
    const scale = Math.min((W - 120) / photo.width, (H - 260) / photo.height);
    return judge(scale, `Billedet er for lille (${photo.width} × ${photo.height} px) - det skal være mindst ${Math.ceil((W - 120) / limit)} px bredt eller ${Math.ceil((H - 260) / limit)} px højt.${smaller}`);
  }
  const box = photoBox(variant, format)!;
  const whole = putInWhole(box, photo);
  const scale = whole ? Math.min(box.width / photo.width, box.height / photo.height) * 0.92 : Math.max(box.width / photo.width, box.height / photo.height);
  return judge(scale, `Fotoet er for lille til dette design (${photo.width} × ${photo.height} px). Det skal dække ${box.width} × ${box.height} px - mindst ${Math.ceil(box.width / limit)} × ${Math.ceil(box.height / limit)} px.${smaller}`);
}

/** Requested: "fem varianter systemet kan vælge mellem". No photo, or one too small for every photo design → Typografi.
 * Concerts and films get the full photo, the café the organic one, talks the calm one - each only when the photo is big enough
 * for it; everything else is spread over the designs the photo fits, by the event's id, so the feed does not look the same every day. */
export function chooseVariant(event: Pick<PosterEvent, "id" | "title" | "category" | "imageUrl">, photo: PhotoSize | null = null, format: Format = "opslag"): VariantKey {
  if (!event.imageUrl || !photo) return hash(event.id) % 2 ? "plakat" : "typografi";
  const fits = (v: VariantKey) => photoFits(v, format, photo).ok;
  const text = `${event.title} ${event.category ?? ""}`.toLowerCase();
  const wish: VariantKey[] = /koncert|concert|kirtan|musik|music|\bfilm|movie/.test(text) ? ["foto", "split"]
    : /café|cafe|fællesspisning/.test(text) ? ["organisk"]
    : /foredrag|\btalk\b|oplæg|lecture/.test(text) ? ["rolig"] : [];
  const wished = wish.find(fits);
  if (wished) return wished;
  const pool = VARIANTS.map(v => v.key).filter(k => k !== "typografi" && k !== "plakat" && fits(k));
  return pool.length ? pool[hash(event.id) % pool.length]! : hash(event.id) % 2 ? "plakat" : "typografi";
}

// ---- Drawing ----

export type Ctx = CanvasRenderingContext2D;
export type Assets = { photo: HTMLImageElement | null; logo: HTMLImageElement | null };

/** The words broken into lines that fit, at the largest size from `size` down that keeps them within `maxLines`. */
export function fit(ctx: Ctx, text: string, font: (size: number) => string, maxWidth: number, size: number, maxLines: number, min = 40): { lines: string[]; size: number } {
  for (let s = size; s >= min; s -= 4) {
    ctx.font = font(s);
    const lines = wrap(ctx, text, maxWidth);
    if (lines.length <= maxLines && lines.every(line => ctx.measureText(line).width <= maxWidth)) return { lines, size: s };
  }
  ctx.font = font(min);
  const lines = wrap(ctx, text, maxWidth);
  if (lines.length <= maxLines) return { lines, size: min };
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1]!.replace(/[\s,.;:–-]+\S*$/, "")} …`;
  return { lines: kept, size: min };
}

function wrap(ctx: Ctx, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !line) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

/** Letter-spaced capitals, as the site's kickers. */
export function spaced(ctx: Ctx, text: string, x: number, y: number, font: string, color: string, spacing: number, align: "left" | "right" | "center" = "left") {
  ctx.font = font; ctx.fillStyle = color;
  const chars = [...text.toUpperCase()];
  const width = chars.reduce((w, ch) => w + ctx.measureText(ch).width + spacing, -spacing);
  let at = align === "left" ? x : align === "right" ? x - width : x - width / 2;
  ctx.textAlign = "left";
  for (const ch of chars) { ctx.fillText(ch, at, y); at += ctx.measureText(ch).width + spacing; }
  return width;
}

/** The photo drawn to cover the box, like CSS object-fit: cover. */
/** A picture the chair cut to a square or a circle in Plakater og opslag (poster-studio.tsx): the designs put it in whole, not cut again. */
const SHAPED = new WeakSet<HTMLImageElement>();
export const markShaped = (img: HTMLImageElement) => { SHAPED.add(img); };
export const isShaped = (img: HTMLImageElement) => SHAPED.has(img);

export function cover(ctx: Ctx, img: HTMLImageElement, x: number, y: number, w: number, h: number, focusX = 0.5, focusY = 0.5) {
  // Where the design's own place has about the picture's shape (a circle in "Nat"), it simply fills it.
  if (SHAPED.has(img) && Math.abs((w / h) / (img.naturalWidth / img.naturalHeight) - 1) > 0.12) {
    // Whole and centred in the picture's place, on the house's cream - a little air around it, so a circle is a circle.
    const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight) * 0.92, dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
    ctx.save(); ctx.fillStyle = C.cream; ctx.fillRect(x, y, w, h); ctx.restore();
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    return;
  }
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / scale, sh = h / scale;
  // The style's treatment of the photo, unless the layout has its own (duotone, filmstrip).
  const own = ctx.filter && ctx.filter !== "none";
  if (PHOTO_FILTER && !own) ctx.filter = PHOTO_FILTER;
  ctx.drawImage(img, (img.naturalWidth - sw) * focusX, (img.naturalHeight - sh) * focusY, sw, sh, x, y, w, h);
  if (PHOTO_FILTER && !own) ctx.filter = "none";
}

/** A rounded rectangle with each corner's own elliptic radius [rx, ry]: the soft "pebble" corners of the website. */
export function pebbleRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: { tl: [number, number]; tr: [number, number]; br: [number, number]; bl: [number, number] }) {
  ctx.beginPath();
  ctx.moveTo(x + r.tl[0], y);
  ctx.lineTo(x + w - r.tr[0], y);
  ctx.ellipse(x + w - r.tr[0], y + r.tr[1], r.tr[0], r.tr[1], 0, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - r.br[1]);
  ctx.ellipse(x + w - r.br[0], y + h - r.br[1], r.br[0], r.br[1], 0, 0, Math.PI / 2);
  ctx.lineTo(x + r.bl[0], y + h);
  ctx.ellipse(x + r.bl[0], y + h - r.bl[1], r.bl[0], r.bl[1], 0, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + r.tl[1]);
  ctx.ellipse(x + r.tl[0], y + r.tl[1], r.tl[0], r.tl[1], 0, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

/** An organic blob through `points` round a centre, smoothed with quadratic curves. */
export function blob(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, wobble: number[], color: string) {
  const n = wobble.length;
  const pts = wobble.map((k, i) => { const a = (i / n) * Math.PI * 2; return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k] as const; });
  ctx.beginPath();
  const mid = (i: number) => { const a = pts[i % n]!, b = pts[(i + 1) % n]!; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const; };
  const start = mid(n - 1);
  ctx.moveTo(start[0], start[1]);
  for (let i = 0; i < n; i++) { const p = pts[i]!, m = mid(i); ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]); }
  ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
}

/** Hjerterum's hands in one colour (the logo file is light on transparent). */
/** Hjerterum's logo - the round mark "VI FØLGER HINANDEN HJEM" around the hands holding the heart, exactly as the chair sent it
 * (public/brand/hjerterum-stempel.png): "NEJ, du må ikke tegne dit eget logo. Du skal bruge mit". It is one colour on a clear
 * ground, so it is only given the design's colour. Centre (cx, cy), radius r. */
export const LOGO_FILE = "/brand/hjerterum-stempel.png";
export function stamp(ctx: Ctx, img: HTMLImageElement | null, cx: number, cy: number, r: number, color: string) {
  if (!img) return;
  const tint = document.createElement("canvas");
  tint.width = img.naturalWidth; tint.height = img.naturalHeight;
  const t = tint.getContext("2d")!;
  t.drawImage(img, 0, 0);
  t.globalCompositeOperation = "source-in";
  t.fillStyle = color; t.fillRect(0, 0, tint.width, tint.height);
  ctx.drawImage(tint, cx - r, cy - r, r * 2, r * 2);
}

/** Requested: "Sørg også for at Hjerterums logo er med i rette størrelse, passende farve og en stilfuld placering". Where a design
 * had the small mark and the name in its corner, Hjerterum's own round mark now stands there, large enough to read. A design
 * whose corner was centred keeps it centred. */
export function logo(ctx: Ctx, img: HTMLImageElement | null, x: number, y: number, size: number, color: string) {
  const W = ctx.canvas.width / (ctx.getTransform().a || 1);
  const d = size * 2.6, wide = size * 5.2;
  const centred = Math.abs(x + wide / 2 - W / 2) < size * 1.5;
  const H = ctx.canvas.height / (ctx.getTransform().d || 1);
  const cx = centred ? W / 2 : x + d / 2, cy = Math.min(y + d / 2 - size * 0.2, H - d / 2 - size * 0.45);
  stamp(ctx, img, cx, cy, d / 2, color);
}

/** The title in two voices, as the website's headings: the first words upright, the last word in italic and colour. */
export function titleLines(lines: string[]): Array<{ text: string; italic: boolean }> {
  if (lines.length === 1) {
    const words = lines[0]!.split(" ");
    if (words.length < 2) return [{ text: lines[0]!, italic: true }];
    return [{ text: words.slice(0, -1).join(" "), italic: false }, { text: words[words.length - 1]!, italic: true }];
  }
  return lines.map((text, i) => ({ text, italic: i === lines.length - 1 }));
}

/** The title within its room: anchored at `bottom` (growing upwards, never above `limit`) or at `top` (never below `limit`). */
function drawTitle(ctx: Ctx, title: string, x: number, bottom: number | null, top: number | null, width: number, size: number, maxLines: number, colors: { upright: string; italic: string }, limit: number | null = null) {
  const layout = (start: number) => {
    const measured = fit(ctx, title, s => `400 ${s}px ${SERIF}`, width, start, maxLines, Math.round(size * 0.4));
    const lines = titleLines(measured.lines);
    // A one-line title split in two must still fit: the longer half decides the size.
    let s = measured.size;
    while (s > 40 && lines.some(l => { ctx.font = `${l.italic ? "italic " : ""}400 ${s}px ${SERIF}`; return ctx.measureText(l.text).width > width; })) s -= 4;
    const lead = s * 1.02;
    const y0 = top !== null ? top + s * 0.86 : bottom! - lead * (lines.length - 1);
    return { lines, s, lead, y0, top: y0 - s * 0.86, bottom: y0 + lead * (lines.length - 1) + s * 0.25 };
  };
  let l = layout(size);
  for (let start = size - 4; limit !== null && start >= size * 0.4 && (top === null ? l.top < limit : l.bottom > limit); start -= 4) l = layout(start);
  l.lines.forEach((line, i) => {
    ctx.font = `${line.italic ? "italic " : ""}400 ${l.s}px ${SERIF}`;
    ctx.fillStyle = line.italic ? colors.italic : colors.upright;
    ctx.fillText(line.text, x, l.y0 + i * l.lead);
  });
  return { top: l.top, bottom: l.bottom, size: l.s };
}

export function text(ctx: Ctx, value: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = "left") {
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(value, x, y); ctx.textAlign = "left";
}

export const ADDRESS = "Guldsmedgade 26B, Aarhus";

export type PosterWords = { title: string; rest: string | null; teacher: string | null; kicker: string; day: string; time: string; number: string; month: string };

export function wordsOf(event: PosterEvent, lines: string[] = []): PosterWords {
  const { title, rest, teacher } = splitTitle(event.title);
  return { title, rest, teacher: teacherOf(event.host, lines) ?? teacher, kicker: kickerOf(event), ...whenOf(event) };
}

export const byline = (w: PosterWords) => w.teacher ? `med ${w.teacher}` : w.rest;

/** Draws one variant on the canvas, which must be the format's size. */
/** `scale` draws a smaller copy (the event form's previews): the same design, a fraction of the pixels. Reported: "Jeg kan se, at de
 * langsomt bliver gjort aktive én for én" - six full-size posters on every key press made the form slow. */
export function drawPoster(canvas: HTMLCanvasElement, variant: VariantKey, words: PosterWords, assets: Assets, format: Format = "opslag", scale = 1, look: PaletteKey | Style = "varm") {
  const style: Style = typeof look === "string" ? { ...PLAIN_STYLE, palette: look } : look;
  const palette = style.palette;
  // The colours are the module's own (C), read by every layout: lent for this drawing, and given back whatever happens - and so the type and the photo's look.
  const saved = { ...C }, savedG = { ...G }, savedType = [SERIF, SANS] as const;
  const pair = FONT_PAIRS.find(f => f.key === style.fonts) ?? FONT_PAIRS[0]!;
  SERIF = pair.serif; SANS = pair.sans; PHOTO_FILTER = LOOKS.find(l => l.key === style.look)?.filter ?? "";
  const colors = PALETTES.find(p => p.key === palette)?.colors ?? {};
  Object.assign(C, colors);
  // Gitta's looks (poster-templates.ts) have colours of their own: they follow the mood too.
  if (palette !== "varm") Object.assign(G, { caramel: colors.camel, gold: colors.camel, leaf: colors.terra, leafSoft: colors.sage, cocoa: colors.dusk, night: colors.dusk, sageLine: colors.sand,
    brownB: colors.terra, brownB2: colors.terra, accentB: colors.camel, cream: colors.cream, creamB: colors.cream });
  try {
    drawLayout(canvas, variant, words, assets, format, scale);
    const ctx = canvas.getContext("2d")!;
    const { width: W, height: H } = SIZES[format];
    if (style.grain) {
      // A fine grain over the whole, like film.
      const tile = document.createElement("canvas"); tile.width = tile.height = 160;
      const g = tile.getContext("2d")!, img = g.createImageData(160, 160);
      for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 22; }
      g.putImageData(img, 0, 0);
      ctx.save(); ctx.globalCompositeOperation = "overlay"; ctx.fillStyle = ctx.createPattern(tile, "repeat")!; ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    if (style.frame) {
      // A thin frame inside the edge, in the mood's light colour.
      const m = Math.min(W, H) * 0.028;
      ctx.save(); ctx.strokeStyle = C.cream; ctx.globalAlpha = 0.9; ctx.lineWidth = Math.min(W, H) * 0.004; ctx.strokeRect(m, m, W - 2 * m, H - 2 * m); ctx.restore();
    }
  } finally { Object.assign(C, saved); Object.assign(G, savedG); [SERIF, SANS] = savedType; PHOTO_FILTER = ""; }
}

function drawLayout(canvas: HTMLCanvasElement, variant: VariantKey, words: PosterWords, assets: Assets, format: Format, scale: number) {
  const { width: W, height: H } = SIZES[format];
  canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext("2d")!;
  if (scale !== 1) ctx.scale(scale, scale);
  ctx.textBaseline = "alphabetic";
  if (format === "cover" || !HANDMADE.has(variant)) {
    const template = TEMPLATES[variant];
    if (template) { template.draw.call(template, ctx, W, H, words, assets); return; }
  }
  const story = format === "story";
  const photo = assets.photo;
  const M = 84;

  if (variant === "rolig") {
    ctx.fillStyle = C.cream; ctx.fillRect(0, 0, W, H);
    logo(ctx, assets.logo, M, 84, 56, C.ink);
    const ph = story ? 860 : 640, py = story ? 200 : 96;
    if (photo) {
      ctx.save(); pebbleRect(ctx, 380, py, W - 380, ph, { tl: [320, 260], tr: [0, 0], br: [0, 0], bl: [200, 240] }); ctx.clip();
      cover(ctx, photo, 380, py, W - 380, ph); ctx.restore();
    }
    spaced(ctx, words.kicker, M, py + 210, `600 20px ${SANS}`, C.terra, 4.5);
    const lineY = H - (story ? 470 : 330);
    const t = drawTitle(ctx, words.title, M, lineY - 70, null, W - 2 * M, story ? 124 : 116, 3, { upright: C.ink, italic: C.terra }, py + ph + 40);
    ctx.fillStyle = C.camel; ctx.beginPath(); ctx.roundRect(M, t.bottom + 18, 120, 6, 3); ctx.fill();
    const by = byline(words);
    if (by) text(ctx, by, M, t.bottom + 82, `italic 400 36px ${SERIF}`, C.ink);
    text(ctx, `${words.day} · ${words.time}`, M, H - 160, `600 27px ${SANS}`, C.ink);
    text(ctx, `Hjerterum · ${ADDRESS}`, M, H - 120, `400 25px ${SANS}`, C.muted);
    text(ctx, SITE_LABEL, M, H - 82, `400 25px ${SANS}`, C.muted);
    ctx.fillStyle = C.terra; ctx.beginPath(); ctx.arc(W - M - 100, H - 184, 100, 0, Math.PI * 2); ctx.fill();
    spaced(ctx, words.month.slice(0, 3), W - M - 100, H - 214, `600 19px ${SANS}`, C.cream, 4, "center");
    text(ctx, words.number, W - M - 100, H - 128, `400 84px ${SERIF}`, C.cream, "center");
    return;
  }

  if (variant === "foto") {
    ctx.fillStyle = C.dusk; ctx.fillRect(0, 0, W, H);
    if (photo) cover(ctx, photo, 0, 0, W, H, 0.4, 0.5);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(31,29,26,.28)"); g.addColorStop(0.3, "rgba(31,29,26,.06)"); g.addColorStop(0.52, "rgba(42,30,24,.66)"); g.addColorStop(0.75, "rgba(42,30,24,.88)"); g.addColorStop(1, "rgba(42,30,24,.95)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    logo(ctx, assets.logo, 72, 72, 56, "#fbfaf8");
    const pill = `${words.day.split(" ")[0]} · ${words.number}. ${words.month.slice(0, 3)}`;
    const pw = spaced(ctx, pill, -9999, -9999, `600 19px ${SANS}`, "transparent", 4) + 56;
    ctx.fillStyle = "rgba(251,250,248,.18)"; ctx.strokeStyle = "rgba(251,250,248,.4)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(W - 72 - pw, 74, pw, 56, 28); ctx.fill(); ctx.stroke();
    spaced(ctx, pill, W - 72 - pw / 2, 110, `600 19px ${SANS}`, "#fbfaf8", 4, "center");
    const boxH = 128, boxY = H - 72 - boxH;
    const by = byline(words);
    const byY = boxY - 54;
    if (by) text(ctx, by, 72, byY, `italic 400 38px ${SERIF}`, "#f3eee6");
    const t = drawTitle(ctx, words.title, 72, (by ? byY - 64 : boxY - 60), null, W - 144, story ? 140 : 132, 3, { upright: "#fbfaf8", italic: C.blush }, H * 0.46);
    ctx.fillStyle = C.camel; ctx.beginPath(); ctx.arc(80, t.top - 34, 7, 0, Math.PI * 2); ctx.fill();
    spaced(ctx, words.kicker, 100, t.top - 27, `600 20px ${SANS}`, "#e3a58f", 4.5);
    ctx.fillStyle = "rgba(251,250,248,.14)"; ctx.strokeStyle = "rgba(251,250,248,.3)";
    ctx.beginPath(); ctx.roundRect(72, boxY, W - 144, boxH, 28); ctx.fill(); ctx.stroke();
    text(ctx, words.time, 110, boxY + 56, `600 30px ${SANS}`, "#fbfaf8");
    text(ctx, ADDRESS, 110, boxY + 94, `400 23px ${SANS}`, "#e8dfd4");
    ctx.fillStyle = C.blush; ctx.beginPath(); ctx.roundRect(W - 72 - 36 - 220, boxY + 32, 220, 64, 32); ctx.fill();
    text(ctx, SITE_LABEL, W - 72 - 36 - 110, boxY + 73, `600 23px ${SANS}`, C.ink, "center");
    return;
  }

  if (variant === "organisk") {
    ctx.fillStyle = C.sand; ctx.fillRect(0, 0, W, H);
    const s = story ? 1.18 : 1;
    blob(ctx, 190, 170 * s, 520, 450 * s, [1, 1.08, 0.94, 1.12, 0.9, 1.05, 0.96, 1.1], C.camel);
    blob(ctx, W - 250, 300 * s, 170, 160, [1, 0.92, 1.08, 0.95, 1.1, 0.9, 1.04], C.sage);
    blob(ctx, W - 40, H - 120, 400, 360, [1, 1.1, 0.92, 1.05, 0.95, 1.12, 0.9], C.terra);
    logo(ctx, assets.logo, 80, 80, 56, C.ink);
    const pr = story ? 300 : 260, pcx = 410, pcy = story ? 760 : 560;
    if (photo) {
      ctx.save();
      blob(ctx, pcx, pcy, pr + 10, pr + 10, [1, 1.04, 0.97, 1.03, 0.98, 1.05, 0.96, 1.02], C.sand);
      blob(ctx, pcx, pcy, pr, pr, [1, 1.04, 0.97, 1.03, 0.98, 1.05, 0.96, 1.02], "transparent");
      ctx.clip(); cover(ctx, photo, pcx - pr * 1.1, pcy - pr * 1.1, pr * 2.2, pr * 2.2, 0.4, 0.5); ctx.restore();
    }
    text(ctx, words.number, W - 250, 300 * s + 30, `italic 400 190px ${SERIF}`, C.ink, "center");
    spaced(ctx, words.month, W - 250, 300 * s + 100, `600 22px ${SANS}`, C.ink, 6, "center");
    const by = byline(words);
    const base = H - (by ? 150 : 100);
    const t = drawTitle(ctx, words.title, 80, base, null, 600, story ? 112 : 104, 3, { upright: C.ink, italic: C.ink }, pcy + pr + 80);
    spaced(ctx, words.kicker, 80, t.top - 40, `600 20px ${SANS}`, C.terra, 4.5);
    if (by) text(ctx, by, 80, H - 92, `italic 400 34px ${SERIF}`, C.ink);
    text(ctx, words.time, W - 80, H - 190, `600 32px ${SANS}`, "#fbfaf8", "right");
    text(ctx, words.day.split(" ")[0]!, W - 80, H - 146, `500 25px ${SANS}`, "#fbfaf8", "right");
    text(ctx, "Hjerterum, Aarhus", W - 80, H - 106, `500 25px ${SANS}`, "#fbfaf8", "right");
    return;
  }

  if (variant === "typografi") {
    ctx.fillStyle = C.terra; ctx.fillRect(0, 0, W, H);
    blob(ctx, W - 120, 260, 360, 330, [1, 1.06, 0.94, 1.1, 0.92, 1.04, 0.97], "rgba(201,151,111,.45)");
    blob(ctx, 80, H - 140, 300, 260, [1, 0.94, 1.08, 0.96, 1.1, 0.92], "rgba(243,217,201,.16)");
    logo(ctx, assets.logo, M, 84, 56, C.cream);
    // Reported: "Ved design nr. 4 - hvorfor skal indholdsteksten stå så højt oppe. Den bør centreres." The kicker, title and byline
    // are measured first (on a scratch canvas) and then placed in the middle of the room between the logo and the line.
    const by = byline(words), roomTop = 260, roomBottom = H - 250;
    const titleSize = story ? 150 : 136, limit = roomBottom - 40 - (by ? 110 : 40);
    const scratch = document.createElement("canvas").getContext("2d")!;
    const probe = drawTitle(scratch, words.title, M, null, 0, W - 2 * M, titleSize, 4, { upright: C.cream, italic: C.blush }, limit - roomTop);
    const height = 40 + probe.bottom + (by ? 64 : 0);
    const start = Math.max(roomTop, roomTop + (roomBottom - roomTop - height) / 2);
    spaced(ctx, words.kicker, M, start, `600 21px ${SANS}`, C.blush, 5);
    const t = drawTitle(ctx, words.title, M, null, start + 40, W - 2 * M, titleSize, 4, { upright: C.cream, italic: C.blush }, limit);
    if (by) text(ctx, by, M, t.bottom + 64, `italic 400 38px ${SERIF}`, C.cream);
    ctx.strokeStyle = "rgba(246,241,231,.35)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(M, H - 250); ctx.lineTo(W - M, H - 250); ctx.stroke();
    text(ctx, words.number, M, H - 104, `italic 400 120px ${SERIF}`, C.cream);
    ctx.font = `italic 400 120px ${SERIF}`;
    const nw = ctx.measureText(words.number).width;
    spaced(ctx, words.month, M + nw + 28, H - 150, `600 22px ${SANS}`, C.blush, 5);
    text(ctx, words.day.split(" ")[0]!, M + nw + 28, H - 110, `500 26px ${SANS}`, C.cream);
    text(ctx, words.time, W - M, H - 150, `600 30px ${SANS}`, C.cream, "right");
    text(ctx, `Hjerterum · ${SITE_LABEL}`, W - M, H - 110, `400 24px ${SANS}`, C.blush, "right");
    return;
  }

  if (variant === "eget") {
    ctx.fillStyle = C.sand; ctx.fillRect(0, 0, W, H);
    if (photo) {
      ctx.save(); ctx.filter = "blur(48px) saturate(.9)"; cover(ctx, photo, -80, -80, W + 160, H + 160); ctx.restore();
      ctx.fillStyle = "rgba(246,241,231,.55)"; ctx.fillRect(0, 0, W, H);
      const room = { w: W - 120, h: H - 260 };
      const scale = Math.min(room.w / photo.naturalWidth, room.h / photo.naturalHeight);
      const w = photo.naturalWidth * scale, h = photo.naturalHeight * scale, x = (W - w) / 2, y = 60 + (room.h - h) / 2;
      ctx.save(); ctx.shadowColor = "rgba(42,38,34,.28)"; ctx.shadowBlur = 50; ctx.shadowOffsetY = 18;
      ctx.beginPath(); ctx.roundRect(x, y, w, h, 22); ctx.fillStyle = C.cream; ctx.fill(); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, 22); ctx.clip(); ctx.drawImage(photo, x, y, w, h); ctx.restore();
    }
    logo(ctx, assets.logo, 72, H - 136, 52, C.ink);
    text(ctx, ADDRESS, W - 72, H - 112, `500 24px ${SANS}`, C.ink, "right");
    text(ctx, SITE_LABEL, W - 72, H - 78, `400 22px ${SANS}`, C.muted, "right");
    return;
  }

  // split
  ctx.fillStyle = C.cream; ctx.fillRect(0, 0, W, H);
  const ph = Math.round(H * (story ? 0.56 : 0.54));
  ctx.save();
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, ph - 40);
  ctx.bezierCurveTo(W * 0.72, ph + 50, W * 0.36, ph - 90, 0, ph + 10); ctx.closePath(); ctx.clip();
  ctx.fillStyle = C.sand; ctx.fillRect(0, 0, W, ph + 60);
  if (photo) cover(ctx, photo, 0, 0, W, ph + 60, 0.45, 0.5);
  const g = ctx.createLinearGradient(0, 0, 0, 220); g.addColorStop(0, "rgba(31,29,26,.45)"); g.addColorStop(1, "rgba(31,29,26,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 220);
  ctx.restore();
  logo(ctx, assets.logo, 72, 64, 52, "#fbfaf8");
  const top = ph + (story ? 120 : 70);
  spaced(ctx, words.kicker, M, top, `600 20px ${SANS}`, C.terra, 4.5);
  const t = drawTitle(ctx, words.title, M, null, top + 26, W - 2 * M, story ? 120 : 108, 3, { upright: C.ink, italic: C.terra }, H - 160 - (byline(words) ? 70 : 10));
  const by = byline(words);
  if (by) text(ctx, by, M, t.bottom + 52, `italic 400 34px ${SERIF}`, C.ink);
  const rowY = H - 92;
  ctx.fillStyle = C.sand; ctx.beginPath(); ctx.roundRect(M - 24, rowY - 62, W - 2 * M + 48, 96, 48); ctx.fill();
  text(ctx, `${words.day}`, M + 10, rowY, `600 26px ${SANS}`, C.ink);
  text(ctx, words.time, W / 2 + 60, rowY, `600 26px ${SANS}`, C.terra, "center");
  text(ctx, SITE_LABEL, W - M - 10, rowY, `500 24px ${SANS}`, C.muted, "right");
}
