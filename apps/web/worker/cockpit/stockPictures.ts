import { completeAs } from "../saga/ai.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";

/** Asked (the chair, 6 Nov 2026): "Vi skal gøre det kreative værksted langt bedre og med flere designs ... lad os koble pexels api på" - and of the free
 * sources offered, first "Kunst og botanik (CC0)", then "Men også de andre. Så mange tools vi kan få som gør variationen bedre". Pictures to search for in
 * Plakater og opslag, in three kinds:
 * - foto: Pexels (PEXELS_API_KEY), Unsplash (UNSPLASH_ACCESS_KEY) and Pixabay (PIXABAY_API_KEY), taken in turn;
 * - illustration: Pixabay's illustrations and vector graphics;
 * - kunst: public domain art from the Art Institute of Chicago and The Met, and Openverse - only CC0 and public domain, so nothing needs a name on it.
 * A source without its key is left out (and named, so the chair knows). The chosen one is fetched by the server - by its id at its source, never by an address
 * from the browser - and kept with the event's material (mailMaterial.ts storeUpload). Saga proposes what to search for: nature, light, things and hands -
 * not faces, so no stranger looks like one of Hjerterum's own. */

export type StockKind = "foto" | "illustration" | "kunst";
export type StockSourceName = "pexels" | "unsplash" | "pixabay" | "aic" | "met" | "openverse";
export type StockPicture = { source: StockSourceName; id: string; thumb: string; label: string; credit: string; link: string };
export type StockKeys = { PEXELS_API_KEY?: string; UNSPLASH_ACCESS_KEY?: string; PIXABAY_API_KEY?: string };
type Fetcher = SagaDeps["fetcher"];

/** Hosts the studio may show thumbnails from (its content security policy). */
export const STOCK_IMAGE_HOSTS = ["https://images.pexels.com", "https://images.unsplash.com", "https://pixabay.com", "https://cdn.pixabay.com", "https://www.artic.edu",
  "https://images.metmuseum.org", "https://api.openverse.org"];

const json = async <T>(response: Response): Promise<T | null> => response.ok ? await response.json().catch(() => null) as T | null : null;
const get = <T>(fetcher: Fetcher, url: string, headers: Record<string, string> = {}) => fetcher(url, { headers: { accept: "application/json", ...headers } }).then(r => json<T>(r)).catch(() => null);
const https = (url: unknown, host?: string): url is string => typeof url === "string" && url.startsWith(host ? `${host}/` : "https://");

// ---- The sources ----

async function pexels(fetcher: Fetcher, key: string, query: string): Promise<StockPicture[]> {
  type Photo = { id: number; url?: string; alt?: string; photographer?: string; src?: { medium?: string } };
  const data = await get<{ photos?: Photo[] }>(fetcher, `https://api.pexels.com/v1/search?${new URLSearchParams({ query, per_page: "16" })}`, { authorization: key });
  return (data?.photos ?? []).filter(p => https(p.src?.medium, "https://images.pexels.com")).map(p => ({ source: "pexels" as const, id: String(p.id), thumb: p.src!.medium!,
    label: p.alt || "Foto", credit: `Foto: ${p.photographer ?? "ukendt"} / Pexels`, link: p.url ?? "https://www.pexels.com" }));
}

async function unsplash(fetcher: Fetcher, key: string, query: string): Promise<StockPicture[]> {
  type Photo = { id: string; alt_description?: string | null; urls?: { small?: string }; user?: { name?: string }; links?: { html?: string } };
  const data = await get<{ results?: Photo[] }>(fetcher, `https://api.unsplash.com/search/photos?${new URLSearchParams({ query, per_page: "16", content_filter: "high" })}`, { authorization: `Client-ID ${key}` });
  return (data?.results ?? []).filter(p => https(p.urls?.small, "https://images.unsplash.com")).map(p => ({ source: "unsplash" as const, id: p.id, thumb: p.urls!.small!,
    label: p.alt_description || "Foto", credit: `Foto: ${p.user?.name ?? "ukendt"} / Unsplash`, link: p.links?.html ?? "https://unsplash.com" }));
}

type PixabayHit = { id: number; webformatURL?: string; largeImageURL?: string; user?: string; pageURL?: string; tags?: string };
async function pixabay(fetcher: Fetcher, key: string, query: string, type: "photo" | "illustration" | "vector"): Promise<StockPicture[]> {
  const data = await get<{ hits?: PixabayHit[] }>(fetcher, `https://pixabay.com/api/?${new URLSearchParams({ key, q: query.slice(0, 100), image_type: type, per_page: "20", safesearch: "true" })}`);
  return (data?.hits ?? []).filter(h => https(h.webformatURL, "https://pixabay.com") || https(h.webformatURL, "https://cdn.pixabay.com")).map(h => ({ source: "pixabay" as const, id: String(h.id),
    thumb: h.webformatURL!, label: h.tags || "Billede", credit: `${type === "photo" ? "Foto" : "Illustration"}: ${h.user ?? "ukendt"} / Pixabay`, link: h.pageURL ?? "https://pixabay.com" }));
}

const AIC_HEADERS = { "AIC-User-Agent": "Hjerterum (admin.hjerterum.info)" };
const aicImage = (imageId: string, width: number) => `https://www.artic.edu/iiif/2/${imageId}/full/${width},/0/default.jpg`;
async function aic(fetcher: Fetcher, query: string): Promise<StockPicture[]> {
  type Work = { id: number; title?: string; image_id?: string | null; artist_title?: string | null; is_public_domain?: boolean };
  const data = await get<{ data?: Work[] }>(fetcher, `https://api.artic.edu/api/v1/artworks/search?${new URLSearchParams({ q: query, "query[term][is_public_domain]": "true", fields: "id,title,image_id,artist_title,is_public_domain", limit: "12" })}`, AIC_HEADERS);
  return (data?.data ?? []).filter(w => w.image_id && w.is_public_domain !== false && /^[0-9a-f-]{36}$/.test(w.image_id)).map(w => ({
    source: "aic" as const, id: w.image_id!, thumb: aicImage(w.image_id!, 400), label: w.title ?? "Kunstværk", credit: `${w.artist_title ? `${w.artist_title}: ` : ""}${w.title ?? ""} (Art Institute of Chicago, CC0)`,
    link: `https://www.artic.edu/artworks/${w.id}` }));
}

type MetObject = { objectID: number; title?: string; artistDisplayName?: string; isPublicDomain?: boolean; primaryImage?: string; primaryImageSmall?: string; objectURL?: string };
async function met(fetcher: Fetcher, query: string): Promise<StockPicture[]> {
  const found = await get<{ objectIDs?: number[] | null }>(fetcher, `https://collectionapi.metmuseum.org/public/collection/v1/search?${new URLSearchParams({ hasImages: "true", q: query })}`);
  const objects = await Promise.all((found?.objectIDs ?? []).slice(0, 8).map(id => get<MetObject>(fetcher, `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`)));
  return objects.filter((o): o is MetObject => Boolean(o?.isPublicDomain && https(o.primaryImageSmall, "https://images.metmuseum.org"))).map(o => ({
    source: "met" as const, id: String(o.objectID), thumb: o.primaryImageSmall!, label: o.title ?? "Kunstværk", credit: `${o.artistDisplayName ? `${o.artistDisplayName}: ` : ""}${o.title ?? ""} (The Met, CC0)`,
    link: o.objectURL ?? "https://www.metmuseum.org" }));
}

type OpenverseImage = { id: string; title?: string; creator?: string | null; license?: string; thumbnail?: string; url?: string; foreign_landing_url?: string; source?: string };
async function openverse(fetcher: Fetcher, query: string): Promise<StockPicture[]> {
  const data = await get<{ results?: OpenverseImage[] }>(fetcher, `https://api.openverse.org/v1/images/?${new URLSearchParams({ q: query, license: "cc0,pdm", page_size: "12", mature: "false" })}`);
  return (data?.results ?? []).filter(i => /^[0-9a-f-]{36}$/.test(i.id) && (i.license === "cc0" || i.license === "pdm") && https(i.thumbnail, "https://api.openverse.org")).map(i => ({
    source: "openverse" as const, id: i.id, thumb: i.thumbnail!, label: i.title ?? "Billede", credit: `${i.creator ? `${i.creator}: ` : ""}${i.title ?? ""} (Openverse, ${i.license === "cc0" ? "CC0" : "public domain"})`,
    link: i.foreign_landing_url ?? "https://openverse.org" }));
}

/** Several lists taken in turn, so every source is seen. */
function interleave(lists: StockPicture[][], max = 30): StockPicture[] {
  const out: StockPicture[] = [];
  for (let i = 0; out.length < max && lists.some(l => i < l.length); i++) for (const l of lists) if (l[i] && out.length < max) out.push(l[i]!);
  return out;
}

/** The kind's sources that have their keys, and the names of those that do not. */
export function sourcesOf(kind: StockKind, keys: StockKeys): { ready: boolean; missing: string[] } {
  const wanted: Array<[string, string | undefined]> = kind === "foto" ? [["Pexels", keys.PEXELS_API_KEY], ["Unsplash", keys.UNSPLASH_ACCESS_KEY], ["Pixabay", keys.PIXABAY_API_KEY]]
    : kind === "illustration" ? [["Pixabay", keys.PIXABAY_API_KEY]] : [];
  const missing = wanted.filter(([, key]) => !key).map(([name]) => name);
  return { ready: !wanted.length || missing.length < wanted.length, missing };
}

export async function searchStock(fetcher: Fetcher, keys: StockKeys, kind: StockKind, query: string): Promise<StockPicture[]> {
  const safe = <T>(p: Promise<T[]>) => p.catch(() => [] as T[]);
  if (kind === "foto") return interleave(await Promise.all([
    keys.PEXELS_API_KEY ? safe(pexels(fetcher, keys.PEXELS_API_KEY, query)) : Promise.resolve([]),
    keys.UNSPLASH_ACCESS_KEY ? safe(unsplash(fetcher, keys.UNSPLASH_ACCESS_KEY, query)) : Promise.resolve([]),
    keys.PIXABAY_API_KEY ? safe(pixabay(fetcher, keys.PIXABAY_API_KEY, query, "photo")) : Promise.resolve([])]));
  if (kind === "illustration") return keys.PIXABAY_API_KEY ? interleave(await Promise.all([safe(pixabay(fetcher, keys.PIXABAY_API_KEY, query, "illustration")), safe(pixabay(fetcher, keys.PIXABAY_API_KEY, query, "vector"))])) : [];
  return interleave(await Promise.all([safe(aic(fetcher, query)), safe(met(fetcher, query)), safe(openverse(fetcher, query))]));
}

/** The chosen picture, fetched by its id at its source, in a size fit for a poster - with a file name that says where it is from. */
export async function fetchStockPicture(fetcher: Fetcher, keys: StockKeys, source: string, id: string): Promise<{ bytes: ArrayBuffer; name: string } | null> {
  let address: string | null = null, name = "billede.jpg", headers: Record<string, string> = {};
  const clean = (text: string) => text.replace(/[^\p{L}\p{N} ._-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 90);
  if (source === "pexels" && keys.PEXELS_API_KEY && /^\d{1,12}$/.test(id)) {
    const photo = await get<{ photographer?: string; src?: { large2x?: string } }>(fetcher, `https://api.pexels.com/v1/photos/${id}`, { authorization: keys.PEXELS_API_KEY });
    address = https(photo?.src?.large2x, "https://images.pexels.com") ? photo!.src!.large2x! : null; name = clean(`Pexels ${photo?.photographer ?? ""} ${id}`);
  } else if (source === "unsplash" && keys.UNSPLASH_ACCESS_KEY && /^[A-Za-z0-9_-]{6,24}$/.test(id)) {
    const auth = { authorization: `Client-ID ${keys.UNSPLASH_ACCESS_KEY}` };
    const photo = await get<{ urls?: { raw?: string }; user?: { name?: string }; links?: { download_location?: string } }>(fetcher, `https://api.unsplash.com/photos/${id}`, auth);
    address = https(photo?.urls?.raw, "https://images.unsplash.com") ? `${photo!.urls!.raw!}&w=1800&q=85&fm=jpg` : null; name = clean(`Unsplash ${photo?.user?.name ?? ""} ${id}`);
    // Unsplash asks to be told when one of its photos is used.
    if (address && https(photo?.links?.download_location, "https://api.unsplash.com")) await fetcher(photo!.links!.download_location!, { headers: auth }).catch(() => null);
  } else if (source === "pixabay" && keys.PIXABAY_API_KEY && /^\d{1,12}$/.test(id)) {
    const data = await get<{ hits?: PixabayHit[] }>(fetcher, `https://pixabay.com/api/?${new URLSearchParams({ key: keys.PIXABAY_API_KEY, id })}`);
    const hit = data?.hits?.[0];
    address = https(hit?.largeImageURL, "https://pixabay.com") || https(hit?.largeImageURL, "https://cdn.pixabay.com") ? hit!.largeImageURL! : null; name = clean(`Pixabay ${hit?.user ?? ""} ${id}`);
  } else if (source === "aic" && /^[0-9a-f-]{36}$/.test(id)) {
    address = aicImage(id, 1686); name = `Art Institute of Chicago ${id.slice(0, 8)}`; headers = AIC_HEADERS;
  } else if (source === "met" && /^\d{1,9}$/.test(id)) {
    const object = await get<MetObject>(fetcher, `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`);
    address = object?.isPublicDomain && https(object.primaryImage, "https://images.metmuseum.org") ? object.primaryImage! : null; name = `The Met ${id}`;
  } else if (source === "openverse" && /^[0-9a-f-]{36}$/.test(id)) {
    // Openverse points to the picture where it lives (Flickr, Wikimedia ...): only CC0 and public domain, and only an address Openverse itself gives.
    const image = await get<OpenverseImage>(fetcher, `https://api.openverse.org/v1/images/${id}/`);
    address = image && (image.license === "cc0" || image.license === "pdm") && https(image.url) ? image.url! : null; name = clean(`Openverse ${image?.source ?? ""} ${id.slice(0, 8)}`);
  }
  if (!address) return null;
  const response = await fetcher(address, { headers }).catch(() => null);
  if (!response?.ok) return null;
  return { bytes: await response.arrayBuffer(), name: `${name}.jpg` };
}

// ---- What to search for ----

export type PictureIdeas = Record<StockKind, string[]>;

/** What to search for, from the event: Saga's proposal (the cheap model), else a few words by the event's kind. English - the collections are. */
export async function pictureIdeas(env: SagaEnv, deps: SagaDeps, event: { title: string; description: string; category: string | null }): Promise<PictureIdeas> {
  const text = `${event.title} ${event.category ?? ""} ${event.description}`.toLowerCase();
  const plain: PictureIdeas = /lyd|sound|gong|syngeskål|bowl/.test(text) ? { foto: ["singing bowl", "gong sound", "candle calm"], illustration: ["sound waves", "moon watercolor"], kunst: ["moon night", "waves"] }
    : /yoga|yin/.test(text) ? { foto: ["yoga mat sunlight", "calm morning light", "plants window"], illustration: ["lotus line art", "leaves watercolor"], kunst: ["lotus", "japanese landscape"] }
    : /dans|dance/.test(text) ? { foto: ["dance movement", "flowing fabric", "sunrise"], illustration: ["dancer silhouette", "abstract flow"], kunst: ["dancer", "birds flight"] }
    : /healing|engle|angel|reiki/.test(text) ? { foto: ["hands light", "feather", "soft light"], illustration: ["feather watercolor", "angel wings line art"], kunst: ["angel", "flowers"] }
    : /meditation|nærvær|mindful/.test(text) ? { foto: ["candle calm", "stones balance", "forest light"], illustration: ["zen circle", "mountain watercolor"], kunst: ["landscape mist", "moon"] }
    : /film|movie|kino/.test(text) ? { foto: ["cinema lights", "popcorn cozy", "film projector"], illustration: ["film reel", "stars night"], kunst: ["evening", "lanterns"] }
    : /café|cafe|fællesspis/.test(text) ? { foto: ["tea cups table", "warm cafe", "bread table"], illustration: ["tea cup watercolor", "coffee line art"], kunst: ["still life", "tea"] }
    : { foto: ["nature light", "autumn leaves", "calm water"], illustration: ["leaves watercolor", "botanical line art"], kunst: ["botanical", "flowers", "landscape"] };
  if (!env.AI_API_KEY || !env.AI_MODEL) return plain;
  const raw = await completeAs("stock-ideas", true, 250)(env, deps, [
    { role: "system", content: "Du finder stemningsbilleder til et opslag om et event i Hjerterum (meditation, yoga, lyd, krop, fællesskab). Giv korte ENGELSKE søgeord (1-3 ord hver): 4 til fotos af natur, lys, genstande eller hænder - aldrig ansigter eller genkendelige personer - 3 til illustrationer (akvarel, stregtegning, vektor) og 3 til gamle kunstværker og botaniske tegninger. Svar KUN med JSON: {\"foto\": [...], \"illustration\": [...], \"kunst\": [...]}" },
    { role: "user", content: JSON.stringify({ titel: event.title, kategori: event.category, beskrivelse: event.description.slice(0, 800) }) }]).catch(() => "");
  try {
    const data = JSON.parse(/\{[\s\S]*\}/.exec(raw)?.[0] ?? "{}") as Record<string, unknown>;
    const clean = (v: unknown) => Array.isArray(v) ? v.filter((s): s is string => typeof s === "string").map(s => s.replace(/[^\p{L}\p{N} -]/gu, "").trim().slice(0, 40)).filter(Boolean).slice(0, 4) : [];
    const pick = (k: StockKind) => { const list = clean(data[k]); return list.length ? list : plain[k]; };
    return { foto: pick("foto"), illustration: pick("illustration"), kunst: pick("kunst") };
  } catch { return plain; }
}
