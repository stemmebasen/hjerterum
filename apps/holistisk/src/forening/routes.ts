import type { D1Database } from "../db.js";
import type { Env } from "../env.js";
import { clearSessionCookie, endSession, memberByCode, normalizeCode, safeNext, startSession } from "../flokken/auth.js";
import type { PageContext } from "../web/layout.js";
import type { View } from "../web/pages.js";
import { sitemapXml } from "../web/seo.js";
import * as admin from "./admin.js";
import { emptyPickForm, emptyProfileForm, NO_ORGANISER, pickForm, profileForm, readPickForm, readProfileForm, SAMFOLK, validateProfileForm, validatePickForm, validEmail } from "./forms.js";
import * as pages from "./pages.js";
import * as memberPages from "./memberPages.js";
import {
  cancelSignup, cancelTur, counts, countsFor, currentSamfolkMember, fillFromWaitlist, flockFirstNames, isSamfolkMember, joinSamfolk, leaveSamfolk,
  listMembers, mayManage, memberById, memberSignups, mySignup, participants, profileComplete, renewCode, signUp, updateProfile, type SamfolkMember
} from "./members.js";
import {
  adminPicks, countInterests, createPick, creatorName, deleteInterests, eventById, fieldsFromEvent, isSubscribed, listInterests, listSubscribers, pickById,
  pickBySlug, picksByCreator, subscribe, suggestions, unsubscribe, upcomingPicks, updatePick, type PickRow
} from "./store.js";

/** Foreningen Samfolk: every page and form. Returns null for an address it does not have. */

export type ForeningResult =
  | { view: View; cookie?: string }
  | { redirect: string; cookie?: string }
  | { file: { body: string; type: string; name: string } }
  | { xml: string };

const go = (to: string, cookie?: string): ForeningResult => ({ redirect: to, ...(cookie ? { cookie } : {}) });
const MESSAGES: Record<string, string> = { gemt: "Gemt.", oprettet: "Samfolk-eventet er oprettet og vises på siden.", aflyst: "Turen er aflyst.", brugt: "Eventet er hentet ind. Tjek og ret oplysningerne." };
/** Where to go after joining or logging in: a page on this site, else the coming ture. */
const nextPath = (v: unknown) => { const n = safeNext(String(v ?? "")); return n === "/flokke" ? "/ture" : n; };
const TUR = /^\/ture\/([0-9a-f-]{36})\/(ret|deltagere|aflys)$/;

export async function foreningRoute(request: Request, env: Env, db: D1Database, ctx: PageContext, regions: string[], path: string, url: URL, now: number): Promise<ForeningResult | null> {
  const post = request.method === "POST";
  const form = post ? await request.formData().catch(() => new FormData()) : null;
  // Forms carry a field people never see; a filled one is a robot, answered as if all went well.
  const robot = !!form && String(form.get("website_url") ?? "") !== "";
  // The signed-in member, if any: the header shows "Mine ture" for them.
  const found = await currentSamfolkMember(db, request, now);
  const member = isSamfolkMember(found) ? found : null;
  ctx = { ...ctx, member: member ? { firstName: member.first_name, admin: member.is_admin === 1 } : null };
  /** Pages for members only: log in first, and complete the profile before anything else. */
  const gate = (here: string): ForeningResult | null => !member ? go(`/log-ind?naeste=${encodeURIComponent(here)}`)
    : !profileComplete(member) ? go(`/min-profil?naeste=${encodeURIComponent(here)}&besked=udfyld`) : null;

  if (path === "/" && !post) return { view: pages.homePage(ctx, await upcomingPicks(db, now)) };
  if (path === "/ture" && !post) return { view: pages.picksPage(ctx, await upcomingPicks(db, now)) };
  if (path === "/saadan-fungerer-det" && !post) return { view: pages.howPage(ctx) };
  if (path === "/om" && !post) return { view: pages.aboutPage(ctx) };
  // Earlier addresses.
  if (path === "/maanedens-events" || path === "/udflugter") return go("/ture");
  if (path === "/mine-udflugter") return go("/mine-ture");
  if (path === "/tryghed") return go("/saadan-fungerer-det");
  if (path === "/for-foreninger" || path === "/samarbejde" || path === "/for-arrangoerer") return go("/om");
  if (path === "/skriv-dig-op") return go("/bliv-medlem");
  if (path === "/sitemap.xml") {
    const picks = await upcomingPicks(db, now);
    return { xml: sitemapXml(ctx.origin, ["/", "/ture", "/saadan-fungerer-det", "/bliv-medlem", "/samfolk-brevet", "/om", "/privatliv"], picks.map(p => ({ slug: p.slug, updated_at: p.updated_at }))) };
  }

  // A tur, with what a visitor can do there: join, sign up, go on the waiting list, cancel.
  const slug = /^\/events\/([a-z0-9-]{1,90})$/.exec(path)?.[1];
  if (slug && !post) {
    const pick = await pickBySlug(db, slug);
    if (!pick || (pick.status !== "approved" && !mayManage(member, pick))) return null;
    const [mine, numbers, creator] = await Promise.all([member ? mySignup(db, pick.id, member.id) : null, counts(db, pick.id), creatorName(db, pick)]);
    const names = mine?.status === "registered" ? await flockFirstNames(db, pick.id) : [];
    const box = memberPages.signupBox(ctx, pick, member, !!member && profileComplete(member), mine, numbers, names);
    return { view: pages.pickPage(ctx, pick, { box, message: memberPages.flash(url.searchParams.get("besked")), creator, manage: mayManage(member, pick) }) };
  }
  const action = /^\/events\/([a-z0-9-]{1,90})\/(tilmeld|afbud)$/.exec(path);
  if (action && post) {
    const pick = await pickBySlug(db, action[1]!);
    if (!pick || pick.status !== "approved") return null;
    const here = `/events/${pick.slug}`;
    if (!member) return go(`/log-ind?naeste=${encodeURIComponent(here)}`);
    if (action[2] === "tilmeld") {
      const r = await signUp(db, pick, member, now);
      if ("error" in r && r.error === "profile") return gate(here)!;
      return go(`${here}?besked=${"ok" in r ? (r.ok === "registered" ? "tilmeldt" : "venteliste") : "lukket"}`);
    }
    const r = await cancelSignup(db, pick, member.id, now);
    return go(`${here}?besked=${"ok" in r ? "afmeldt" : "lukket"}`);
  }

  // A member creates a tur, and runs the ones they created.
  if (path === "/ture/ny") {
    const blocked = gate("/ture/ny");
    if (blocked) return blocked;
    if (!post) return { view: memberPages.turFormPage(ctx, emptyPickForm(), {}) };
    const f = readPickForm(form!);
    f.status = "approved";
    const { errors, fields } = validatePickForm(f, NO_ORGANISER, now);
    if (!fields) return { view: memberPages.turFormPage(ctx, f, { errors, status: 400 }) };
    if (robot) return go("/ture");
    const pick = await createPick(db, fields, "member", null, member!.id, now);
    return go(`/events/${pick.slug}?besked=oprettet`);
  }
  const tur = TUR.exec(path);
  if (tur) {
    const blocked = gate(path);
    if (blocked) return blocked;
    const pick = await pickById(db, tur[1]!);
    if (!pick || !mayManage(member, pick)) return null;
    if (tur[2] === "ret") {
      if (!post) return { view: memberPages.turFormPage(ctx, pickForm(pick), { id: pick.id }) };
      const f = readPickForm(form!);
      // Only the volunteers hide a tur; its creator keeps the state it has.
      f.status = pick.status;
      const { errors, fields } = validatePickForm(f, pick.kind === "samfolk" ? SAMFOLK : NO_ORGANISER, Math.min(now, pick.starts_at));
      if (!fields) return { view: memberPages.turFormPage(ctx, f, { id: pick.id, errors, status: 400 }) };
      await updatePick(db, pick.id, fields, now);
      await fillFromWaitlist(db, { ...pick, ...fields }, now);
      return go(`/events/${pick.slug}?besked=gemt`);
    }
    if (tur[2] === "deltagere" && !post) return { view: memberPages.creatorParticipantsPage(ctx, pick, await participants(db, pick.id)) };
    if (tur[2] === "aflys" && post) {
      if (String(form!.get("bekraeft") ?? "") !== "ja") return go(`/ture/${pick.id}/deltagere`);
      await cancelTur(db, pick.id, now);
      return go(`/events/${pick.slug}?besked=aflyst`);
    }
    return null;
  }

  if (path === "/bliv-medlem") {
    if (!post) {
      if (member) return go(profileComplete(member) ? "/mine-ture" : "/min-profil");
      return { view: memberPages.joinPage(ctx, { form: emptyProfileForm(), next: nextPath(url.searchParams.get("naeste")) }) };
    }
    const next = nextPath(form!.get("naeste"));
    const f = readProfileForm(form!);
    const { errors, fields } = validateProfileForm(f, ctx.areas.map(a => a.slug), true);
    if (!fields) return { view: memberPages.joinPage(ctx, { form: f, next, errors, status: 400 }) };
    if (robot) return go("/");
    const joined = await joinSamfolk(db, fields, now);
    if (!joined) return { view: memberPages.joinPage(ctx, { form: f, next, errors: { taken: "Der findes allerede en profil med den mail. Log ind med din kode – eller få en ny kode af Samfolk, hvis du har mistet den." }, status: 409 }) };
    if (f.newsletter) await subscribe(db, fields.email, joined.member.id, now);
    const cookie = await startSession(db, joined.member.id, now);
    return { view: memberPages.welcomePage({ ...ctx, member: { firstName: joined.member.first_name, admin: false } }, joined.member, joined.code, next), cookie };
  }

  if (path === "/min-profil") {
    if (!member) return go("/log-ind?naeste=%2Fmin-profil");
    const next = nextPath((post ? form!.get("naeste") : url.searchParams.get("naeste")) ?? "/mine-ture");
    if (!post) return { view: memberPages.profilePage(ctx, member, { form: profileForm(member, await isSubscribed(db, member.email)), next, message: url.searchParams.get("besked") }) };
    const f = readProfileForm(form!);
    const { errors, fields } = validateProfileForm(f, ctx.areas.map(a => a.slug), false);
    if (!fields) return { view: memberPages.profilePage(ctx, member, { form: f, next, errors, status: 400 }) };
    if (!await updateProfile(db, member.id, fields)) return { view: memberPages.profilePage(ctx, member, { form: f, next, errors: { taken: "Den mail bruges allerede af et andet medlem." }, status: 409 }) };
    if (f.newsletter) await subscribe(db, fields.email, member.id, now); else await unsubscribe(db, fields.email);
    return go(next === "/mine-ture" ? "/min-profil?besked=gemt" : next);
  }

  if (path === "/mine-ture" && !post) {
    const blocked = gate("/mine-ture");
    if (blocked) return blocked;
    const me = member as SamfolkMember;
    const [mine, created] = await Promise.all([memberSignups(db, me.id, now), picksByCreator(db, me.id, now)]);
    const names = new Map(await Promise.all(mine.filter(s => s.signup_status === "registered" && !s.flokk_cancelled_at)
      .map(async s => [s.id, await flockFirstNames(db, s.id)] as [string, string[]])));
    return { view: memberPages.myPage(ctx, me, mine, names, created, url.searchParams.get("besked")) };
  }

  if (path === "/meld-ud" && post) {
    if (!member) return go("/");
    if (String(form!.get("bekraeft") ?? "") !== "ja") return go("/min-profil");
    await leaveSamfolk(db, member, now);
    return { view: memberPages.goodbyePage({ ...ctx, member: null }), cookie: clearSessionCookie() };
  }

  // Samfolk-brevet: anyone can sign up, member or not.
  if (path === "/samfolk-brevet") {
    if (!post) return { view: pages.newsletterPage(ctx, url.searchParams.get("besked")) };
    const email = String(form!.get("email") ?? "").trim();
    if (!validEmail(email)) return { view: pages.newsletterPage(ctx, "fejl") };
    if (!robot) await subscribe(db, email, member?.email === email.toLowerCase() ? member.id : null, now);
    return go("/samfolk-brevet?besked=tilmeldt");
  }
  if (path === "/samfolk-brevet/afmeld" && post) {
    const email = String(form!.get("email") ?? "").trim();
    if (!robot && email) await unsubscribe(db, email);
    return go("/samfolk-brevet?besked=afmeldt");
  }

  if (path === "/privatliv") {
    if (!post) return { view: pages.privacyPage(ctx) };
    const email = String(form!.get("email") ?? "").trim();
    if (!robot && email) await deleteInterests(db, email);
    return { view: pages.privacyPage(ctx, { deleted: true }) };
  }

  // Members and volunteers log in with their personal code.
  if (path === "/log-ind") {
    if (!post) return { view: memberPages.loginPage(ctx, { next: nextPath(url.searchParams.get("naeste") ?? "/mine-ture") }) };
    const next = nextPath(form!.get("naeste") ?? "/mine-ture");
    const code = normalizeCode(String(form!.get("kode") ?? ""));
    const byCode = code ? await memberByCode(db, code) : null;
    const who = byCode ? await memberById(db, byCode.id) : null;
    if (!isSamfolkMember(who)) return { view: memberPages.loginPage(ctx, { next, error: "Koden passer ikke. Tjek den, og prøv igen.", status: 401 }) };
    const to = who.is_admin === 1 && next === "/mine-ture" ? "/admin" : profileComplete(who) || who.is_admin === 1 ? next : `/min-profil?naeste=${encodeURIComponent(next)}&besked=udfyld`;
    return go(to, await startSession(db, who.id, now));
  }
  if (path === "/log-ud") {
    if (post) await endSession(db, request);
    return go("/", clearSessionCookie());
  }

  if (path === "/admin" || path.startsWith("/admin/")) {
    if (!member || member.is_admin !== 1) return go("/log-ind?naeste=%2Fadmin");
    const message = MESSAGES[url.searchParams.get("besked") ?? ""] ?? null;

    if (path === "/admin" && !post) {
      const [picks, people, inquiries, members, subscribers] = await Promise.all([adminPicks(db, now), countInterests(db),
        db.prepare("SELECT COUNT(*) AS n FROM partner_inquiries").first<{ n: number }>(),
        db.prepare("SELECT COUNT(*) AS n FROM members WHERE flokk_joined_at IS NOT NULL").first<{ n: number }>(),
        db.prepare("SELECT COUNT(*) AS n FROM newsletter").first<{ n: number }>()]);
      return { view: admin.overviewPage(ctx, picks, await countsFor(db, picks.map(p => p.id)), { members: members?.n ?? 0, subscribers: subscribers?.n ?? 0, people: people.people, inquiries: inquiries?.n ?? 0 }, message) };
    }
    if (path === "/admin/forslag") {
      if (!post) {
        const q = (url.searchParams.get("q") ?? "").slice(0, 100);
        return { view: admin.suggestionsPage(ctx, await suggestions(db, regions, now, q), q) };
      }
      const event = await eventById(db, String(form!.get("event") ?? ""));
      if (!event) return go("/admin/forslag");
      const existing = await db.prepare("SELECT id FROM picks WHERE event_id = ?").bind(event.id).first<{ id: string }>();
      // Hidden until a volunteer has checked it.
      const pick = existing ?? await createPick(db, { ...fieldsFromEvent(event), status: "withdrawn" }, "samfolk", event.id, member.id, now);
      return go(`/admin/events/${pick.id}?besked=brugt`);
    }
    if (path === "/admin/events/ny") {
      if (!post) return { view: admin.pickFormPage(ctx, emptyPickForm(), { samfolk: true }) };
      const f = readPickForm(form!);
      const { errors, fields } = validatePickForm(f, SAMFOLK, now);
      if (!fields) return { view: admin.pickFormPage(ctx, f, { samfolk: true, errors, status: 400 }) };
      const pick = await createPick(db, fields, "samfolk", null, member.id, now);
      return go(`/admin/events/${pick.id}?besked=oprettet`);
    }
    const id = /^\/admin\/events\/([0-9a-f-]{36})$/.exec(path)?.[1];
    if (id) {
      const pick = await pickById(db, id);
      if (!pick) return null;
      const samfolk = pick.kind === "samfolk";
      if (!post) return { view: admin.pickFormPage(ctx, pickForm(pick), { id, samfolk, message }) };
      const f = readPickForm(form!);
      const { errors, fields } = validatePickForm(f, samfolk ? SAMFOLK : NO_ORGANISER, Math.min(now, pick.starts_at));
      if (!fields) return { view: admin.pickFormPage(ctx, f, { id, samfolk, errors, status: 400 }) };
      await updatePick(db, id, fields, now);
      // More places (or no limit) give the waiting list its places at once.
      await fillFromWaitlist(db, { ...pick, ...fields } as PickRow, now);
      return go(`/admin/events/${id}?besked=gemt`);
    }
    const sub = /^\/admin\/events\/([0-9a-f-]{36})\/(deltagere|aflys)$/.exec(path);
    if (sub) {
      const pick = await pickById(db, sub[1]!);
      if (!pick) return null;
      if (sub[2] === "deltagere" && !post) return { view: admin.participantsPage(ctx, pick, await participants(db, pick.id), message) };
      const confirmed = post && sub[2] === "aflys" && String(form!.get("bekraeft") ?? "") === "ja";
      if (confirmed) await cancelTur(db, pick.id, now);
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
    const day = new Date(now).toISOString().slice(0, 10);
    if (path === "/admin/samfolk-brevet" && !post) return { view: admin.subscribersPage(ctx, await listSubscribers(db)) };
    if (path === "/admin/samfolk-brevet.csv" && !post) return { file: { body: admin.subscribersCsv(await listSubscribers(db)), type: "text/csv; charset=utf-8", name: `samfolk-brevet-${day}.csv` } };
    if (path === "/admin/interesseliste" && !post) return { view: admin.interestsPage(ctx, await listInterests(db)) };
    if (path === "/admin/interesseliste.csv" && !post) return { file: { body: admin.interestsCsv(await listInterests(db)), type: "text/csv; charset=utf-8", name: `interesseliste-${day}.csv` } };
    if (path === "/admin/henvendelser" && !post) {
      const { results } = await db.prepare("SELECT organisation, contact_name, email, website, message, created_at FROM partner_inquiries ORDER BY created_at DESC LIMIT 500")
        .all<{ organisation: string; contact_name: string; email: string; website: string | null; message: string | null; created_at: number }>();
      return { view: admin.inquiriesPage(ctx, results) };
    }
  }
  return null;
}
