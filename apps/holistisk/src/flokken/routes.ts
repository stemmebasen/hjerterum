import type { D1Database } from "../db.js";
import { groupBySlug } from "../groups.js";
import type { Env } from "../env.js";
import { eventBySlug, relatedEvents, type EventRow } from "../web/queries.js";
import { organiserEmail, type PageContext } from "../web/layout.js";
import { cleanFirstName, clearSessionCookie, createMember, currentMember, endSession, memberByCode, normalizeCode, safeNext, sameSecret, startSession, type Member } from "./auth.js";
import { defaultFlockForm, readFlockForm, toLocalInput, validateFlockForm } from "./forms.js";
import { chatTime, findFlockPage, flockFormPage, flockPage, flockPath, linkPage, loginPage, membershipPage, myFlocksPage, noticeText, profilePage, safetyPage, welcomePage, type View } from "./pages.js";
import { outingsUsed, flockAgeGroups, flockMembers, flockPhoto, ownPhoto, PHOTO_CONSENT_ERROR, profileComplete, profileFor, PROFILE_MAX_BODY, readPhoto, readProfileForm, saveProfile, validateProfile } from "./profile.js";
import { chatAccess, chatMessages, chatOpen, postMessage, reportedMessages, reportMessage, type ChatMessage } from "./chat.js";
import { linkState, requestLoginLink, useLoginLink, validToken } from "./loginLink.js";
import { listSignups, readSignup, saveSignup, validateSignup } from "./membership.js";
import { sendWelcome } from "./welcome.js";
import { inviteToJoin, joinRoute, JOIN_PATH } from "./join.js";
import { listInquiries, partnerPage } from "./partners.js";
import { contactInbox } from "../mail.js";
import { contactPage, emptyContact, filledByPerson, listContacts, readContact, senderOf, sendContact, tooMany, topicFrom, validateContact } from "./contact.js";
import { choiceCookie, clearChoiceCookie, cleanChoices, cancelledSection, confirmInterest, declineInterest, interestsSection, KICKOFF_PATH, kickoffJson, kickoffPage, memberInterests, readChoices, removeInterest, saveInterests } from "./kickoff.js";
import { createFlock, eventOver, flockById, flockHost, joinFlock, leaveFlock, memberFlocks, updateFlock, upcomingFlocks } from "./store.js";

/** Flokken's routes. Returns null for paths that are not Flokken's, so the portal's own routing goes on. */

export type FlokkenResult =
  | { view: View; cookie?: string | string[] }
  | { redirect: string; cookie?: string | string[] }
  | { json: unknown; status: number }
  | { image: { type: string; body: Uint8Array<ArrayBuffer> } };

const MAX_BODY = 20_000;
const go = (to: string, cookie?: string | string[]): FlokkenResult => ({ redirect: to, ...(cookie ? { cookie } : {}) });

/** A short-lived note to the page a form sends people on to (Post/Redirect/Get). A form's answer is always a redirect to
 * a normal page, so going back or reloading never asks to send the form again ("Confirm Form Resubmission"). What that
 * page must show and should not be in its address (the new personal code, an e-mail address) goes in this cookie. */
const NOTE_MAX_AGE = 15 * 60;
const noteCookie = (name: string, value: string, path: string) =>
  `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=${NOTE_MAX_AGE}`;
const readNote = (request: Request, name: string): string | null => {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(request.headers.get("cookie") ?? "");
  if (!m?.[1]) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
};
const WELCOME_PATH = "/bliv-medlem/velkommen";
const WELCOME_NOTE = "flok_ny_kode";
const MAIL_NOTE = "flok_mail_sendt";
const withMessage = (path: string, code: string) => `${path}${path.includes("?") ? "&" : "?"}besked=${encodeURIComponent(code)}`;

/** The posted form, or null when it is too big or cannot be read. A body that is too big is still read to the end (and
 * thrown away): answering in the middle of a large upload, such as a photo straight from a phone, can make the browser
 * show a broken page (ERR_INVALID_RESPONSE) instead of the answer. */
async function formData(request: Request, max = MAX_BODY): Promise<FormData | null> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > max) { await drain(request); return null; }
  try { return await request.formData(); } catch { return null; }
}

const DRAIN_MAX = 60_000_000;
async function drain(request: Request): Promise<void> {
  const reader = request.body?.getReader();
  if (!reader) return;
  try {
    for (let read = 0; read < DRAIN_MAX;) { const { done, value } = await reader.read(); if (done) return; read += value.byteLength; }
    await reader.cancel();
  } catch { /* the browser gave up; nothing to answer */ }
}

const bearerOk = (request: Request, env: Env): boolean => {
  const token = env.INGEST_TOKEN;
  const given = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  return !!token && token.length >= 24 && sameSecret(given, token);
};

/** Where a member who has not yet told the others their age group and a line about themselves goes first. `flock` is
 * a flock to join once that is done. */
const profilePath = (next: string, flock?: string) => `/profil?naeste=${encodeURIComponent(next)}${flock ? `&flok=${flock}` : ""}`;

/** The profile, asking for an e-mail too, for the interest list (Socialklubben tells the member when a flock is ready). */
const profileForList = (next: string) => `/profil?naeste=${encodeURIComponent(next)}&mail=1`;

/** A chat message as the page gets it: first name only, never the member's id. */
const chatJson = (c: ChatMessage, memberId: string, now: number) =>
  ({ id: c.id, name: c.first_name, body: c.body, at: c.created_at, time: chatTime(c.created_at, now), mine: c.member_id === memberId });

async function eventFor(db: D1Database, slug: string, regions: string[]): Promise<EventRow | null> {
  const e = await eventBySlug(db, slug);
  return e && e.region && regions.includes(e.region) ? e : null;
}

export async function flokkenRoute(request: Request, env: Env, db: D1Database, pc: PageContext, regions: string[], path: string, url: URL, now: number, notFound: () => View): Promise<FlokkenResult | null> {
  const method = request.method;
  const post = method === "POST";
  const message = url.searchParams.get("besked");
  const member = (): Promise<Member | null> => currentMember(db, request, now);
  /** Ready for the interest list: age group, a line about themselves and an e-mail. */
  const ready = async (id: string): Promise<boolean> => { const p = await profileFor(db, id); return profileComplete(p) && !!p?.email; };

  if (path === "/tryghed" && !post) return { view: safetyPage(pc) };
  if (path === "/find-en-flok" && !post) return { view: findFlockPage(pc, await upcomingFlocks(db, regions, now, 60)) };

  if (path === "/samarbejde" && !post) return { view: partnerPage(pc, { now }) };
  if (path === "/kontakt" && !post) return { view: contactPage(pc, { sent: message === "tak", now, form: emptyContact(topicFrom(url.searchParams.get("emne"))) }) };
  // The contact form, also on /samarbejde (an older copy of that page may still post there).
  if ((path === "/kontakt" || path === "/samarbejde") && post) {
    const thanks = go(withMessage("/kontakt", "tak") + "#formular");
    const data = await formData(request);
    if (!data) return { view: contactPage(pc, { status: 400, errors: { form: "Formularen kunne ikke læses. Prøv igen." }, now }) };
    // A field people do not see; forms that fill it in are from robots.
    if (String(data.get("website_url") ?? "")) return thanks;
    const form = readContact(data);
    if (path === "/samarbejde" && !data.get("emne")) form.topic = "arrangoer";
    const errors = validateContact(form);
    if (Object.keys(errors).length) return { view: contactPage(pc, { form, errors, status: 400, now }) };
    if (data.has("t") && !filledByPerson(String(data.get("t")), now)) return { view: contactPage(pc, { form, errors: { form: "Det gik lidt for hurtigt. Tjek din besked, og tryk på „Send besked“ igen." }, status: 400, now }) };
    const sender = await senderOf(request);
    if (await tooMany(db, sender, now)) return { view: contactPage(pc, { form, errors: { form: `Du har sendt flere beskeder på kort tid. Prøv igen lidt senere, eller skriv direkte til ${organiserEmail(pc)}.` }, status: 429, now }) };
    await sendContact(db, env, form, sender, contactInbox(env), now);
    return thanks;
  }
  if (path === "/api/kontakt" && !post) {
    if (!bearerOk(request, env)) return { json: { error: "unauthorized" }, status: 401 };
    return { json: await listContacts(db), status: 200 };
  }
  if (path === "/api/samarbejde" && !post) {
    if (!bearerOk(request, env)) return { json: { error: "unauthorized" }, status: 401 };
    return { json: await listInquiries(db), status: 200 };
  }
  if (path === "/api/chat-meldinger" && !post) {
    if (!bearerOk(request, env)) return { json: { error: "unauthorized" }, status: 401 };
    return { json: await reportedMessages(db), status: 200 };
  }

  // Login with a link on e-mail: ask for it, open it (a page with a button), use it.
  if (path === "/log-ind/mail" && post) {
    const data = await formData(request);
    const back = safeNext(String(data?.get("naeste") ?? ""));
    const email = String(data?.get("email") ?? "").trim().slice(0, 160);
    const result = await requestLoginLink(db, env, email, back, pc.origin, now);
    if ("error" in result) {
      const text = result.error === "invalid" ? "Skriv den e-mail, du har givet os, fx navn@eksempel.dk."
        : result.error === "off" ? "Vi kan ikke sende e-mails lige nu. Log ind med din personlige kode, eller prøv igen senere."
        : "Mailen kunne ikke sendes lige nu. Prøv igen om lidt.";
      return { view: loginPage(pc, back, { email, emailError: text, status: result.error === "invalid" ? 400 : 503 }) };
    }
    return go(`/log-ind?naeste=${encodeURIComponent(back)}&besked=mail_sendt`, noteCookie(MAIL_NOTE, email, "/log-ind"));
  }
  if (path === "/log-ind/link") {
    const data = post ? await formData(request) : null;
    const token = String((post ? data?.get("t") : url.searchParams.get("t")) ?? "");
    if (!validToken(token)) return { view: linkPage(pc, { error: "unknown" }) };
    if (!post) {
      const state = await linkState(db, token, now);
      const m = await member();
      // Already logged in as that person on this device: straight on.
      if (m && "ok" in state && state.memberId === m.id) return go(safeNext(state.next));
      if ("error" in state) return { view: linkPage(pc, { error: state.error, loggedIn: !!m }) };
      return { view: linkPage(pc, { token }) };
    }
    const used = await useLoginLink(db, token, now);
    if ("error" in used) {
      const m = await member();
      return { view: linkPage(pc, { error: used.error, loggedIn: !!m }) };
    }
    return go(withMessage(safeNext(used.next), used.created ? "velkommen_mail" : "logget_ind"), await startSession(db, used.memberId, now));
  }
  if (path === "/log-ind") {
    const next = safeNext(post ? null : url.searchParams.get("naeste"));
    if (!post) {
      if (await member()) return go(next);
      const sentTo = message === "mail_sendt" ? readNote(request, MAIL_NOTE) : null;
      return { view: loginPage(pc, next, sentTo ? { sentTo } : {}) };
    }
    const data = await formData(request);
    const back = safeNext(String(data?.get("naeste") ?? ""));
    const code = normalizeCode(String(data?.get("kode") ?? ""));
    const found = code ? await memberByCode(db, code) : null;
    if (!found) return { view: loginPage(pc, back, { codeError: "Koden passer ikke. Den har 12 tegn, fx K7QF-29MX-T4HD.", status: 400 }) };
    // The same way back as with the link from the e-mail: to the page the person came from, with "Du er logget ind".
    return go(withMessage(back, "logget_ind"), await startSession(db, found.id, now));
  }
  // The link in the "Vil du være medlem?" mail (src/flokken/join.ts).
  if (path === JOIN_PATH) return { view: await joinRoute(request, env, db, pc, url, now) };
  if (path === "/bliv-medlem" && !post) return { view: membershipPage(pc, !!(await member()), { sent: message === "tak" }) };
  if (path === "/bliv-medlem/meld-ind" && post) {
    const data = await formData(request);
    if (!data) return { view: membershipPage(pc, false, { status: 400, errors: { name: "Formularen kunne ikke læses. Prøv igen." } }) };
    if (String(data.get("website_url") ?? "")) return go(withMessage("/bliv-medlem", "tak") + "#meld-ind");
    const form = readSignup(data);
    const errors = validateSignup(form);
    if (Object.keys(errors).length) return { view: membershipPage(pc, !!(await member()), { form, errors, status: 400 }) };
    // The first time: a "Velkommen som medlem" mail (src/flokken/welcome.ts).
    if (await saveSignup(db, form, now)) await sendWelcome(db, env, form.email, form.name, pc.origin, pc.lang ?? "da", now);
    return go(withMessage("/bliv-medlem", "tak") + "#meld-ind");
  }
  if (path === "/api/indmeldelser" && !post) {
    if (!bearerOk(request, env)) return { json: { error: "unauthorized" }, status: 401 };
    return { json: await listSignups(db), status: 200 };
  }
  if (path === "/bliv-medlem" && post) {
    const data = await formData(request);
    const back = safeNext(String(data?.get("naeste") ?? ""));
    const raw = String(data?.get("fornavn") ?? "");
    const name = cleanFirstName(raw);
    if (!name) return { view: loginPage(pc, back, { name: raw.slice(0, 30), nameError: "Skriv dit fornavn (højst 30 bogstaver).", status: 400 }) };
    const { member: created, code } = await createMember(db, name, now);
    return go(`${WELCOME_PATH}?naeste=${encodeURIComponent(back)}`, [await startSession(db, created.id, now), noteCookie(WELCOME_NOTE, code, WELCOME_PATH)]);
  }
  // The welcome page after "Opret profil", with the new personal code (from the note, for 15 minutes; reloading is fine).
  if (path === WELCOME_PATH && !post) {
    const m = await member();
    const next = safeNext(url.searchParams.get("naeste"));
    if (!m) return go(`/log-ind?naeste=${encodeURIComponent(next)}`);
    const code = normalizeCode(readNote(request, WELCOME_NOTE) ?? "");
    // Only this member's own code: someone else may have made a profile on the same device a moment ago.
    const own = code && (await memberByCode(db, code))?.id === m.id ? code : null;
    return { view: welcomePage(pc, m, own, next) };
  }
  if (path === "/log-ud" && post) {
    await endSession(db, request);
    return go("/", clearSessionCookie());
  }

  if (path === "/profil") {
    const m = await member();
    if (!m) return go(`/log-ind?naeste=${encodeURIComponent(`/profil${url.search}`)}`);
    const profile = await profileFor(db, m.id);
    if (!profile) return go("/log-ind");
    const next = safeNext(url.searchParams.get("naeste"));
    const joinId = /^[0-9a-f-]{36}$/.test(url.searchParams.get("flok") ?? "") ? url.searchParams.get("flok")! : null;
    const requireEmail = url.searchParams.get("mail") === "1";
    const state = { next, joinId, profile, firstTime: !profileComplete(profile), requireEmail, outings: await outingsUsed(db, m.id, now) };
    const action = `/profil${url.search}`;
    if (!post) return { view: profilePage(pc, { ...state, action, form: { firstName: profile.first_name, ageGroup: profile.age_group ?? "", intro: profile.intro ?? "", email: profile.email ?? "", removePhoto: false, photoConsent: false }, errors: {} }) };
    const data = await formData(request, PROFILE_MAX_BODY);
    if (!data) return { view: profilePage(pc, { ...state, action, form: { firstName: profile.first_name, ageGroup: profile.age_group ?? "", intro: profile.intro ?? "", email: profile.email ?? "", removePhoto: false, photoConsent: false }, errors: { photo: "Billedet var for stort til at blive sendt (højst 250 KB), så intet blev gemt. Udfyld felterne igen, og vælg et mindre billede eller gem uden billede." }, status: 400 }) };
    const form = readProfileForm(data);
    const checked = validateProfile(form, { requireEmail: requireEmail && !profile.email });
    const photo = await readPhoto(data);
    const photoError = photo && "error" in photo ? photo.error : photo && !form.photoConsent ? PHOTO_CONSENT_ERROR : null;
    const errors = { ...("errors" in checked ? checked.errors : {}), ...(photoError ? { photo: photoError } : {}) };
    if ("errors" in checked || photoError) return { view: profilePage(pc, { ...state, action, form, errors, status: 400 }) };
    const saved = await saveProfile(db, m.id, checked.values, photo && !("error" in photo) ? photo : null, form.removePhoto, now);
    if ("error" in saved) return { view: profilePage(pc, { ...state, action, form, errors: { email: "Den e-mail bruges allerede af en anden profil. Log ind med koden for den, eller brug en anden e-mail." }, status: 400 }) };
    if (joinId) {
      const f = await flockById(db, joinId, m.id);
      if (f) {
        const result = await joinFlock(db, f, m.id, now);
        return go(withMessage(flockPath(f.id), "error" in result ? result.error : "tilsluttet"));
      }
    }
    return go(withMessage(next, "profil_gemt"));
  }

  // "Lad os komme godt i gang": the interest list (the pop-up's JSON and the page), and answering an invitation.
  if (path === "/api/kom-godt-i-gang" && !post) {
    const m = await member();
    // ?dage=2: only the events of the next days (the first-visit pop-up, Jake 2026-11-11).
    const days = Number.parseInt(url.searchParams.get("dage") ?? "", 10);
    return { json: await kickoffJson(db, regions, m, m ? await ready(m.id) : false, now, days >= 1 && days <= 28 ? days : undefined), status: 200 };
  }
  if (path === KICKOFF_PATH) {
    const m = await member();
    const isReady = m ? await ready(m.id) : false;
    const chosen = readChoices(request);
    // On the way back from becoming a member: first the profile (with e-mail), then the ticks are saved.
    const afterProfile = `${KICKOFF_PATH}?gem=1`;
    if (!post) {
      if (m && !isReady && url.searchParams.has("videre")) return go(profileForList(afterProfile));
      if (m && isReady && url.searchParams.has("gem") && chosen.length) {
        await saveInterests(db, m.id, chosen, [], regions, now);
        return go(withMessage("/flokke", "interesser_gemt") + "#interesser", clearChoiceCookie());
      }
      return { view: await kickoffPage(db, pc, regions, { memberId: m?.id ?? null, ready: isReady, chosen, message, group: groupBySlug(url.searchParams.get("gruppe"))?.slug ?? null }) };
    }
    const data = await formData(request);
    const slugs = cleanChoices((data?.getAll("event") ?? []).map(String));
    const shown = cleanChoices((data?.getAll("vist") ?? []).map(String));
    if (!m) {
      if (!slugs.length) return go(withMessage(KICKOFF_PATH, "intet_valgt"));
      return go(`/log-ind?naeste=${encodeURIComponent(`${KICKOFF_PATH}?videre=1`)}`, choiceCookie(slugs));
    }
    if (!isReady) {
      if (!slugs.length) return go(withMessage(KICKOFF_PATH, "intet_valgt"));
      return go(profileForList(afterProfile), choiceCookie(slugs));
    }
    // A member may also untick everything to take the events off their list.
    if (!slugs.length && !(await memberInterests(db, m.id)).some(i => shown.includes(i.slug))) return go(withMessage(KICKOFF_PATH, "intet_valgt"));
    await saveInterests(db, m.id, slugs, shown, regions, now);
    return go(withMessage("/flokke", "interesser_gemt") + "#interesser", clearChoiceCookie());
  }
  // "Jeg vil gerne med!" on an event page: the interest list's tick for that one event. A newcomer first becomes a
  // member and fills in the profile with an e-mail; the tick waits in the choice cookie and is saved on the way back.
  const tick = /^\/events\/([a-z0-9-]{1,90})\/interesse(\/fjern)?$/.exec(path);
  if (tick) {
    const [, slug, remove] = tick as unknown as [string, string, string | undefined];
    const e = await eventFor(db, slug, regions);
    if (!e) return { view: notFound() };
    const back = `/events/${e.slug}`;
    const self = `${back}/interesse`;
    const m = await member();
    if (remove) {
      if (!m || !post) return go(`${back}#flokke`);
      await removeInterest(db, m.id, e.slug);
      return go(withMessage(back, "interesse_fjernet") + "#besked");
    }
    // Only a posted tick, or the way back with the tick in the cookie, saves anything.
    if (!post && !readChoices(request).includes(e.slug)) return go(`${back}#flokke`);
    if (e.status !== "scheduled" || e.starts_at <= now) return go(withMessage(back, "event_closed") + "#besked", clearChoiceCookie());
    if (!m) return go(`/log-ind?naeste=${encodeURIComponent(self)}`, choiceCookie([e.slug]));
    if (!(await ready(m.id))) return go(profileForList(self), choiceCookie([e.slug]));
    await saveInterests(db, m.id, [e.slug], [], regions, now);
    // Not a member yet: one mail asking if they would like to be (src/flokken/join.ts), the first time only.
    await inviteToJoin(db, env, m.id, pc.origin, pc.lang ?? "da", now);
    // Back on the event page, scrolled to the thank-you above the buttons (Jake 2026-11-18: landing at the very top hid
    // it below the picture, so most people never saw it).
    return go(withMessage(back, "interesse_her") + "#besked", clearChoiceCookie());
  }
  const answer = /^\/interesser\/([a-z0-9-]{1,90})\/(bekraeft|nej-tak|fjern)$/.exec(path);
  if (answer) {
    const m = await member();
    if (!m) return go(`/log-ind?naeste=${encodeURIComponent("/flokke")}`);
    if (!post) return go("/flokke#interesser");
    const [, slug, what] = answer as unknown as [string, string, string];
    if (what === "fjern") { await removeInterest(db, m.id, slug); return go(withMessage("/flokke", "interesse_fjernet") + "#interesser"); }
    if (what === "nej-tak") { await declineInterest(db, m.id, slug, now); return go(withMessage("/flokke", "nej_tak") + "#interesser"); }
    const result = await confirmInterest(db, m.id, slug, now);
    if ("error" in result) return go(withMessage("/flokke", `invitation_${result.error}`) + "#interesser");
    return go(withMessage(flockPath(result.flockId), "bekraeftet"));
  }

  if (path === "/flokke" && !post) {
    const m = await member();
    if (!m) return go(`/log-ind?naeste=${encodeURIComponent("/flokke")}`);
    const [flocks, interests, outings] = await Promise.all([memberFlocks(db, m.id), memberInterests(db, m.id), outingsUsed(db, m.id, now)]);
    // Cancelled events the member was going to, with three similar ones to choose instead.
    const cancelledSlugs = [...new Set([
      ...flocks.filter(f => f.event_status === "cancelled" && !eventOver(f, now)).map(f => f.event_slug),
      ...interests.filter(i => i.event_status === "cancelled" && i.status !== "declined" && i.status !== "expired" && (i.ends_at ?? i.starts_at + 3 * 3600_000) >= now).map(i => i.slug)
    ])].slice(0, 5);
    const cancelled = (await Promise.all(cancelledSlugs.map(async slug => {
      const event = await eventBySlug(db, slug);
      return event ? { event, similar: await relatedEvents(db, event, regions, now, 3) } : null;
    }))).filter((x): x is NonNullable<typeof x> => !!x);
    const active = interests.filter(i => i.event_status !== "cancelled");
    return { view: myFlocksPage(pc, m, flocks, message, { top: cancelledSection(cancelled, now), interests: interestsSection(active, now), outings }) };
  }

  const create = /^\/events\/([a-z0-9-]{1,90})\/opret-flok$/.exec(path)?.[1];
  if (create) {
    const e = await eventFor(db, create, regions);
    if (!e) return { view: notFound() };
    const action = `/events/${e.slug}/opret-flok`;
    const m = await member();
    if (!m) return go(`/log-ind?naeste=${encodeURIComponent(action)}`);
    if (!profileComplete(await profileFor(db, m.id))) return go(profilePath(action));
    if (!post) {
      if (e.status !== "scheduled" || e.starts_at <= now) return go(withMessage(`/events/${e.slug}`, "event_closed") + "#flokke");
      return { view: flockFormPage(pc, e, defaultFlockForm(e, now), {}, { mode: "create", action }) };
    }
    const data = await formData(request);
    if (!data) return { view: flockFormPage(pc, e, defaultFlockForm(e, now), { meetingPlace: "Formularen kunne ikke læses. Prøv igen." }, { mode: "create", action, status: 400 }) };
    const form = readFlockForm(data);
    const checked = validateFlockForm({ ...form, followsFlockId: "" }, e, now, { allowedFollows: [] });
    if ("errors" in checked) return { view: flockFormPage(pc, e, form, checked.errors, { mode: "create", action, status: 400 }) };
    const result = await createFlock(db, e, m.id, checked.input, now);
    if ("error" in result) return go(withMessage(`/events/${e.slug}`, result.error) + "#flokke");
    return go(withMessage(flockPath(result.id), "oprettet"));
  }

  // The flock's chat: GET (JSON) for new messages, POST to write, POST …/<message>/meld to report. Without JavaScript
  // the forms post and come back to the flock's page.
  const chat = /^\/flokke\/([0-9a-f-]{36})\/chat(?:\/([0-9a-f-]{36})\/meld)?$/.exec(path);
  if (chat) {
    const [, id, reportId] = chat as unknown as [string, string, string | undefined];
    const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");
    const here = flockPath(id);
    const fail = (code: string, status: number): FlokkenResult => wantsJson ? { json: { error: code, text: noticeText(code) }, status } : go(withMessage(here, code) + "#chat");
    const m = await member();
    if (!m) return wantsJson ? { json: { error: "login" }, status: 401 } : go(`/log-ind?naeste=${encodeURIComponent(here)}`);
    const access = await chatAccess(db, id, m.id);
    if (!access) return fail("not_member", 403);
    if (!post) {
      if (!wantsJson) return go(`${here}#chat`);
      const after = Number(url.searchParams.get("efter") ?? "0");
      const messages = await chatMessages(db, id, m.id, Number.isFinite(after) && after > 0 ? after : 0);
      return { json: { open: chatOpen(access, now), messages: messages.map(c => chatJson(c, m.id, now)) }, status: 200 };
    }
    if (reportId) {
      const result = await reportMessage(db, access, m.id, reportId, now);
      if ("error" in result) return fail(result.error, 400);
      return wantsJson ? { json: { ok: true, text: noticeText("meldt") }, status: 200 } : go(withMessage(here, "meldt") + "#chat");
    }
    const data = await formData(request);
    const result = await postMessage(db, access, m.id, String(data?.get("tekst") ?? ""), now);
    if ("error" in result) return fail(result.error, result.error === "chat_too_fast" ? 429 : 400);
    return wantsJson ? { json: { message: chatJson(result.message, m.id, now) }, status: 200 } : go(`${here}#chat`);
  }

  // The member's own photo, on their profile page.
  const mine = /^\/profil\/foto\/([0-9a-f-]{36})$/.exec(path);
  if (mine && !post) {
    const m = await member();
    const found = m ? await ownPhoto(db, m.id, mine[1]!) : null;
    if (!found) return { view: notFound() };
    return { image: { type: found.type, body: found.data } };
  }

  // A member's photo, for the others in the flock only.
  const photo = /^\/flokke\/([0-9a-f-]{36})\/foto\/([0-9a-f-]{36})$/.exec(path);
  if (photo && !post) {
    const m = await member();
    const found = m ? await flockPhoto(db, photo[1]!, photo[2]!, m.id) : null;
    if (!found) return { view: notFound() };
    return { image: { type: found.type, body: found.data } };
  }

  const flock = /^\/flokke\/([0-9a-f-]{36})(?:\/(bliv-del-af|forlad|ret))?$/.exec(path);
  if (flock) {
    const [, id, action] = flock as unknown as [string, string, string | undefined];
    const m = await member();
    const f = await flockById(db, id, m?.id ?? null);
    if (!f) return { view: notFound() };
    const here = flockPath(f.id);
    if (!action) {
      if (post) return null;
      const [e, people, ages, host, messages] = await Promise.all([eventBySlug(db, f.event_slug), f.is_member ? flockMembers(db, f.id, now) : Promise.resolve([]),
        m && !f.is_member ? flockAgeGroups(db, f.id) : Promise.resolve([]), flockHost(db, f),
        m && f.is_member ? chatMessages(db, f.id, m.id) : Promise.resolve([])]);
      const chat = f.is_member ? { messages, open: chatOpen({ status: f.status, eventEnds: f.event_ends_at ?? f.event_starts_at + 3 * 3600_000 }, now) } : null;
      return { view: flockPage(pc, f, e, people, m, host, message, chat, ages) };
    }
    if (!m) return go(`/log-ind?naeste=${encodeURIComponent(here)}`);
    if (action === "ret") {
      const e = await eventBySlug(db, f.event_slug);
      if (!e) return { view: notFound() };
      const editAction = `${here}/ret`;
      if (await flockHost(db, f) !== m.id || !f.is_member) return go(withMessage(here, "not_host"));
      if (!post) return { view: flockFormPage(pc, e, { meetingPlace: f.meeting_place, meetingAt: toLocalInput(f.meeting_at), note: f.note ?? "", maxSize: String(f.max_size), publicPlace: true, followsFlockId: "" }, {}, { mode: "edit", action: editAction }) };
      const data = await formData(request);
      if (!data) return go(editAction);
      const form = readFlockForm(data);
      const checked = validateFlockForm({ ...form, followsFlockId: "" }, e, now, { allowedFollows: [] });
      if ("errors" in checked) return { view: flockFormPage(pc, e, form, checked.errors, { mode: "edit", action: editAction, status: 400 }) };
      const result = await updateFlock(db, f, m.id, checked.input, now);
      return go(withMessage(here, "error" in result ? result.error : "rettet"));
    }
    if (!post) return go(here);
    if (action === "bliv-del-af") {
      if (!f.is_member && !profileComplete(await profileFor(db, m.id))) return go(profilePath(here, f.id));
      const result = await joinFlock(db, f, m.id, now);
      return go(withMessage(here, "error" in result ? result.error : "tilsluttet"));
    }
    if (action === "forlad") {
      const result = await leaveFlock(db, f, m.id, now);
      return go(withMessage(here, "error" in result ? result.error : "forladt"));
    }
  }
  return null;
}
