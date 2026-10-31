/** Requested: "Vi skal have fem varianter systemet kan vælge mellem" - posters drawn on a canvas in the browser (src/event-poster.ts).
 * A canvas with a photo from another address cannot be saved, so the membership system's event photos come through here.
 * Only that system's photo host, only pictures, at most 8 MB. */

const ALLOWED = /^https:\/\/d1tif55lvfk8gc\.cloudfront\.net\/[A-Za-z0-9._-]+\.(?:jpe?g|png|webp|gif)(?:\?[0-9]*)?$/i;
const MAX_BYTES = 8 * 1024 * 1024;

export const posterImageAllowed = (src: string | null): src is string => Boolean(src && ALLOWED.test(src));

export async function posterImage(src: string | null, fetcher: typeof fetch = fetch): Promise<Response> {
  if (!posterImageAllowed(src)) return Response.json({ error: "not_allowed" }, { status: 400 });
  const upstream = await fetcher(src).catch(() => null);
  const type = upstream?.headers.get("content-type") ?? "";
  if (!upstream?.ok || !/^image\//.test(type)) return Response.json({ error: "not_found" }, { status: 404 });
  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return Response.json({ error: "too_large" }, { status: 413 });
  return new Response(body, { headers: { "content-type": type, "cache-control": "public, max-age=86400" } });
}
