import { readCookies, readPreview } from "./cockpit/auth.js";
import { isCockpitRequest } from "./cockpit/handler.js";
import { MAIL_LOGO_PATH } from "./mail-template.js";

/** The chair (27 Nov 2026): "Siden skal nu kun kunne ses af Douglas og jeg" - "Alle i board admin kan se". While SITE_CLOSED is "1", the website and
 * the member pages (every address but admin's) show only a short "opens soon" page - to everyone but those let in from admin (power "site.preview":
 * the chair and Douglas), who get a key in a cookie for the whole domain (cockpit/handler.ts /hjemmeside-adgang). Admin is as before. What machines
 * call stays open: /api/* (webhooks from Telegram, Stripe and Clerk, the pictures and reels Facebook and Instagram fetch), and the member API asks for
 * its own login anyway. Search engines are told to stay away. */
export const PREVIEW_COOKIE = "hjerterum_preview";
export const PREVIEW_PATH = "/__adgang";

type ClosedEnv = { SITE_CLOSED?: string; SAGA_TELEGRAM_BOT_TOKEN?: string };

const domainOf = (hostname: string) => hostname.split(".").slice(-2).join(".");
const NOINDEX = { "x-robots-tag": "noindex, nofollow", "cache-control": "no-store" };

const CLOSED_PAGE = `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>Hjerterum</title><style>:root{color-scheme:light dark;--bg:#f6f1ea;--ink:#2b2622;--muted:#7a6f66}@media (prefers-color-scheme:dark){:root{--bg:#1d1a17;--ink:#f1ebe3;--muted:#b3a89d}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:17px/1.6 Georgia,serif;padding:24px;box-sizing:border-box;text-align:center}
main{max-width:520px}h1{font-weight:400;font-size:40px;margin:0 0 12px;letter-spacing:.02em}p{margin:0 0 10px;color:var(--muted)}</style></head>
<body><main><img src="/logo.png" alt="" width="64" height="64" style="opacity:.85;margin-bottom:18px"><h1>Hjerterum</h1><p>Vores nye hjemmeside er på vej og åbner snart.</p><p lang="en">Our new website is on its way and opens soon.</p>{{WAY_IN}}</main></body></html>`;

/** Douglas could not get in (the chair, 27 Nov 2026: "Douglas kan ikke komme ind nu ... Det er en fejl"): the page itself shows the way in - through
 * admin, which knows who may see the site and sends them back to the page they asked for. */
function closedPage(url: URL): string {
  const admin = `https://admin.${domainOf(url.hostname)}/hjemmeside-adgang?vaert=${encodeURIComponent(url.hostname)}&til=${encodeURIComponent(url.pathname + url.search)}`;
  return CLOSED_PAGE.replace("{{WAY_IN}}", `<p style="margin-top:28px;font-size:14px"><a href="${admin.replace(/&/g, "&amp;")}" style="color:inherit">Bestyrelsen: log ind for at se siden →</a></p>`);
}
/** Where the key may send its holder on: a path on the website's own addresses. */
export function wayBack(host: string | null, path: string | null, domain: string): string {
  const okHost = host && (host === domain || host.endsWith(`.${domain}`)) && !/^(?:admin|cockpit)\./i.test(host) ? host : `www.${domain}`;
  const okPath = path && path.startsWith("/") && !path.startsWith("//") ? path : "/";
  return `https://${okHost}${okPath}`;
}

/** The answer for a closed website, or null when the request goes on as usual. */
export async function siteClosedResponse(request: Request, env: ClosedEnv, nowMs: number): Promise<Response | null> {
  if (env.SITE_CLOSED !== "1") return null;
  const url = new URL(request.url);
  // The logo in the system's mails (mail-template.ts) shows in the inbox while the website is closed too.
  if (isCockpitRequest(url) || url.pathname.startsWith("/api/") || url.pathname === "/logo.png" || url.pathname === MAIL_LOGO_PATH) return null;
  if (url.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n", { headers: { "content-type": "text/plain; charset=utf-8", ...NOINDEX } });
  // The key from admin: kept for the whole domain (www and medlem), then on to the front page.
  if (url.pathname === PREVIEW_PATH && request.method === "GET") {
    const token = url.searchParams.get("t") ?? "";
    if (!(await readPreview(env.SAGA_TELEGRAM_BOT_TOKEN, token, nowMs))) return new Response(closedPage(url), { status: 403, headers: { "content-type": "text/html; charset=utf-8", ...NOINDEX } });
    const secure = url.protocol === "https:";
    const cookie = `${PREVIEW_COOKIE}=${token}; Domain=${domainOf(url.hostname)}; Path=/; Max-Age=${30 * 86_400}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
    const til = url.searchParams.get("til");
    return new Response(null, { status: 302, headers: { location: til && til.startsWith("/") && !til.startsWith("//") ? til : "/", "set-cookie": cookie, ...NOINDEX } });
  }
  if (await readPreview(env.SAGA_TELEGRAM_BOT_TOKEN, readCookies(request).get(PREVIEW_COOKIE), nowMs)) return null;
  return new Response(request.method === "HEAD" ? null : closedPage(url), { status: 503, headers: { "content-type": "text/html; charset=utf-8", "retry-after": "86400", ...NOINDEX } });
}
