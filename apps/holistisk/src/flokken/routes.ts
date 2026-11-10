import type { D1Database } from "../db.js";
import type { Env } from "../env.js";
import { eventBySlug, type EventRow } from "../web/queries.js";
import type { PageContext } from "../web/layout.js";
import { cleanFirstName, clearSessionCookie, createMember, currentMember, endSession, memberByCode, normalizeCode, safeNext, sameSecret, startSession, type Member } from "./auth.js";
import { defaultFlockForm, readFlockForm, toLocalInput, validateFlockForm } from "./forms.js";
import { chatTime, findFlockPage, flockFormPage, flockPage, flockPath, loginPage, myFlocksPage, noticeText, profilePage, safetyPage, welcomePage, type View } from "./pages.js";
import { flockAgeGroups, flockMembers, flockPhoto, profileComplete, profileFor, PROFILE_MAX_BODY, readPhoto, readProfileForm, saveProfile, validateProfile } from "./profile.js";
import { chatAccess, chatMessages, chatOpen, postMessage, reportedMessages, reportMessage, type ChatMessage } from "./chat.js";
import { listInquiries, partnerPage, readInquiry, saveInquiry, validateInquiry } from "./partners.js";
import { choiceCookie, clearChoiceCookie, cleanChoices, joinOrStart, KICKOFF_PATH, kickoffJson, kickoffPage, outcomeCode, readChoices } from "./kickoff.js";
import { createFlock, flockById, flockHost, joinFlock, leaveFlock, memberFlocks, updateFlock, upcomingFlocks } from "./store.js";

/** Flokken's routes. Returns null for paths that are not Flokken's, so the portal's own routing goes on. */

export type FlokkenResult =
  | { view: View; cookie?: string }
  | { redirect: string; cookie?: string }
  | { json: unknown; status: number }
  | { image: { type: string; body: Uint8Array<ArrayBuffer> } };

const MAX_BODY = 20_000;
const go = (to: string, cookie?: string): FlokkenResult => ({ redirect: to, ...(cookie ? { cookie } : {}) });
const withMessage = (path: string, code: string) => `${path}${path.includes("?") ? "&" : "?"}besked=${encodeURIComponent(code)}`;

async function formData(request: Request, max = MAX_BODY): Promise<FormData | null> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > max) return null;
  try { return await request.formData(); } catch { return null; }
}

const bearerOk = (request: Request, env: Env): boolean => {
  const token = env.INGEST_TOKEN;
  const given = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  return !!token && token.length >= 24 && sameSecret(given, token);
};

/** Where a member who has not yet told the others their age group and a line about themselves goes first. `flock` is
 * a flock to join once that is done. */
const profilePath = (next: string, flock?: string) => `/profil?naeste=${encodeURIComponent(next)}${flock ? `&flok=${flock}` : ""}`;

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

  if (path === "/tryghed" && !post) return { view: safetyPage(pc) };
  if (path === "/find-en-flok" && !post) return { view: findFlockPage(pc, await upcomingFlocks(db, regions, now, 60)) };

  if (path === "/samarbejde") {
    if (!post) return { view: partnerPage(pc, { sent: message === "tak" }) };
    const data = await formData(request);
    if (!data) return { view: partnerPage(pc, { status: 400, errors: { organisation: "Formularen kunne ikke læses. Prøv igen." } }) };
    // A field people do not see; forms that fill it in are from robots.
    if (String(data.get("website_url") ?? "")) return go(withMessage("/samarbejde", "tak") + "#kontakt");
    const form = readInquiry(data);
    const errors = validateInquiry(form);
    if (Object.keys(errors).length) return { view: partnerPage(pc, { form, errors, status: 400 }) };
    await saveInquiry(db, form, now);
    return go(withMessage("/samarbejde", "tak") + "#kontakt");
  }
  if (path === "/api/samarbejde" && !post) {
    if (!bearerOk(request, env)) return { json: { error: "unauthorized" }, status: 401 };
    return { json: await listInquiries(db), status: 200 };
  }
  if (path === "/api/chat-meldinger" && !post) {
    if (!bearerOk(request, env)) return { json: { error: "unauthorized" }, status: 401 };
    return { json: await reportedMessages(db), status: 200 };
  }

  if (path === "/log-ind") {
    const next = safeNext(post ? null : url.searchParams.get("naeste"));
    if (!post) {
      if (await member()) return go(next);
      return { view: loginPage(pc, next) };
    }
    const data = await formData(request);
    const back = safeNext(String(data?.get("naeste") ?? ""));
    const code = normalizeCode(String(data?.get("kode") ?? ""));
    const found = code ? await memberByCode(db, code) : null;
    if (!found) return { view: loginPage(pc, back, { codeError: "Koden passer ikke. Den har 12 tegn, fx K7QF-29MX-T4HD.", status: 400 }) };
    return go(back, await startSession(db, found.id, now));
  }
  if (path === "/bliv-medlem" && post) {
    const data = await formData(request);
    const back = safeNext(String(data?.get("naeste") ?? ""));
    const raw = String(data?.get("fornavn") ?? "");
    const name = cleanFirstName(raw);
    if (!name) return { view: loginPage(pc, back, { name: raw.slice(0, 30), nameError: "Skriv dit fornavn (højst 30 bogstaver).", status: 400 }) };
    const { member: created, code } = await createMember(db, name, now);
    return { view: welcomePage(pc, created, code, back), cookie: await startSession(db, created.id, now) };
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
    const state = { next, joinId, profile, firstTime: !profileComplete(profile) };
    const action = `/profil${url.search}`;
    if (!post) return { view: profilePage(pc, { ...state, action, form: { firstName: profile.first_name, ageGroup: profile.age_group ?? "", intro: profile.intro ?? "", removePhoto: false }, errors: {} }) };
    const data = await formData(request, PROFILE_MAX_BODY);
    if (!data) return { view: profilePage(pc, { ...state, action, form: { firstName: profile.first_name, ageGroup: profile.age_group ?? "", intro: profile.intro ?? "", removePhoto: false }, errors: { photo: "Billedet er for stort. Vælg et mindre billede (højst 250 KB)." }, status: 400 }) };
    const form = readProfileForm(data);
    const checked = validateProfile(form);
    const photo = await readPhoto(data);
    const errors = { ...("errors" in checked ? checked.errors : {}), ...(photo && "error" in photo ? { photo: photo.error } : {}) };
    if ("errors" in checked || (photo && "error" in photo)) return { view: profilePage(pc, { ...state, action, form, errors, status: 400 }) };
    await saveProfile(db, m.id, checked.values, photo, form.removePhoto, now);
    if (joinId) {
      const f = await flockById(db, joinId, m.id);
      if (f) {
        const result = await joinFlock(db, f, m.id, now);
        return go(withMessage(flockPath(f.id), "error" in result ? result.error : "tilsluttet"));
      }
    }
    return go(withMessage(next, "profil_gemt"));
  }

  // "Lad os komme godt i gang": the pop-up's cards, the page, and joining the chosen flocks in one go.
  if (path === "/api/kom-godt-i-gang" && !post) {
    const m = await member();
    const ready = m ? profileComplete(await profileFor(db, m.id)) : false;
    return { json: await kickoffJson(db, regions, m, ready, now), status: 200 };
  }
  if (path === KICKOFF_PATH) {
    const m = await member();
    const ready = m ? profileComplete(await profileFor(db, m.id)) : false;
    if (!post) {
      // Coming back from becoming a member: first the profile, then back here (without ?videre, so "Fortryd" there
      // does not lead back to it).
      if (m && !ready && url.searchParams.has("videre")) return go(profilePath(KICKOFF_PATH));
      return { view: await kickoffPage(db, pc, regions, { memberId: m?.id ?? null, ready, chosen: readChoices(request), message }) };
    }
    const data = await formData(request);
    const slugs = cleanChoices((data?.getAll("event") ?? []).map(String));
    if (!slugs.length) return go(withMessage(KICKOFF_PATH, "intet_valgt"));
    if (!m) return go(`/log-ind?naeste=${encodeURIComponent(`${KICKOFF_PATH}?videre=1`)}`, choiceCookie(slugs));
    if (!ready) return go(profilePath(KICKOFF_PATH), choiceCookie(slugs));
    const outcome = await joinOrStart(db, slugs, regions, m.id, now);
    return go(withMessage("/flokke", outcomeCode(outcome)), clearChoiceCookie());
  }

  if (path === "/flokke" && !post) {
    const m = await member();
    if (!m) return go(`/log-ind?naeste=${encodeURIComponent("/flokke")}`);
    return { view: myFlocksPage(pc, m, await memberFlocks(db, m.id), message) };
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
