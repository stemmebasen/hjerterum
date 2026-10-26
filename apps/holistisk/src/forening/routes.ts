import type { D1Database } from "../db.js";
import type { Env } from "../env.js";
import { clearSessionCookie, currentMember, endSession, memberByCode, normalizeCode, startSession } from "../flokken/auth.js";
import { readInquiry, saveInquiry, validateInquiry } from "../flokken/partners.js";
import type { PageContext } from "../web/layout.js";
import type { View } from "../web/pages.js";
import { sitemapXml } from "../web/seo.js";
import * as admin from "./admin.js";
import { emptyInterestForm, emptyPickForm, pickForm, readInterestForm, readPickForm, validateInterestForm, validatePickForm } from "./forms.js";
import * as pages from "./pages.js";
import { adminPicks, countInterests, createPick, deleteInterests, eventById, fieldsFromEvent, isAdmin, listInterests, pickById, pickBySlug, saveInterest, suggestions, upcomingPicks, updatePick } from "./store.js";

/** Flokk as an association: every page and form. Returns null for an address it does not have. */

export type ForeningResult =
  | { view: View; cookie?: string }
  | { redirect: string; cookie?: string }
  | { file: { body: string; type: string; name: string } }
  | { xml: string };

const go = (to: string, cookie?: string): ForeningResult => ({ redirect: to, ...(cookie ? { cookie } : {}) });
const MESSAGES: Record<string, string> = { godkendt: "Eventet er godkendt. Tjek oplysningerne, og ret dem, hvis noget mangler.", gemt: "Gemt.", oprettet: "Eventet er oprettet og vises på siden." };

export async function foreningRoute(request: Request, env: Env, db: D1Database, ctx: PageContext, regions: string[], path: string, url: URL, now: number): Promise<ForeningResult | null> {
  const post = request.method === "POST";
  const form = post ? await request.formData().catch(() => new FormData()) : null;
  // Forms carry a field people never see; a filled one is a robot, answered as if all went well.
  const robot = !!form && String(form.get("website_url") ?? "") !== "";

  if (path === "/" && !post) return { view: pages.homePage(ctx, await upcomingPicks(db, now), Math.floor(Math.random() * pages.HEADLINES.length)) };
  if (path === "/udflugter" && !post) return { view: pages.picksPage(ctx, await upcomingPicks(db, now)) };
  if (path === "/saadan-fungerer-det" && !post) return { view: pages.howPage(ctx) };
  // Earlier addresses.
  if (path === "/maanedens-events") return go("/udflugter");
  if (path === "/tryghed") return go("/saadan-fungerer-det");
  if (path === "/for-foreninger") return go("/for-arrangoerer");
  if (path === "/om" && !post) return { view: pages.aboutPage(ctx) };
  if (path === "/samarbejde") return go("/for-arrangoerer");
  if (path === "/sitemap.xml") {
    const picks = await upcomingPicks(db, now);
    return { xml: sitemapXml(ctx.origin, ["/", "/udflugter", "/saadan-fungerer-det", "/skriv-dig-op", "/for-arrangoerer", "/om", "/privatliv"], picks.map(p => ({ slug: p.slug, updated_at: p.updated_at }))) };
  }

  const slug = /^\/events\/([a-z0-9-]{1,90})$/.exec(path)?.[1];
  if (slug && !post) {
    const pick = await pickBySlug(db, slug);
    return pick && pick.status === "approved" ? { view: pages.pickPage(ctx, pick) } : null;
  }

  if (path === "/skriv-dig-op") {
    const picks = await upcomingPicks(db, now);
    if (!post) {
      const wanted = url.searchParams.get("event") ?? "";
      return { view: pages.signupPage(ctx, picks, { form: emptyInterestForm(picks.some(p => p.slug === wanted) ? wanted : "") }) };
    }
    const f = readInterestForm(form!);
    const { errors, fields } = validateInterestForm(f, ctx.areas.map(a => a.slug), picks.map(p => p.slug));
    if (Object.keys(errors).length) return { view: pages.signupPage(ctx, picks, { form: f, errors, status: 400 }) };
    const pick = picks.find(p => p.slug === fields.pick) ?? null;
    if (!robot) await saveInterest(db, { ...fields, pick_id: pick?.id ?? null }, now);
    return { view: pages.thanksPage(ctx, fields.first_name, pick) };
  }

  if (path === "/for-arrangoerer") {
    if (!post) return { view: pages.organisersPage(ctx) };
    const f = readInquiry(form!);
    const errors = validateInquiry(f);
    if (Object.keys(errors).length) return { view: pages.organisersPage(ctx, { form: f, errors, status: 400 }) };
    if (!robot) await saveInquiry(db, f, now);
    return { view: pages.organisersPage(ctx, { sent: true }) };
  }

  if (path === "/privatliv") {
    if (!post) return { view: pages.privacyPage(ctx) };
    const email = String(form!.get("email") ?? "").trim();
    if (!robot && email) await deleteInterests(db, email);
    return { view: pages.privacyPage(ctx, { deleted: true }) };
  }

  // The volunteers: log in with a personal code that belongs to an admin.
  if (path === "/log-ind") {
    if (!post) return { view: admin.loginPage(ctx) };
    const code = normalizeCode(String(form!.get("kode") ?? ""));
    const member = code ? await memberByCode(db, code) : null;
    if (!member || !(await isAdmin(db, member.id))) return { view: admin.loginPage(ctx, { error: "Koden giver ikke adgang. Tjek den, og prøv igen.", status: 401 }) };
    return go("/admin", await startSession(db, member.id, now));
  }
  if (path === "/log-ud") {
    if (post) await endSession(db, request);
    return go("/", clearSessionCookie());
  }

  if (path === "/admin" || path.startsWith("/admin/")) {
    const member = await currentMember(db, request, now);
    if (!member || !(await isAdmin(db, member.id))) return go("/log-ind");
    const message = MESSAGES[url.searchParams.get("besked") ?? ""] ?? null;

    if (path === "/admin" && !post) {
      const [picks, people, inquiries] = await Promise.all([adminPicks(db, now), countInterests(db), db.prepare("SELECT COUNT(*) AS n FROM partner_inquiries").first<{ n: number }>()]);
      return { view: admin.overviewPage(ctx, picks, people.people, inquiries?.n ?? 0, message) };
    }
    if (path === "/admin/forslag") {
      if (!post) {
        const q = (url.searchParams.get("q") ?? "").slice(0, 100);
        return { view: admin.suggestionsPage(ctx, await suggestions(db, regions, now, q), q) };
      }
      const event = await eventById(db, String(form!.get("event") ?? ""));
      if (!event) return go("/admin/forslag");
      const existing = await db.prepare("SELECT id FROM picks WHERE event_id = ?").bind(event.id).first<{ id: string }>();
      const pick = existing ?? await createPick(db, fieldsFromEvent(event), event.id, member.id, now);
      return go(`/admin/events/${pick.id}?besked=godkendt`);
    }
    if (path === "/admin/events/ny") {
      if (!post) return { view: admin.pickFormPage(ctx, emptyPickForm(), {}) };
      const f = readPickForm(form!);
      const { errors, fields } = validatePickForm(f);
      if (!fields) return { view: admin.pickFormPage(ctx, f, { errors, status: 400 }) };
      const pick = await createPick(db, fields, null, member.id, now);
      return go(`/admin/events/${pick.id}?besked=oprettet`);
    }
    const id = /^\/admin\/events\/([0-9a-f-]{36})$/.exec(path)?.[1];
    if (id) {
      const pick = await pickById(db, id);
      if (!pick) return null;
      if (!post) return { view: admin.pickFormPage(ctx, pickForm(pick), { id, message }) };
      const f = readPickForm(form!);
      const { errors, fields } = validatePickForm(f);
      if (!fields) return { view: admin.pickFormPage(ctx, f, { id, errors, status: 400 }) };
      await updatePick(db, id, fields, now);
      return go(`/admin/events/${id}?besked=gemt`);
    }
    if (path === "/admin/interesseliste" && !post) return { view: admin.interestsPage(ctx, await listInterests(db)) };
    if (path === "/admin/interesseliste.csv" && !post) {
      return { file: { body: admin.interestsCsv(await listInterests(db)), type: "text/csv; charset=utf-8", name: `flokken-interesseliste-${new Date(now).toISOString().slice(0, 10)}.csv` } };
    }
    if (path === "/admin/henvendelser" && !post) {
      const { results } = await db.prepare("SELECT organisation, contact_name, email, website, message, created_at FROM partner_inquiries ORDER BY created_at DESC LIMIT 500")
        .all<{ organisation: string; contact_name: string; email: string; website: string | null; message: string | null; created_at: number }>();
      return { view: admin.inquiriesPage(ctx, results) };
    }
  }
  return null;
}
