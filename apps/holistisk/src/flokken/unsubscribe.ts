import type { D1Database } from "../db.js";
import { eventBySlug } from "../web/queries.js";
import { eventPath } from "../web/components.js";
import { html } from "../web/html.js";
import { crumbsNav, page, type Crumb, type PageContext } from "../web/layout.js";
import { prefByToken, setUnsubscribed, UNSUBSCRIBE_PATH, validMailToken, WITHDRAW_PATH, type MailPref } from "../mailPrefs.js";
import { removeInterest } from "./kickoff.js";
import type { View } from "./pages.js";

/** The pages behind the links in the mails (Jake 2026-11-25): unsubscribe from Socialklubben's mails, and take one's
 * interest in an arrangement off the list. Opening a link only shows a button, because mail programs open links to check
 * them; pressing it does the thing. The one exception is the mail programs' own one-click unsubscribe (RFC 8058), a POST
 * with "List-Unsubscribe=One-Click", which unsubscribes at once. */

const PRIVATE = { "cache-control": "private, no-store" };
const SLUG = /^[a-z0-9-]{1,90}$/;

async function readToken(request: Request, url: URL): Promise<{ token: string | null; form: FormData | null }> {
  const form = request.method === "POST" ? await request.formData().catch(() => null) : null;
  const raw = String(form?.get("t") ?? "") || url.searchParams.get("t");
  return { token: validMailToken(raw) ? raw : null, form };
}

/** GET /afmeld?t=… shows the button; POST unsubscribes (or, with gen=1, subscribes again). */
export async function unsubscribeRoute(request: Request, db: D1Database, pc: PageContext, url: URL, now: number): Promise<View> {
  const { token, form } = await readToken(request, url);
  const pref = token ? await prefByToken(db, token) : null;
  if (!pref) return unsubscribePage(pc, { error: true });
  if (request.method !== "POST") return unsubscribePage(pc, { pref });
  const again = String(form?.get("gen") ?? "") === "1";
  await setUnsubscribed(db, pref.token, !again, now);
  return unsubscribePage(pc, { pref: { ...pref, unsubscribed_at: again ? null : pref.unsubscribed_at ?? now }, done: again ? "again" : "out" });
}

function unsubscribePage(ctx: PageContext, state: { pref?: MailPref; done?: "out" | "again"; error?: boolean }): View {
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Afmeld mails", path: UNSUBSCRIBE_PATH }];
  const p = state.pref;
  const out = p?.unsubscribed_at != null;
  const title = !p ? "Linket virker ikke" : out ? "Du er afmeldt" : state.done === "again" ? "Du får mails igen" : "Afmeld mails fra Socialklubben";
  const form = (again: boolean, label: string) => html`<form method="post" action="${UNSUBSCRIBE_PATH}">
      <input type="hidden" name="t" value="${p!.token}">${again ? html`<input type="hidden" name="gen" value="1">` : ""}
      <div class="form-actions"><button type="submit"${again ? html` class="button-secondary"` : ""}>${label}</button></div>
    </form>`;
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>${title}</h1>
  </header>
  ${!p
    ? html`<p>Linket er ikke gyldigt længere. Skriv til os på <a href="mailto:kontakt@socialklubben.dk">kontakt@socialklubben.dk</a>, så hjælper vi dig.</p>`
    : out
      ? html`<div class="form-card">
      <p>Vi sender ikke flere mails til <strong>${p.email}</strong>.</p>
      <p>Beder du selv om et link til at logge ind, får du det stadig.</p>
      <p>Står du på listen til et arrangement, kan du se og fjerne det under <a href="/flokke">Mine flokke</a>.</p>
    </div>
    <p>Har du fortrudt?</p>
    ${form(true, "Ja tak, send mig mails igen")}`
      : html`<div class="form-card">
      ${state.done === "again" ? html`<p>Velkommen tilbage. Vi sender igen mails til <strong>${p.email}</strong>.</p>` : html`<p>Vil du ikke have flere mails fra Socialklubben til <strong>${p.email}</strong>?</p>
      <p>Så tryk på knappen. Du kan altid ændre det igen.</p>`}
    </div>
    ${state.done === "again" ? html`<p class="more-line"><a class="button" href="/kalender">Se kalenderen</a></p>` : form(false, "Afmeld mails")}`}
</div>`;
  return { status: p ? 200 : 400, headers: PRIVATE, body: page(ctx, { title: "Afmeld mails – Socialklubben", description: "Afmeld mails fra Socialklubben.", canonical: UNSUBSCRIBE_PATH, noindex: true, breadcrumbs: crumbs }, body) };
}

type Withdraw = { error: true } | { token: string; slug: string; title: string; path: string; listed: boolean };

/** GET /afmeld/interesse?t=…&a=<slug> shows the button; POST takes the interest off the list. */
export async function withdrawRoute(request: Request, db: D1Database, pc: PageContext, url: URL): Promise<View> {
  const { token, form } = await readToken(request, url);
  const slug = String(form?.get("a") ?? "") || url.searchParams.get("a") || "";
  const pref = token && SLUG.test(slug) ? await prefByToken(db, token) : null;
  const e = pref ? await eventBySlug(db, slug) : null;
  const member = pref ? await db.prepare("SELECT id FROM members WHERE lower(email) = ?").bind(pref.email).first<{ id: string }>() : null;
  if (!pref || !e || !member) return withdrawPage(pc, { error: true });
  const listed = async () => !!(await db.prepare("SELECT 1 AS y FROM event_interests WHERE member_id = ? AND event_id = ? AND status = 'waiting'").bind(member.id, e.id).first());
  const state = { token: pref.token, slug, title: e.title, path: eventPath(e) };
  if (request.method !== "POST") return withdrawPage(pc, { ...state, listed: await listed() });
  await removeInterest(db, member.id, slug);
  return withdrawPage(pc, { ...state, listed: false }, true);
}

function withdrawPage(ctx: PageContext, s: Withdraw, done = false): View {
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "Fjern mig fra listen", path: WITHDRAW_PATH }];
  const title = "error" in s ? "Linket virker ikke" : done ? "Du er fjernet fra listen" : s.listed ? "Fjern mig fra listen" : "Du står ikke på listen";
  const body = html`
<div class="wrap narrow">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <h1>${title}</h1>
  </header>
  ${"error" in s
    ? html`<p>Linket er ikke gyldigt længere. Du kan se og fjerne dine arrangementer under <a href="/flokke">Mine flokke</a>.</p>`
    : s.listed
      ? html`<form class="form-card" method="post" action="${WITHDRAW_PATH}">
      <input type="hidden" name="t" value="${s.token}"><input type="hidden" name="a" value="${s.slug}">
      <p>Vil du fjernes fra listen til <strong>${s.title}</strong>?</p>
      <p>Så samler vi ikke en flok med dig til det, og du får ikke flere mails om det.</p>
      <div class="form-actions"><button type="submit">Ja, fjern mig fra listen</button></div>
    </form>`
      : html`<div class="form-card">
      <p>${done ? "Tak for besked. Du står ikke længere på listen til" : "Du står ikke på listen til"} <strong>${s.title}</strong>.</p>
      <p>Fortryder du, kan du altid trykke "Jeg vil gerne med!" igen på arrangementets side.</p>
    </div>
    <p class="more-line"><a class="button" href="${s.path}">Se arrangementet</a> <a class="button button-secondary" href="/kalender">Se kalenderen</a></p>`}
</div>`;
  return { status: "error" in s ? 400 : 200, headers: PRIVATE, body: page(ctx, { title: "Fjern mig fra listen – Socialklubben", description: "Fjern dig fra listen til et arrangement.", canonical: WITHDRAW_PATH, noindex: true, breadcrumbs: crumbs }, body) };
}
