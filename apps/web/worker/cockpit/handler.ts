import type { D1Database } from "../db.js";
import { minutesDocText, minutesDocUrl, MAX_RECORDING_BYTES } from "../saga/drive.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { markdownToHtml } from "../saga/markdown.js";
import { splitMinutesDoc } from "../saga/picture.js";
import { processNextMinutes } from "../saga/saga.js";
import { queueMinutes } from "../saga/store.js";
import { cookie, loginBlocked, passwordMatches, readCookies, recordFailedLogin, SESSION_COOKIE, SESSION_DAYS, sessionValue, validSession, WHO_COOKIE } from "./auth.js";
import { allDecisions, allTasks, approvedMinutes, approvedMinutesById, boardMembers, boardPicture, deleteMeeting, meeting, meetingInput, meetings, minutesInProgress, saveMeeting, tasksFor } from "./data.js";
import { archivePage, decisionsPage, loginPage, meetingPage, meetingsPage, minutesPage, overviewPage, whoPage } from "./page.js";

/** Requested: "Lad os bygge cockpit.hjerterum.info for bestyrelsen. Her er der styr på referater og
 * dagsorden. Samt et overblik som er det jeg har i dag - både generelt og personligt (f.eks.
 * personlige todos) - baseret på hvem der er logget ind." - "Til start laver vi bare ét samlet login".
 * On cockpit.<domain> the cockpit is the whole site; elsewhere it lives under /cockpit. */

export const isCockpitRequest = (url: URL) => url.hostname.startsWith("cockpit.") || url.pathname === "/cockpit" || url.pathname.startsWith("/cockpit/");
const AUDIO = /\.(mp3|m4a|mp4|aac|wav|ogg|oga|webm)$/i;
const copenhagenDay = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(ms);

const HEADERS = {
  "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "same-origin", "x-robots-tag": "noindex, nofollow",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
};
const html = (body: string, status = 200, extra: Record<string, string> = {}) => new Response(body, { status, headers: { ...HEADERS, ...extra } });
const redirect = (location: string, cookies: string[] = []) => {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 303, headers });
};

export async function handleCockpitRequest(request: Request, env: SagaEnv, deps: SagaDeps): Promise<Response> {
  const url = new URL(request.url);
  const base = url.hostname.startsWith("cockpit.") ? "" : "/cockpit";
  const path = (base ? url.pathname.slice(base.length) : url.pathname) || "/";
  const secure = url.protocol === "https:";
  const now = deps.now();
  if (!env.DB) return html(loginPage(base, "", false), 503);
  const db: D1Database = env.DB;

  // Forms are only taken from the cockpit's own pages.
  if (request.method === "POST" && request.headers.get("origin") !== url.origin) return html(loginPage(base, "Siden blev sendt fra et andet sted. Prøv igen.", Boolean(env.COCKPIT_PASSWORD)), 403);

  if (path === "/login" && request.method === "POST") {
    if (!env.COCKPIT_PASSWORD) return html(loginPage(base, "", false), 503);
    if (await loginBlocked(db, request, now)) return html(loginPage(base, "For mange forsøg. Vent et kvarter, og prøv igen.", true), 429);
    const form = await request.formData().catch(() => null);
    const given = String(form?.get("password") ?? "");
    if (!given || !(await passwordMatches(given, env.COCKPIT_PASSWORD))) {
      await recordFailedLogin(db, request, now);
      return html(loginPage(base, "Forkert adgangskode.", true), 401);
    }
    const who = readCookies(request).get(WHO_COOKIE);
    return redirect(`${base}${who ? "/" : "/hvem"}`, [cookie(SESSION_COOKIE, await sessionValue(env.COCKPIT_PASSWORD, now), SESSION_DAYS * 86_400, secure)]);
  }
  if (path === "/logout" && request.method === "POST") return redirect(`${base}/`, [cookie(SESSION_COOKIE, "", 0, secure)]);

  const jar = readCookies(request);
  if (!(await validSession(env.COCKPIT_PASSWORD, jar.get(SESSION_COOKIE), now))) {
    return html(loginPage(base, "", Boolean(env.COCKPIT_PASSWORD)), env.COCKPIT_PASSWORD ? 401 : 503);
  }
  const members = await boardMembers(env, db);
  const saved = jar.get(WHO_COOKIE) ?? null;
  const who = saved && (!members.names.length || members.names.includes(saved)) ? saved : null;
  const today = copenhagenDay(now);

  if (path === "/hvem") {
    if (request.method === "POST") {
      const chosen = String((await request.formData().catch(() => null))?.get("who") ?? "").trim().slice(0, 60);
      if (!chosen || (members.names.length && !members.names.includes(chosen))) return html(whoPage(base, members.names, who), 400);
      return redirect(`${base}/`, [cookie(WHO_COOKIE, chosen, 365 * 86_400, secure)]);
    }
    return html(whoPage(base, members.names, who));
  }

  if (path === "/" && request.method === "GET") {
    const [{ picture, summary, at }, minutes, list, progress] = await Promise.all([boardPicture(db), approvedMinutes(db), meetings(db), minutesInProgress(db)]);
    const isChair = Boolean(who && members.chair && who === members.chair);
    const next = list.filter(m => m.meeting_date >= today).sort((a, b) => a.meeting_date.localeCompare(b.meeting_date))[0] ?? null;
    return html(overviewPage(base, { who, isChair, mine: who ? tasksFor(who, allTasks(minutes, picture)) : [], forChair: isChair ? picture?.forJacob ?? [] : [],
      next, picture, summary, at, progress, today }));
  }

  if (path === "/moder") {
    if (request.method === "POST") {
      const input = meetingInput(await request.formData());
      if (!input) return redirect(`${base}/moder`);
      const id = await saveMeeting(db, input, who ?? "", now);
      return redirect(`${base}/moder/${id}?gemt=1`);
    }
    const [list, minutes] = await Promise.all([meetings(db), approvedMinutes(db)]);
    const upcoming = list.filter(m => m.meeting_date >= today).sort((a, b) => a.meeting_date.localeCompare(b.meeting_date));
    const dates = [...new Set([...list.filter(m => m.meeting_date < today).map(m => m.meeting_date), ...minutes.map(m => m.meeting_date ?? "").filter(Boolean)])].sort().reverse();
    const past = dates.map(date => ({ date, meeting: list.find(m => m.meeting_date === date) ?? null, minutes: minutes.find(m => m.meeting_date === date) ?? null }));
    const notice = url.searchParams.get("upload") === "1" ? "Optagelsen er modtaget. Saga skriver referatet, og formanden får det til godkendelse." : "";
    return html(meetingsPage(base, { upcoming, past, today, who, notice, uploads: Boolean(env.BOARD_RECORDINGS) }));
  }

  const meetingPath = /^\/moder\/(\d+)(\/slet)?$/.exec(path);
  if (meetingPath) {
    const id = Number(meetingPath[1]);
    const found = await meeting(db, id);
    if (!found) return html(notFound(base, who), 404);
    if (request.method === "POST" && meetingPath[2]) { await deleteMeeting(db, id); return redirect(`${base}/moder`); }
    if (request.method === "POST") {
      const input = meetingInput(await request.formData());
      if (input) await saveMeeting(db, input, who ?? "", now, id);
      return redirect(`${base}/moder/${id}?gemt=1`);
    }
    const minutes = (await approvedMinutes(db)).find(m => m.meeting_date === found.meeting_date) ?? null;
    return html(meetingPage(base, found, minutes, who, url.searchParams.get("gemt") ? "Gemt." : ""));
  }

  const minutesPath = /^\/referat\/(\d+)$/.exec(path);
  if (minutesPath && request.method === "GET") {
    const minutes = await approvedMinutesById(db, Number(minutesPath[1]));
    if (!minutes) return html(notFound(base, who), 404);
    const body = /<body>([\s\S]*)<\/body>/.exec(markdownToHtml(minutes.draft_markdown ?? ""))?.[1] ?? "";
    return html(minutesPage(base, minutes, body, who));
  }

  if (path === "/beslutninger" && request.method === "GET") {
    const [{ picture }, minutes] = await Promise.all([boardPicture(db), approvedMinutes(db)]);
    return html(decisionsPage(base, allDecisions(minutes, picture), who));
  }

  if (path === "/arkiv" && request.method === "GET") {
    const minutes = await approvedMinutes(db);
    let history: Array<{ day: string; label: string; text: string }> = [], docError: string | null = null;
    if (!env.GOOGLE_MINUTES_DOC_ID) docError = "Referatdokumentet er ikke koblet på endnu.";
    else {
      try { history = splitMinutesDoc(await minutesDocText(env, deps)).map(({ day, label, text }) => ({ day, label, text })); }
      catch { docError = "Referatdokumentet kunne ikke læses lige nu. Prøv igen om lidt."; }
    }
    return html(archivePage(base, { minutes, history, docUrl: minutesDocUrl(env), docError, who }));
  }

  if (path === "/upload" && request.method === "POST") {
    if (!env.BOARD_RECORDINGS) return html(notFound(base, who), 503);
    const form = await request.formData().catch(() => null);
    const file = form?.get("recording");
    const date = String(form?.get("meeting_date") ?? "");
    if (!(file instanceof File) || !file.size) return redirect(`${base}/moder`);
    if (!AUDIO.test(file.name) && !file.type.startsWith("audio/")) return html(problem(base, who, "Filen er ikke en lydfil. Upload en mp3, m4a, wav eller ogg."), 400);
    if (file.size > MAX_RECORDING_BYTES) return html(problem(base, who, "Optagelsen er over 60 MB. Gem den i lavere kvalitet (fx m4a eller mp3), og prøv igen."), 413);
    const meetingDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today ? date : today;
    const extension = (AUDIO.exec(file.name)?.[1] ?? "m4a").toLowerCase();
    const key = `cockpit/${meetingDate}/${crypto.randomUUID()}.${extension}`;
    await env.BOARD_RECORDINGS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type || "audio/mp4" } });
    await queueMinutes(db, { source: "upload", fileId: key, fileName: file.name.slice(0, 200) || `optagelse.${extension}`, mimeType: file.type || null, meetingDate, nowMs: now });
    // Saga starts at once instead of at her next five-minute round.
    if (deps.waitUntil && env.SAGA_TELEGRAM_BOT_TOKEN && env.SAGA_OWNER_TELEGRAM_ID) deps.waitUntil(processNextMinutes(env, deps).catch(error => console.warn("cockpit_minutes_failed", error instanceof Error ? error.message : error)));
    return redirect(`${base}/moder?upload=1`);
  }

  return html(notFound(base, who), 404);
}

const notFound = (base: string, who: string | null) => problem(base, who, "Siden findes ikke.");
function problem(base: string, who: string | null, text: string): string {
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hjerterum bestyrelse</title></head>
<body style="font:15px/1.5 -apple-system,sans-serif;max-width:520px;margin:12vh auto;padding:0 16px"><p>${text.replace(/[<>&]/g, "")}</p><p><a href="${base}/">Til overblikket</a>${who ? "" : ""}</p></body></html>`;
}
