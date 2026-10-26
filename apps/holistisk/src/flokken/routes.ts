import type { D1Database } from "../db.js";
import type { Env } from "../env.js";
import { eventBySlug, type EventRow } from "../web/queries.js";
import type { PageContext } from "../web/layout.js";
import { cleanFirstName, clearSessionCookie, createMember, currentMember, endSession, memberByCode, normalizeCode, safeNext, sameSecret, startSession, type Member } from "./auth.js";
import { defaultFlockForm, readFlockForm, toLocalInput, validateFlockForm } from "./forms.js";
import { findFlockPage, flockFormPage, flockPage, flockPath, loginPage, myFlocksPage, safetyPage, welcomePage, type View } from "./pages.js";
import { giftCode, listInquiries, partnerPage, readInquiry, saveInquiry, validateInquiry } from "./partners.js";
import { createFlock, eftermoedeFlocks, eftermoedeInvitations, flockById, flockHost, flockMemberNames, joinFlock, leaveFlock, memberFlocks, setAgain, updateFlock, upcomingFlocks } from "./store.js";

/** Flokken's routes. Returns null for paths that are not Flokken's, so the portal's own routing goes on. */

export type FlokkenResult =
  | { view: View; cookie?: string }
  | { redirect: string; cookie?: string }
  | { json: unknown; status: number };

const MAX_BODY = 20_000;
const go = (to: string, cookie?: string): FlokkenResult => ({ redirect: to, ...(cookie ? { cookie } : {}) });
const withMessage = (path: string, code: string) => `${path}${path.includes("?") ? "&" : "?"}besked=${encodeURIComponent(code)}`;

async function formData(request: Request): Promise<FormData | null> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY) return null;
  try { return await request.formData(); } catch { return null; }
}

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
    const token = env.INGEST_TOKEN;
    const given = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
    if (!token || token.length < 24 || !sameSecret(given, token)) return { json: { error: "unauthorized" }, status: 401 };
    return { json: await listInquiries(db), status: 200 };
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

  if (path === "/flokke" && !post) {
    const m = await member();
    if (!m) return go(`/log-ind?naeste=${encodeURIComponent("/flokke")}`);
    const [flocks, invitations] = await Promise.all([memberFlocks(db, m.id), eftermoedeInvitations(db, m.id, now)]);
    return { view: myFlocksPage(pc, m, flocks, invitations, message) };
  }

  const create = /^\/events\/([a-z0-9-]{1,90})\/opret-flok$/.exec(path)?.[1];
  if (create) {
    const e = await eventFor(db, create, regions);
    if (!e) return { view: notFound() };
    const action = `/events/${e.slug}/opret-flok`;
    const m = await member();
    if (!m) return go(`/log-ind?naeste=${encodeURIComponent(action)}`);
    const follows = await eftermoedeFlocks(db, m.id, now);
    if (!post) {
      if (e.status !== "scheduled" || e.starts_at <= now) return go(withMessage(`/events/${e.slug}`, "event_closed") + "#flokke");
      return { view: flockFormPage(pc, e, defaultFlockForm(e, now), {}, { mode: "create", action, follows }) };
    }
    const data = await formData(request);
    if (!data) return { view: flockFormPage(pc, e, defaultFlockForm(e, now), { meetingPlace: "Formularen kunne ikke læses. Prøv igen." }, { mode: "create", action, follows, status: 400 }) };
    const form = readFlockForm(data);
    const checked = validateFlockForm(form, e, now, { allowedFollows: follows.map(f => f.id) });
    if ("errors" in checked) return { view: flockFormPage(pc, e, form, checked.errors, { mode: "create", action, follows, status: 400 }) };
    const result = await createFlock(db, e, m.id, checked.input, now);
    if ("error" in result) return go(withMessage(`/events/${e.slug}`, result.error) + "#flokke");
    return go(withMessage(flockPath(result.id), "oprettet"));
  }

  const flock = /^\/flokke\/([0-9a-f-]{36})(?:\/(bliv-del-af|forlad|eftermoedet|ret))?$/.exec(path);
  if (flock) {
    const [, id, action] = flock as unknown as [string, string, string | undefined];
    const m = await member();
    const f = await flockById(db, id, m?.id ?? null);
    if (!f) return { view: notFound() };
    const here = flockPath(f.id);
    if (!action) {
      if (post) return null;
      const [e, names, host] = await Promise.all([eventBySlug(db, f.event_slug), f.is_member ? flockMemberNames(db, f.id) : Promise.resolve([]), flockHost(db, f)]);
      return { view: flockPage(pc, f, e, names, m, host, message, f.is_member && e ? giftCode(env.FLOCK_GIFT_CODES, e) : null) };
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
      const result = await joinFlock(db, f, m.id, now);
      return go(withMessage(here, "error" in result ? result.error : "tilsluttet"));
    }
    if (action === "forlad") {
      const result = await leaveFlock(db, f, m.id, now);
      return go(withMessage(here, "error" in result ? result.error : "forladt"));
    }
    if (action === "eftermoedet") {
      const data = await formData(request);
      const answer = String(data?.get("svar") ?? "");
      if (answer !== "ja" && answer !== "nej") return go(here);
      const result = await setAgain(db, f, m.id, answer === "ja");
      return go(withMessage(here, "error" in result ? result.error : answer === "ja" ? "eftermoede_ja" : "eftermoede_nej") + "#eftermoedet");
    }
  }
  return null;
}
