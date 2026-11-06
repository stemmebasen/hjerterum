import { completeAs } from "../saga/ai.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";

/** Asked (the chair, 6 Nov 2026): "Vi skal gøre det kreative værksted langt bedre og med flere designs ... lad os koble pexels api på" - and of the free
 * sources offered, "Kunst og botanik (CC0)". Pictures to search for in Plakater og opslag: photos from Pexels (with its key, PEXELS_API_KEY), and public
 * domain art from the Art Institute of Chicago and The Met (CC0, no key). The chosen one is fetched by the server - by its id, never by an address from the
 * browser - and kept with the event's material (mailMaterial.ts storeUpload). Saga proposes what to search for: nature, light, things and hands - not faces,
 * so no stranger looks like one of Hjerterum's own. */

export type StockSource = "pexels" | "kunst";
export type StockPicture = { source: "pexels" | "aic" | "met"; id: string; thumb: string; label: string; credit: string; link: string };
type Fetcher = SagaDeps["fetcher"];

/** Hosts the studio may show thumbnails from (its content security policy). */
export const STOCK_IMAGE_HOSTS = ["https://images.pexels.com", "https://www.artic.edu", "https://images.metmuseum.org"];

const json = async <T>(response: Response): Promise<T | null> => response.ok ? await response.json().catch(() => null) as T | null : null;

export async function searchPexels(fetcher: Fetcher, key: string, query: string): Promise<StockPicture[]> {
  type Photo = { id: number; url?: string; alt?: string; photographer?: string; src?: { medium?: string } };
  const data = await json<{ photos?: Photo[] }>(await fetcher(`https://api.pexels.com/v1/search?${new URLSearchParams({ query, per_page: "24" })}`, { headers: { authorization: key, accept: "application/json" } }));
  return (data?.photos ?? []).filter(p => p.src?.medium?.startsWith("https://images.pexels.com/")).map(p => ({ source: "pexels" as const, id: String(p.id), thumb: p.src!.medium!,
    label: p.alt || "Foto fra Pexels", credit: `Foto: ${p.photographer ?? "ukendt"} / Pexels`, link: p.url ?? "https://www.pexels.com" }));
}

const AIC_HEADERS = { accept: "application/json", "AIC-User-Agent": "Hjerterum (admin.hjerterum.info)" };
const aicImage = (imageId: string, width: number) => `https://www.artic.edu/iiif/2/${imageId}/full/${width},/0/default.jpg`;

export async function searchArt(fetcher: Fetcher, query: string): Promise<StockPicture[]> {
  type Work = { id: number; title?: string; image_id?: string | null; artist_title?: string | null; is_public_domain?: boolean };
  const aic = json<{ data?: Work[] }>(await fetcher(`https://api.artic.edu/api/v1/artworks/search?${new URLSearchParams({ q: query, "query[term][is_public_domain]": "true", fields: "id,title,image_id,artist_title,is_public_domain", limit: "18" })}`,
    { headers: AIC_HEADERS }).catch(() => new Response(null, { status: 502 }))).then(d => (d?.data ?? []).filter(w => w.image_id && w.is_public_domain !== false && /^[0-9a-f-]{36}$/.test(w.image_id)).map(w => ({
      source: "aic" as const, id: w.image_id!, thumb: aicImage(w.image_id!, 400), label: w.title ?? "Kunstværk", credit: `${w.artist_title ? `${w.artist_title}: ` : ""}${w.title ?? ""} (Art Institute of Chicago, CC0)`,
      link: `https://www.artic.edu/artworks/${w.id}` })));
  type MetObject = { objectID: number; title?: string; artistDisplayName?: string; isPublicDomain?: boolean; primaryImageSmall?: string; objectURL?: string };
  const met = (async () => {
    const found = await json<{ objectIDs?: number[] | null }>(await fetcher(`https://collectionapi.metmuseum.org/public/collection/v1/search?${new URLSearchParams({ hasImages: "true", q: query })}`, { headers: { accept: "application/json" } }).catch(() => new Response(null, { status: 502 })));
    const objects = await Promise.all((found?.objectIDs ?? []).slice(0, 8).map(id => fetcher(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`, { headers: { accept: "application/json" } })
      .then(r => json<MetObject>(r)).catch(() => null)));
    return objects.filter((o): o is MetObject => Boolean(o?.isPublicDomain && o.primaryImageSmall?.startsWith("https://images.metmuseum.org/"))).map(o => ({
      source: "met" as const, id: String(o.objectID), thumb: o.primaryImageSmall!, label: o.title ?? "Kunstværk", credit: `${o.artistDisplayName ? `${o.artistDisplayName}: ` : ""}${o.title ?? ""} (The Met, CC0)`,
      link: o.objectURL ?? "https://www.metmuseum.org" }));
  })().catch(() => [] as StockPicture[]);
  const [a, m] = await Promise.all([aic, met]);
  // Taken in turn, so both collections are seen.
  const out: StockPicture[] = [];
  for (let i = 0; i < Math.max(a.length, m.length); i++) { if (a[i]) out.push(a[i]!); if (m[i]) out.push(m[i]!); }
  return out.slice(0, 24);
}

/** The chosen picture, fetched by its id at its source, in a size fit for a poster - with a file name that says where it is from. */
export async function fetchStockPicture(fetcher: Fetcher, key: string | undefined, source: string, id: string): Promise<{ bytes: ArrayBuffer; name: string } | null> {
  let address: string | null = null, name = "billede.jpg";
  if (source === "pexels" && key && /^\d{1,12}$/.test(id)) {
    const photo = await json<{ photographer?: string; src?: { large2x?: string } }>(await fetcher(`https://api.pexels.com/v1/photos/${id}`, { headers: { authorization: key, accept: "application/json" } }));
    address = photo?.src?.large2x ?? null;
    name = `Pexels ${photo?.photographer ?? ""} ${id}.jpg`.replace(/[^\p{L}\p{N} ._-]/gu, "").replace(/\s+/g, " ");
  } else if (source === "aic" && /^[0-9a-f-]{36}$/.test(id)) {
    address = aicImage(id, 1686); name = `Art Institute of Chicago ${id.slice(0, 8)}.jpg`;
  } else if (source === "met" && /^\d{1,9}$/.test(id)) {
    const object = await json<{ isPublicDomain?: boolean; primaryImage?: string; title?: string }>(await fetcher(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`, { headers: { accept: "application/json" } }));
    address = object?.isPublicDomain ? object.primaryImage ?? null : null; name = `The Met ${id}.jpg`;
  }
  if (!address || !STOCK_IMAGE_HOSTS.some(h => address!.startsWith(`${h}/`))) return null;
  const response = await fetcher(address, { headers: source === "aic" ? AIC_HEADERS : {} }).catch(() => null);
  if (!response?.ok) return null;
  return { bytes: await response.arrayBuffer(), name };
}

/** What to search for, from the event: Saga's proposal (the cheap model), else a few words by the event's kind. English - the collections are. */
export async function pictureIdeas(env: SagaEnv, deps: SagaDeps, event: { title: string; description: string; category: string | null }): Promise<{ foto: string[]; kunst: string[] }> {
  const text = `${event.title} ${event.category ?? ""} ${event.description}`.toLowerCase();
  const plain = /lyd|sound|gong|syngeskål|bowl/.test(text) ? { foto: ["singing bowl", "gong sound", "candle calm"], kunst: ["moon night", "waves"] }
    : /yoga|yin/.test(text) ? { foto: ["yoga mat sunlight", "calm morning light", "plants window"], kunst: ["lotus", "japanese landscape"] }
    : /dans|dance/.test(text) ? { foto: ["dance movement", "flowing fabric", "sunrise"], kunst: ["dancer", "birds flight"] }
    : /healing|engle|angel|reiki/.test(text) ? { foto: ["hands light", "feather", "soft light"], kunst: ["angel", "flowers"] }
    : /meditation|nærvær|mindful/.test(text) ? { foto: ["candle calm", "stones balance", "forest light"], kunst: ["landscape mist", "moon"] }
    : /film|movie|kino/.test(text) ? { foto: ["cinema lights", "popcorn cozy", "film projector"], kunst: ["evening", "lanterns"] }
    : /café|cafe|fællesspis/.test(text) ? { foto: ["tea cups table", "warm cafe", "bread table"], kunst: ["still life", "tea"] }
    : { foto: ["nature light", "autumn leaves", "calm water"], kunst: ["botanical", "flowers", "landscape"] };
  if (!env.AI_API_KEY || !env.AI_MODEL) return plain;
  const raw = await completeAs("stock-ideas", true, 200)(env, deps, [
    { role: "system", content: "Du finder stemningsbilleder til et opslag om et event i Hjerterum (meditation, yoga, lyd, krop, fællesskab). Giv korte ENGELSKE søgeord (1-3 ord hver): 4 til fotos af natur, lys, genstande eller hænder - aldrig ansigter eller genkendelige personer - og 3 til gamle kunstværker og botaniske tegninger. Svar KUN med JSON: {\"foto\": [...], \"kunst\": [...]}" },
    { role: "user", content: JSON.stringify({ titel: event.title, kategori: event.category, beskrivelse: event.description.slice(0, 800) }) }]).catch(() => "");
  try {
    const data = JSON.parse(/\{[\s\S]*\}/.exec(raw)?.[0] ?? "{}") as { foto?: unknown; kunst?: unknown };
    const clean = (v: unknown) => Array.isArray(v) ? v.filter((s): s is string => typeof s === "string").map(s => s.replace(/[^\p{L}\p{N} -]/gu, "").trim().slice(0, 40)).filter(Boolean).slice(0, 4) : [];
    const foto = clean(data.foto), kunst = clean(data.kunst);
    return { foto: foto.length ? foto : plain.foto, kunst: kunst.length ? kunst : plain.kunst };
  } catch { return plain; }
}
