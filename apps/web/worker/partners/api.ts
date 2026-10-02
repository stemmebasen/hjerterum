import type { D1Database } from "../db.js";
import { partnerEventDestination, publicPartnerEvents } from "./partners.js";

/** The public side of partner events: the calendar list and the counted way out to the partner.
 * The member list (with how to get the discount) is served in entry.ts, behind the member check. */

const json = (data: unknown, status = 200, cache = "no-store") =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache } });

export async function handlePartnerEventsRequest(request: Request, db: D1Database | undefined, nowMs: number): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "GET" || !url.pathname.startsWith("/api/events/partners")) return null;
  if (url.pathname === "/api/events/partners") {
    if (!db) return json({ error: "database_unbound" }, 503);
    try { return json(await publicPartnerEvents(db, nowMs), 200, "public, max-age=60, s-maxage=300"); }
    catch { return json({ error: "partner_events_unavailable" }, 503); }
  }
  const go = /^\/api\/events\/partners\/(\d{1,12})\/go$/.exec(url.pathname);
  if (!go) return null;
  if (!db) return json({ error: "database_unbound" }, 503);
  // Only to the address the partner's own calendar gave for this event - never a URL from the request.
  const destination = await partnerEventDestination(db, Number(go[1]), url.searchParams.get("fra") === "medlem", nowMs).catch(() => null);
  if (!destination) return json({ error: "not_found" }, 404);
  return new Response(null, { status: 302, headers: { location: destination, "cache-control": "no-store", "x-robots-tag": "noindex" } });
}
