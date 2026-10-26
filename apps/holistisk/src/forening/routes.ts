import type { D1Database } from "../db.js";
import type { Env } from "../env.js";
import { clearSessionCookie, endSession, memberByCode, normalizeCode, safeNext, startSession } from "../flokken/auth.js";
import { readInquiry, saveInquiry, validateInquiry } from "../flokken/partners.js";
import type { PageContext } from "../web/layout.js";
import type { View } from "../web/pages.js";
import { sitemapXml } from "../web/seo.js";
import * as admin from "./admin.js";
import { emptyInterestForm, emptyPickForm, pickForm, readInterestForm, readPickForm, validateInterestForm, validatePickForm } from "./forms.js";
import * as pages from "./pages.js";
import * as memberPages from "./memberPages.js";
import {
  cancelByFlokk, cancelSignup, counts, countsFor, currentFlokkMember, fillFromWaitlist, flockFirstNames, isFlokkMember, joinFlokk, leaveFlokk,
  listMembers, memberById, memberSignups, mySignup, participants, renewCode, signUp
} from "./members.js";
import { adminPicks, countInterests, createPick, deleteInterests, eventById, fieldsFromEvent, listInterests, pickById, pickBySlug, suggestions, upcomingPicks, updatePick } from "./store.js";

/** Flokk: every page and form. Returns null for an address it does not have. */

export type ForeningResult =
  | { view: View; cookie?: string }
  | { redirect: string; cookie?: string }
  | { file: { body: string; type: string; name: string } }
  | { xml: string };

const go = (to: string, cookie?: string): ForeningResult => ({ redirect: to, ...(cookie ? { cookie } : {}) });
const MESSAGES: Record<string, string> = {
  godkendt: "Eventet er godkendt. Tjek oplysningerne, og ret dem, hvis noget mangler.", gemt: "Gemt.",
  oprettet: "Udflugten er oprettet og vises på siden.", aflyst: "Flokks deltagelse er aflyst."
};
/** Where to go after joining or logging in: a page on this site, else the coming Udflugter. */
const nextPath = (v: unknown) => { const n = safeNext(String(v ?? "")); return n === "/flokke" ? "/udflugter" : n; };

export async function foreningRoute(request: Request, env: Env, db: D1Database, ctx: PageContext, regions: string[], path: string, url: URL, now: number): Promise<ForeningResult | null> {
  const post = request.method === "POST";
  const form = post ? await request.formData().catch(() => new FormData()) : null;
  // Forms carry a field people never see; a filled one is a robot, answered as if all went well.
  const robot = !!form && String(form.get("website_url") ?? "") !== "";
  // The signed-in member, if any: the header shows "Mine Udflugter" for them.
  const member = await currentFlokkMember(db, request, now);
  ctx = { ...ctx, member: isFlokkMember(member) ? { firstName: member.first_name, admin: member.is_admin === 1 } : null };

  if (path === "/" && !post) return { view: pages.homePage(ctx, await upcomingPicks(db, now)) };
  if (path === "/udflugter" && !post) return { view: pages.picksPage(ctx, await upcomingPicks(db, now)) };
  if (path === "/saadan-fungerer-det" && !post) return { view: pages.howPage(ctx) };
  if (path === "/om" && !post) return { view: pages.aboutPage(ctx) };
  // Earlier addresses.
  if (path === "/maanedens-events") return go("/udflugter");
  if (path === "/tryghed") return go("/saadan-fungerer-det");
  if (path === "/for-foreninger" || path === "/samarbejde") return go("/for-arrangoerer");
  if (path === "/skriv-dig-op") {
    // The interest list made way for membership.
    const wanted = url.searchParams.get("event");
    return go(`/bliv-medlem${wanted ? `?naeste=${encodeURIComponent(`/events/${wanted}`)}` : ""}`);
  }
  if (path === "/sitemap.xml") {
    const picks = await upcomingPicks(db, now);
    return { xml: sitemapXml(ctx.origin, ["/", "/udflugter", "/saadan-fungerer-det", "/bliv-medlem", "/for-arrangoerer", "/om", "/privatliv"], picks.map(p => ({ slug: p.slug, updated_at: p.updated_at }))) };
  }

  // An Udflugt, with what a visitor can do there: join, sign up, go on the waiting list, cancel.
  const slug = /^\/events\/([a-z0-9-]{1,90})$/.exec(path)?.[1];
  if (slug && !post) {
    const pick = await pickBySlug(db, slug);
    if (!pick || pick.status !== "approved") return null;
    const flokkMember = isFlokkMember(member) ? member : null;
    const [mine, numbers] = await Promise.all([flokkMember ? mySignup(db, pick.id, flokkMember.id) : null, counts(db, pick.id)]);
    return { view: pages.pickPage(ctx, pick, memberPages.signupBox(ctx, pick, flokkMember, mine, numbers), memberPages.flash(url.searchParams.get("besked"))) };
  }
  const action = /^\/events\/([a-z0-9-]{1,90})\/(tilmeld|afbud)$/.exec(path);
  if (action && post) {
    const pick = await pickBySlug(db, action[1]!);
    if (!pick || pick.status !== "approved") return null;
    if (!isFlokkMember(member)) return go(`/log-ind?naeste=${encodeURIComponent(`/events/${pick.slug}`)}`);
    if (action[2] === "tilmeld") {
      const r = await signUp(db, pick, member, now);
      return go(`/events/${pick.slug}?besked=${"ok" in r ? (r.ok === "registered" ? "tilmeldt" : "venteliste") : "lukket"}`);
    }
    const r = await cancelSignup(db, pick, member.id, now);
    return go(`/events/${pick.slug}?besked=${"ok" in r ? "afmeldt" : "lukket"}`);
  }

  if (path === "/bliv-medlem") {
    if (!post) {
      if (isFlokkMember(member)) return go("/mine-udflugter");
      return { view: memberPages.joinPage(ctx, { form: emptyInterestForm(), next: nextPath(url.searchParams.get("naeste")) }) };
    }
    const next = nextPath(form!.get("naeste"));
    const f = readInterestForm(form!);
    const { errors, fields } = validateInterestForm(f, ctx.areas.map(a => a.slug), []);
    if (Object.keys(errors).length) return { view: memberPages.joinPage(ctx, { form: f, next, errors, status: 400 }) };
    if (robot) return go("/");
    const joined = await joinFlokk(db, { first_name: fields.first_name, email: fields.email, interests: fields.interests, area: fields.area, age_group: fields.age_group }, now);
    if (!joined) return { view: memberPages.joinPage(ctx, { form: f, next, errors: { taken: "Der findes allerede en profil med den mail. Log ind med din kode – eller få en ny kode af Flokk, hvis du har mistet den." }, status: 409 }) };
    const cookie = await startSession(db, joined.member.id, now);
    return { view: memberPages.welcomePage({ ...ctx, member: { firstName: joined.member.first_name, admin: false } }, joined.member, joined.code, next), cookie };
  }

  if (path === "/mine-udflugter" && !post) {
    if (!isFlokkMember(member)) return go("/log-ind?naeste=%2Fmine-udflugter");
    const mine = await memberSignups(db, member.id, now);
    // First names only once the flock is confirmed, and only for those who hold a place in it.
    const names = new Map(await Promise.all(mine.filter(s => s.signup_status === "registered" && s.confirmed_at)
      .map(async s => [s.id, await flockFirstNames(db, s.id)] as [string, string[]])));
    return { view: memberPages.myPage(ctx, member, mine, names, url.searchParams.get("besked")) };
  }

  if (path === "/meld-ud" && post) {
    if (!isFlokkMember(member)) return go("/");
    if (String(form!.get("bekraeft") ?? "") !== "ja") return go("/mine-udflugter");
    await leaveFlokk(db, member.id, now);
    return { view: memberPages.goodbyePage({ ...ctx, member: null }), cookie: clearSessionCookie() };
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

  // Members and volunteers log in with their personal code.
  if (path === "/log-ind") {
    if (!post) return { view: memberPages.loginPage(ctx, { next: nextPath(url.searchParams.get("naeste") ?? "/mine-udflugter") }) };
    const next = nextPath(form!.get("naeste") ?? "/mine-udflugter");
    const code = normalizeCode(String(form!.get("kode") ?? ""));
    const found = code ? await memberByCode(db, code) : null;
    const who = found ? await memberById(db, found.id) : null;
    if (!isFlokkMember(who)) return { view: memberPages.loginPage(ctx, { next, error: "Koden passer ikke. Tjek den, og prøv igen.", status: 401 }) };
    return go(who.is_admin === 1 && next === "/mine-udflugter" ? "/admin" : next, await startSession(db, who.id, now));
  }
  if (path === "/log-ud") {
    if (post) await endSession(db, request);
    return go("/", clearSessionCookie());
  }

  if (path === "/admin" || path.startsWith("/admin/")) {
    if (!member || member.is_admin !== 1) return go("/log-ind?naeste=%2Fadmin");
    const message = MESSAGES[url.searchParams.get("besked") ?? ""] ?? null;

    if (path === "/admin" && !post) {
      const [picks, people, inquiries, members] = await Promise.all([adminPicks(db, now), countInterests(db),
        db.prepare("SELECT COUNT(*) AS n FROM partner_inquiries").first<{ n: number }>(),
        db.prepare("SELECT COUNT(*) AS n FROM members WHERE flokk_joined_at IS NOT NULL").first<{ n: number }>()]);
      return { view: admin.overviewPage(ctx, picks, await countsFor(db, picks.map(p => p.id)), members?.n ?? 0, people.people, inquiries?.n ?? 0, message) };
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
      // More places (or no limit) give the waiting list its places at once.
      await fillFromWaitlist(db, { ...pick, ...fields }, now);
      return go(`/admin/events/${id}?besked=gemt`);
    }
    const sub = /^\/admin\/events\/([0-9a-f-]{36})\/(deltagere|aflys)$/.exec(path);
    if (sub) {
      const pick = await pickById(db, sub[1]!);
      if (!pick) return null;
      if (sub[2] === "deltagere" && !post) return { view: admin.participantsPage(ctx, pick, await participants(db, pick.id), message) };
      const confirmed = post && sub[2] === "aflys" && String(form!.get("bekraeft") ?? "") === "ja";
      if (confirmed) await cancelByFlokk(db, pick.id, now);
      return go(`/admin/events/${pick.id}/deltagere${confirmed ? "?besked=aflyst" : ""}`);
    }
    if (path === "/admin/medlemmer") {
      let renewed: { name: string; code: string } | null = null;
      if (post) {
        const who = await memberById(db, String(form!.get("medlem") ?? ""));
        if (who) renewed = { name: who.first_name, code: await renewCode(db, who.id) };
      }
      return { view: admin.membersPage(ctx, await listMembers(db), renewed) };
    }
    if (path === "/admin/interesseliste" && !post) return { view: admin.interestsPage(ctx, await listInterests(db)) };
    if (path === "/admin/interesseliste.csv" && !post) {
      return { file: { body: admin.interestsCsv(await listInterests(db)), type: "text/csv; charset=utf-8", name: `flokk-interesseliste-${new Date(now).toISOString().slice(0, 10)}.csv` } };
    }
    if (path === "/admin/henvendelser" && !post) {
      const { results } = await db.prepare("SELECT organisation, contact_name, email, website, message, created_at FROM partner_inquiries ORDER BY created_at DESC LIMIT 500")
        .all<{ organisation: string; contact_name: string; email: string; website: string | null; message: string | null; created_at: number }>();
      return { view: admin.inquiriesPage(ctx, results) };
    }
  }
  return null;
}
