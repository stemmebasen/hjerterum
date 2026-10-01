import type { D1Database } from "../db.js";
import { minutesDocText, minutesDocUrl, MAX_RECORDING_BYTES } from "../saga/drive.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { markdownToHtml } from "../saga/markdown.js";
import { splitMinutesDoc } from "../saga/picture.js";
import { queueMinutes } from "../saga/store.js";
import { cookie, loginBlocked, passwordMatches, readCookies, recordFailedLogin, SESSION_COOKIE, SESSION_DAYS, sessionValue, validSession, WHO_COOKIE } from "./auth.js";
import { allDecisions, allTasks, approvedMinutes, approvedMinutesById, boardMembers, boardPicture, deleteMeeting, groupNow, meeting, meetingInput, meetingOn, meetings, minutesDecisions, minutesInProgress,
  minutesStatusByDate, minutesTasks, sagaMeetings, saveMeeting, signOff, signoffs, tasksFor, unsignedFor, weeklySummary } from "./data.js";
import { askInput, askSaga, DAILY_QUESTIONS, questionsToday } from "./ask.js";
import { comingEvents, eventStats, searchEvents } from "./events.js";
import { eventsPage } from "./eventsPage.js";
import { minutesDocument, MINUTES_STYLE, signoffPanel } from "./minutesDoc.js";
import { addCorrection, answerQuestion, corrections, handleCorrection } from "./corrections.js";
import { tellChairAboutCorrection } from "../saga/saga.js";
import { serviceStatus } from "../saga/store.js";
import { archivePage, decisionsPage, layout, loginPage, meetingPage, meetingsPage, morePage, overviewPage, shortDay, statusPage, whoPage, type PastMeeting } from "./page.js";

/** Requested: "Lad os bygge cockpit.hjerterum.info for bestyrelsen. Her er der styr på referater og
 * dagsorden. Samt et overblik som er det jeg har i dag - både generelt og personligt (f.eks.
 * personlige todos) - baseret på hvem der er logget ind." - "Til start laver vi bare ét samlet login".
 * On cockpit.<domain> the cockpit is the whole site; elsewhere it lives under /cockpit. */

export const isCockpitRequest = (url: URL) => url.hostname.startsWith("cockpit.") || url.pathname === "/cockpit" || url.pathname.startsWith("/cockpit/");
const AUDIO = /\.(mp3|m4a|mp4|aac|wav|ogg|oga|webm)$/i;
const copenhagenDay = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(ms);

const HEADERS = {
  "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "same-origin", "x-robots-tag": "noindex, nofollow",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data: https://d1tif55lvfk8gc.cloudfront.net; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
};
const answer = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
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

  // Requested: "Jeg synes dit overblik i matrix er super og detaljeret. Vi skal have det samme med" -
  // the chair's Hjerterum page in Matrix, for the whole board. Approving minutes and posts stays in
  // Telegram and Matrix: with one shared login, anyone could say they are the chair.
  if ((path === "/" || path === "/status") && request.method === "GET") {
    const [{ picture, summary, at }, minutes, list, progress, group, weekly] = await Promise.all([boardPicture(db, now), approvedMinutes(db), meetings(db), minutesInProgress(db),
      groupNow(env, db, now), weeklySummary(db)]);
    const isChair = Boolean(who && members.chair && who === members.chair);
    const next = list.filter(m => m.meeting_date >= today).sort((a, b) => a.meeting_date.localeCompare(b.meeting_date))[0] ?? null;
    const everyone = allTasks(minutes, picture);
    const toSign = who ? await unsignedFor(db, who, now) : [];
    return html((path === "/status" ? statusPage : overviewPage)(base, { who, isChair, toSign, mine: who ? tasksFor(who, everyone) : [], everyone, forChair: isChair ? picture?.forJacob ?? [] : [],
      next, found: sagaMeetings(picture, list, today), picture, summary, at, progress, today, group, weekly: weekly ?? null, docUrl: minutesDocUrl(env),
      recent: minutes.slice(0, 3).map(m => ({ id: m.id, date: m.meeting_date ?? "", decisions: minutesDecisions(m).map(d => d.text), tasks: minutesTasks(m).length })) }));
  }

  if (path === "/moder") {
    if (request.method === "POST") {
      const input = meetingInput(await request.formData());
      if (!input) return redirect(`${base}/moder`);
      const id = await saveMeeting(db, input, who ?? "", now);
      return redirect(`${base}/moder/${id}?gemt=1`);
    }
    const [list, minutes, { picture }, states, documentDays] = await Promise.all([meetings(db), approvedMinutes(db), boardPicture(db, now), minutesStatusByDate(db), meetingsInDocument(env, deps)]);
    const upcoming = list.filter(m => m.meeting_date >= today).sort((a, b) => a.meeting_date.localeCompare(b.meeting_date));
    // Held meetings: the ones in the calendar, the ones with minutes or a recording, and the ones in the board's own minutes document.
    const dates = [...new Set([...list.filter(m => m.meeting_date <= today).map(m => m.meeting_date), ...minutes.map(m => m.meeting_date ?? ""), ...states.keys(), ...documentDays]
      .filter(date => date && date <= today))].sort().reverse().slice(0, 40);
    const past: PastMeeting[] = dates.map(date => ({ date, meeting: list.find(m => m.meeting_date === date) ?? null, minutes: minutes.find(m => m.meeting_date === date) ?? null,
      state: states.get(date) ?? null, inDocument: documentDays.has(date) }));
    const asked = url.searchParams.get("dato") ?? "";
    const notice = url.searchParams.get("upload") === "1" ? "Optagelsen er modtaget. Saga går i gang inden for fem minutter (en lang optagelse tager lidt tid), og formanden får referatet til godkendelse i Telegram." : "";
    return html(meetingsPage(base, { upcoming, past,
      found: sagaMeetings(picture, list, today), suggestion: picture?.document.nextAgenda ?? [],
      prefill: { date: /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked >= today ? asked : "", agenda: url.searchParams.get("forslag") === "1" }, today, who, notice, uploads: Boolean(env.BOARD_RECORDINGS) }));
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
    const [all, states, { picture }] = await Promise.all([approvedMinutes(db), minutesStatusByDate(db), boardPicture(db, now)]);
    const notice = url.searchParams.get("upload") ? "Optagelsen er modtaget. Saga går i gang inden for fem minutter (en lang optagelse tager lidt tid), og formanden får referatet til godkendelse i Telegram." : url.searchParams.get("gemt") ? "Gemt." : "";
    return html(meetingPage(base, found, { minutes: all.find(m => m.meeting_date === found.meeting_date) ?? null, state: states.get(found.meeting_date) ?? null,
      suggestion: picture?.document.nextAgenda ?? [], today, uploads: Boolean(env.BOARD_RECORDINGS) }, who, notice));
  }

  // Each board member approves the minutes, or asks the chair for a correction.
  const signPath = /^\/referat\/(\d+)\/(godkend|rettelse)$/.exec(path);
  if (signPath && request.method === "POST") {
    const id = Number(signPath[1]);
    const minutes = await approvedMinutesById(db, id);
    if (!minutes || minutes.source === "document") return html(notFound(base, who), 404);
    if (!who) return redirect(`${base}/hvem`);
    if (signPath[2] === "godkend") { await signOff(db, id, who, "approved", null, now); return redirect(`${base}/referat/${id}?godkendt=1`); }
    const comment = String((await request.formData().catch(() => null))?.get("comment") ?? "").trim().slice(0, 2000);
    if (!comment) return redirect(`${base}/referat/${id}`);
    await signOff(db, id, who, "correction", comment, now);
    if (deps.waitUntil) deps.waitUntil(tellChairAboutCorrection(env, deps, id, who, comment).catch(error => console.warn("cockpit_correction_failed", error instanceof Error ? error.message : error)));
    return redirect(`${base}/referat/${id}?rettelse=1`);
  }

  // A member corrects one point, or answers Saga's question about a correction; Saga rewrites the point at once.
  const fixPath = /^\/referat\/(\d+)\/(?:punkt\/(\d+)|rettelse\/(\d+)\/svar)$/.exec(path);
  if (fixPath && request.method === "POST") {
    const id = Number(fixPath[1]);
    const minutes = await approvedMinutesById(db, id);
    if (!minutes) return html(notFound(base, who), 404);
    if (!who) return redirect(`${base}/hvem`);
    const form = await request.formData().catch(() => null);
    let correctionId = 0, point = 0;
    if (fixPath[2]) {
      point = Number(fixPath[2]);
      const text = String(form?.get("correction") ?? "").trim().slice(0, 2000);
      if (!text || point < 1 || point > 60) return redirect(`${base}/referat/${id}`);
      correctionId = await addCorrection(db, id, point, who, text, now);
    } else {
      correctionId = Number(fixPath[3]);
      const answer = String(form?.get("answer") ?? "").trim().slice(0, 2000);
      const row = (await corrections(db, id)).find(c => c.id === correctionId);
      if (!row || !answer || !(await answerQuestion(db, correctionId, who, answer, now))) return redirect(`${base}/referat/${id}`);
      point = row.point;
    }
    // Saga answers while the member waits; if she cannot now, the five-minute round tries again.
    if (env.AI_API_KEY && env.AI_MODEL) await handleCorrection(env, deps, correctionId).catch(error => console.warn("cockpit_correction_failed", error instanceof Error ? error.message : error));
    return redirect(`${base}/referat/${id}#punkt-${point}`);
  }

  const minutesPath = /^\/referat\/(\d+)$/.exec(path);
  if (minutesPath && request.method === "GET") {
    const minutes = await approvedMinutesById(db, Number(minutesPath[1]));
    if (!minutes) return html(notFound(base, who), 404);
    const notice = url.searchParams.get("godkendt") ? "Tak - din godkendelse er noteret." : url.searchParams.get("rettelse") ? "Tak - formanden har fået din rettelse." : "";
    const panel = signoffPanel(base, minutes, { members: members.names, signoffs: await signoffs(db, minutes.id), who, notice });
    const body = /<body>([\s\S]*)<\/body>/.exec(markdownToHtml(minutes.draft_markdown ?? ""))?.[1] ?? "";
    const planned = minutes.meeting_date ? await meetingOn(db, minutes.meeting_date) : null;
    return html(layout(base, `Referat ${minutes.meeting_date ? shortDay(minutes.meeting_date) : ""}`.trim(), `<main>${panel}${minutesDocument(base, minutes, planned, body, { who, corrections: await corrections(db, minutes.id) })}</main>`,
      { section: "/moder", who, style: MINUTES_STYLE }));
  }

  if (path === "/mere" && request.method === "GET") return html(morePage(base, who));

  if (path === "/beslutninger" && request.method === "GET") {
    const [{ picture }, minutes] = await Promise.all([boardPicture(db), approvedMinutes(db)]);
    return html(decisionsPage(base, allDecisions(minutes, picture), who));
  }

  if (path === "/arrangementer" && request.method === "GET") {
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100), yearText = url.searchParams.get("aar") ?? "";
    const year = /^20\d{2}$/.test(yearText) ? Number(yearText) : null;
    const [stats, coming, recent, results, backfill] = await Promise.all([eventStats(db, now), comingEvents(db, now, 60, 16),
      db.prepare("SELECT id, title, starts_at_ms, ends_at_ms, location, host, category, link, image_url, description, removed_at_ms FROM house_events WHERE starts_at_ms < ? AND removed_at_ms IS NULL ORDER BY starts_at_ms DESC LIMIT 20")
        .bind(now).all<Parameters<typeof eventsPage>[1]["recent"][number]>().then(r => r.results ?? []),
      query || year ? searchEvents(db, query, { year, limit: 100 }) : Promise.resolve(null), serviceStatus(db, "house_events_full")]);
    return html(eventsPage(base, { stats, coming, recent, results, query, year, thisYear: Number(today.slice(0, 4)), syncing: !backfill?.ok, who }));
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

  // Saga in the corner of every page: the answer goes only to the one asking.
  if (path === "/saga" && request.method === "POST") {
    const input = askInput(await request.json().catch(() => null));
    if (!input) return answer({ error: "Skriv et spørgsmål." }, 400);
    if (!env.AI_API_KEY || !env.AI_MODEL) return answer({ error: "Saga kan ikke svare lige nu (hendes AI er ikke sat op)." }, 503);
    if (await questionsToday(db, now) >= DAILY_QUESTIONS) return answer({ error: "Saga har svaret på mange spørgsmål det seneste døgn. Prøv igen i morgen." }, 429);
    try { return answer({ html: await askSaga(env, deps, db, who, input) }); }
    catch (error) {
      console.warn("cockpit_ask_failed", error instanceof Error ? error.message : error);
      return answer({ error: "Saga kunne ikke svare lige nu. Prøv igen om lidt." }, 502);
    }
  }

  if (path === "/upload" && request.method === "POST") {
    if (!env.BOARD_RECORDINGS) return html(notFound(base, who), 503);
    const form = await request.formData().catch(() => null);
    const file = form?.get("recording");
    // A meeting chosen in the list (or the meeting's own page), else the date written by hand.
    const choice = String(form?.get("meeting_choice") ?? "");
    const date = choice && choice !== "anden" ? choice : String(form?.get("meeting_date") ?? "");
    const meetingId = Number(form?.get("meeting_id") ?? 0);
    if (!(file instanceof File) || !file.size) return redirect(`${base}/moder`);
    if (!AUDIO.test(file.name) && !file.type.startsWith("audio/")) return html(problem(base, who, "Filen er ikke en lydfil. Upload en mp3, m4a, wav eller ogg."), 400);
    if (file.size > MAX_RECORDING_BYTES) return html(problem(base, who, "Optagelsen er over 60 MB. Gem den i lavere kvalitet (fx m4a eller mp3), og prøv igen."), 413);
    const meetingDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today ? date : today;
    const extension = (AUDIO.exec(file.name)?.[1] ?? "m4a").toLowerCase();
    const key = `cockpit/${meetingDate}/${crypto.randomUUID()}.${extension}`;
    await env.BOARD_RECORDINGS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type || "audio/mp4" } });
    await queueMinutes(db, { source: "upload", fileId: key, fileName: file.name.slice(0, 200) || `optagelse.${extension}`, mimeType: file.type || null, meetingDate, nowMs: now });
    // Saga takes it at her next five-minute round: a long recording needs minutes, and work left
    // running after a page's answer is stopped by Cloudflare after about 30 seconds.
    return redirect(Number.isSafeInteger(meetingId) && meetingId > 0 && await meeting(db, meetingId) ? `${base}/moder/${meetingId}?upload=1` : `${base}/moder?upload=1`);
  }

  return html(notFound(base, who), 404);
}

/** The days of the meetings in the board's minutes document; empty when it cannot be read. */
async function meetingsInDocument(env: SagaEnv, deps: SagaDeps): Promise<Set<string>> {
  if (!env.GOOGLE_MINUTES_DOC_ID) return new Set();
  try { return new Set(splitMinutesDoc(await minutesDocText(env, deps)).map(m => m.day)); }
  catch { return new Set(); }
}

const notFound = (base: string, who: string | null) => problem(base, who, "Siden findes ikke.");
function problem(base: string, who: string | null, text: string): string {
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hjerterum bestyrelse</title></head>
<body style="font:15px/1.5 -apple-system,sans-serif;max-width:520px;margin:12vh auto;padding:0 16px"><p>${text.replace(/[<>&]/g, "")}</p><p><a href="${base}/">Til overblikket</a>${who ? "" : ""}</p></body></html>`;
}
