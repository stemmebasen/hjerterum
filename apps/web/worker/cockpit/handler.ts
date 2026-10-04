import type { D1Database } from "../db.js";
import { minutesDocText, minutesDocUrl, MAX_RECORDING_BYTES } from "../saga/drive.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { markdownToHtml } from "../saga/markdown.js";
import { splitMinutesDoc } from "../saga/picture.js";
import { queueMinutes } from "../saga/store.js";
import { cookie, loginBlocked, passwordMatches, PERSON_COOKIE, PERSON_DAYS, personSessionValue, readCookies, readPersonSession, readSessionMember, recordFailedLogin, SESSION_COOKIE, MEMBER_COOKIE, sessionMemberValue, SESSION_DAYS, sessionValue, validSession, WHO_COOKIE } from "./auth.js";
import { linkMember, signedOutAfter, signOutMember, useLink } from "./personalLogin.js";
import { allDecisions, allTasks, approvedMinutes, approvedMinutesById, boardMembers, boardPicture, deleteMeeting, groupNow, meeting, meetingInput, meetingOn, meetings, minutesDecisions, minutesInProgress,
  minutesStatusByDate, minutesTasks, sagaMeetings, saveMeeting, signOff, signoffs, tasksFor, unsignedFor, weeklySummary,
  addTodo, checkedTasks, currentTasks, lastMonthTasks, taskChecksByKey, tasksByPerson, currentTodos, openFor, removeTodo, removedTasks, removeTaskFor, setTaskChecked, setTodoDone, todosFor } from "./data.js";
import { todosPage } from "./todosPage.js";
import { statsPage } from "./statsPage.js";
import { enquiryTopics, periodOf, siteStats } from "../site-stats.js";
import { logoResponse } from "./logo.js";
import { currentForChair, homePage } from "./home.js";
import { enquiries, postPage, openEnquiryCount, scanEnquiries, setHandled } from "./enquiries.js";
import { IMAGE_MAX, IMAGE_TYPES, latestStats, membersPage, readScreenshot, saveStats, statsInput, toBase64 } from "./members.js";
import { askInput, askSaga, DAILY_QUESTIONS, questionsToday } from "./ask.js";
import { suggestAgenda } from "./agenda.js";
import { latestBoardNow } from "./boardNow.js";
import { awaitingVote, castVote, toggleDiscuss, createProposal, proposals, voteDecisions, voteBlocks, withdrawProposal, type Vote } from "./votes.js";
import { knownContacts, listTeachers, saveContact, summarizeTeacher, teacherEvents, teacherKey, teacherPage, teacherRecord, teachersPage } from "./teachers.js";
import { comingEvents, eventStats, searchEvents } from "./events.js";
import { eventsPage } from "./eventsPage.js";
import { addFixedTeacher, createFromDraft, decideEvent, deskSection, discardDraft, draftEvent, draftFrom, draftPage, eventDraft, eventsForReview, fixedTeachers, openDrafts, parseDraft, removeFixedTeacher, reviewCount, saveDraft, DESK_STYLE } from "./eventDesk.js";
import { englishMinutes, minutesDocument, MINUTES_STYLE, signoffPanel } from "./minutesDoc.js";
import { addCorrection, closeSettled, answerQuestion, corrections, handleCorrection } from "./corrections.js";
import { tellChairAboutCorrection } from "../saga/saga.js";
import { markOwnerDone, serviceStatus } from "../saga/store.js";
import { connectTeamMail, disconnectTeamMail, readTeamMail, teamMailAccount } from "../saga/teamMail.js";
import { mailWatch } from "../saga/connections.js";
import { memberLang, setMemberLang, translateHtml, type Lang } from "./i18n.js";
import { AUTO_TRANSLATED, frontPageTexts, translatePage, translatedMinutes, translateMinutes, translateTexts, translations } from "./translate.js";
import { archivePage, decisionsPage, layout, linkPage, loginPage, meetingPage, meetingsPage, morePage, overviewPage, shortDay, statusPage, whoPage, type PastMeeting } from "./page.js";

/** Requested: "Lad os bygge cockpit.hjerterum.info for bestyrelsen. Her er der styr på referater og
 * dagsorden. Samt et overblik som er det jeg har i dag - både generelt og personligt (f.eks.
 * personlige todos) - baseret på hvem der er logget ind." - "Til start laver vi bare ét samlet login".
 * On cockpit.<domain> the cockpit is the whole site; elsewhere it lives under /cockpit. */

/** Requested: "Lad os kalde den admin.hjerterum.info". admin.<domain> (and cockpit.<domain>) is the
 * cockpit's own address: the whole site is the cockpit there. */
export const isCockpitHost = (hostname: string) => /^(?:admin|cockpit)\./i.test(hostname);
export const isCockpitRequest = (url: URL) => isCockpitHost(url.hostname) || url.pathname === "/cockpit" || url.pathname.startsWith("/cockpit/");
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

/** Requested: "Douglas taler engelsk" - "Ja byg det sådan". A member who reads in English gets every page translated
 * (cockpit/i18n.ts); the route below says which language the member has chosen. */
export async function handleCockpitRequest(request: Request, env: SagaEnv, deps: SagaDeps): Promise<Response> {
  const state: { lang: Lang } = { lang: "da" };
  const response = await route(request, env, deps, state);
  if (state.lang !== "en" || !(response.headers.get("content-type") ?? "").startsWith("text/html")) return response;
  const page = await response.text();
  // Requested: "I think that overview, tasks, and decisions should be automatically translated".
  const url = new URL(request.url);
  const path = (isCockpitHost(url.hostname) ? url.pathname : url.pathname.replace(/^\/cockpit/, "")) || "/";
  if (env.DB && response.status === 200 && AUTO_TRANSLATED.has(path)) {
    const english = await translatePage(env, deps, env.DB, page).catch(error => { console.warn("cockpit_page_translate_failed", error instanceof Error ? error.message : error); return null; });
    if (english) return new Response(english, { status: response.status, headers: response.headers });
  }
  return new Response(translateHtml(page), { status: response.status, headers: response.headers });
}

async function route(request: Request, env: SagaEnv, deps: SagaDeps, state: { lang: Lang }): Promise<Response> {
  const url = new URL(request.url);
  const base = isCockpitHost(url.hostname) ? "" : "/cockpit";
  // An old /cockpit/… link on the cockpit's own address goes to the same page without the prefix.
  if (!base && (url.pathname === "/cockpit" || url.pathname.startsWith("/cockpit/")) && (request.method === "GET" || request.method === "HEAD"))
    return new Response(null, { status: 301, headers: { location: (url.pathname.slice("/cockpit".length) || "/") + url.search, "cache-control": "no-store" } });
  const path = (base ? url.pathname.slice(base.length) : url.pathname) || "/";
  const secure = url.protocol === "https:";
  const now = deps.now();
  // Requested: the account locked to the member once identified - "1." (cockpit/personalLogin.ts). The
  // shared password stays until COCKPIT_SHARED_LOGIN is "off"; Saga's personal link always works.
  const shared = Boolean(env.COCKPIT_PASSWORD) && env.COCKPIT_SHARED_LOGIN !== "off";
  const botLink = env.SAGA_TELEGRAM_BOT_USERNAME && env.SAGA_TELEGRAM_BOT_TOKEN ? `https://t.me/${env.SAGA_TELEGRAM_BOT_USERNAME}?start=login` : null;
  const login = (message: string, status: number) => html(loginPage(base, message, shared, botLink), status);
  if (path === "/logo.png" && request.method === "GET") return logoResponse();
  if (!env.DB) return login("", 503);
  const db: D1Database = env.DB;

  // Forms are only taken from the cockpit's own pages.
  if (request.method === "POST" && request.headers.get("origin") !== url.origin) return login("Siden blev sendt fra et andet sted. Prøv igen.", 403);

  if (path === "/login" && request.method === "POST") {
    if (!shared || !env.COCKPIT_PASSWORD) return login("", 503);
    if (await loginBlocked(db, request, now)) return login("For mange forsøg. Vent et kvarter, og prøv igen.", 429);
    const form = await request.formData().catch(() => null);
    const given = String(form?.get("password") ?? "");
    if (!given || !(await passwordMatches(given, env.COCKPIT_PASSWORD))) {
      await recordFailedLogin(db, request, now);
      return login("Forkert adgangskode.", 401);
    }
    // A new login asks who you are (the name you had is preselected) - and then keeps it until you log out.
    return redirect(`${base}/hvem`, [cookie(SESSION_COOKIE, await sessionValue(env.COCKPIT_PASSWORD, now), SESSION_DAYS * 86_400, secure), cookie(MEMBER_COOKIE, "", 0, secure)]);
  }
  if (path === "/logout" && request.method === "POST") return redirect(`${base}/`, [cookie(SESSION_COOKIE, "", 0, secure), cookie(PERSON_COOKIE, "", 0, secure), cookie(MEMBER_COOKIE, "", 0, secure)]);

  // Saga's personal link: shown first (a link preview never logs anyone in), used with one press.
  const linkPath = /^\/login\/link\/([A-Za-z0-9_-]{20,64})$/.exec(path);
  if (linkPath) {
    const token = linkPath[1]!;
    if (request.method === "POST") {
      const member = env.SAGA_TELEGRAM_BOT_TOKEN ? await useLink(db, token, now) : null;
      if (!member) return html(linkPage(base, null, token), 410);
      return redirect(`${base}/`, [cookie(PERSON_COOKIE, await personSessionValue(env.SAGA_TELEGRAM_BOT_TOKEN!, member, now), PERSON_DAYS * 86_400, secure),
        cookie(WHO_COOKIE, member, PERSON_DAYS * 86_400, secure)]);
    }
    const member = await linkMember(db, token, now);
    return html(linkPage(base, member, token), member ? 200 : 410);
  }

  const jar = readCookies(request);
  const person = await readPersonSession(env.SAGA_TELEGRAM_BOT_TOKEN, jar.get(PERSON_COOKIE), now);
  const personal = person && person.issuedMs > await signedOutAfter(db, person.member) ? person.member : null;
  if (!personal && !(shared && await validSession(env.COCKPIT_PASSWORD, jar.get(SESSION_COOKIE), now))) return login("", shared || botLink ? 401 : 503);
  const members = await boardMembers(env, db);
  const saved = jar.get(WHO_COOKIE) ?? null;
  // A personal login is that member, and stays so; with the shared password you say who you are - once per login
  // (signed into the login, MEMBER_COOKIE). The plain name cookie only preselects the choice; it never decides who you are.
  const bound = personal ? null : await readSessionMember(env.COCKPIT_PASSWORD, jar.get(SESSION_COOKIE), jar.get(MEMBER_COOKIE));
  const who = personal ?? (bound && (!members.names.length || members.names.includes(bound)) ? bound : null);
  const today = copenhagenDay(now);
  state.lang = await memberLang(db, who);

  if (path === "/hvem") {
    // Requested: "Once you have logged in, you can't change to another person." Chosen once; only logging out undoes it.
    if (personal || who) return redirect(`${base}/`);
    if (request.method === "POST") {
      const chosen = String((await request.formData().catch(() => null))?.get("who") ?? "").trim().slice(0, 60);
      if (!chosen || (members.names.length && !members.names.includes(chosen))) return html(whoPage(base, members.names, saved), 400);
      return redirect(`${base}/`, [cookie(MEMBER_COOKIE, await sessionMemberValue(env.COCKPIT_PASSWORD!, jar.get(SESSION_COOKIE) ?? "", chosen), SESSION_DAYS * 86_400, secure),
        cookie(WHO_COOKIE, chosen, 365 * 86_400, secure)]);
    }
    return html(whoPage(base, members.names, saved));
  }

  // Requested: "Jeg synes dit overblik i matrix er super og detaljeret. Vi skal have det samme med" -
  // the chair's Hjerterum page in Matrix, for the whole board. Approving minutes and posts stays in
  // Telegram and Matrix: with one shared login, anyone could say they are the chair.
  if (path === "/" && request.method === "GET") {
    const [{ picture, summary, at }, minutes, list, progress, events, month, memberStats, newEnquiries] = await Promise.all([boardPicture(db, now), approvedMinutes(db), meetings(db), minutesInProgress(db),
      comingEvents(db, now, 30, 4), db.prepare("SELECT COUNT(*) AS n FROM house_events WHERE removed_at_ms IS NULL AND starts_at_ms >= ? AND starts_at_ms < ?").bind(now, now + 30 * 86_400_000).first<{ n: number }>(), latestStats(db), openEnquiryCount(db, now)]);
    const [eventsToReview, boardNow, votes, held] = await Promise.all([reviewCount(db, now), latestBoardNow(db), awaitingVote(db, who, now),
      db.prepare("SELECT COUNT(*) AS n, MIN(starts_at_ms) AS first FROM house_events WHERE removed_at_ms IS NULL AND starts_at_ms < ?").bind(now).first<{ n: number; first: number | null }>().catch(() => null)]);
    const isChair = Boolean(who && members.chair && who === members.chair);
    const next = list.filter(m => m.meeting_date >= today).sort((a, b) => a.meeting_date.localeCompare(b.meeting_date))[0] ?? null;
    const toSign = who ? await unsignedFor(db, who, now) : [];
    const open = who ? await openFor(db, who, allTasks(minutes, picture)) : { tasks: [], todos: [] };
    const latest = minutes.find(m => m.source !== "document") ?? minutes[0] ?? null;
    const approvals = latest ? (await signoffs(db, latest.id)).filter(x => x.status === "approved").length : 0;
    // Saga's own texts in English, when she has translated them.
    const english = state.lang === "en" ? await translations(db, await frontPageTexts(db, now)).catch(() => new Map<string, string>()) : null;
    return html(homePage(base, { tr: english ? (text: string) => english.get(text) ?? text : undefined, who, isChair, today, toSign, tasks: open.tasks, todos: open.todos, forChair: isChair ? currentForChair(picture?.forJacob ?? []) : [],
      next, found: sagaMeetings(picture, list, today), picture, summary, at, events, eventsMonth: month?.n ?? 0, eventsHeld: held?.n ?? 0, eventsSince: held?.first ?? null, progress, memberStats, newEnquiries, eventsToReview, boardNow, votes,
      latest: latest ? { id: latest.id, date: latest.meeting_date ?? "", decisions: minutesDecisions(latest).map(d => d.text), approved: approvals, members: latest.source === "document" ? 0 : members.names.length } : null }));
  }

  if (path === "/status" && request.method === "GET") {
    const [{ picture, summary, at }, minutes, list, progress, group, weekly] = await Promise.all([boardPicture(db, now), approvedMinutes(db), meetings(db), minutesInProgress(db),
      groupNow(env, db, now), weeklySummary(db)]);
    const isChair = Boolean(who && members.chair && who === members.chair);
    const next = list.filter(m => m.meeting_date >= today).sort((a, b) => a.meeting_date.localeCompare(b.meeting_date))[0] ?? null;
    const everyone = allTasks(minutes, picture);
    const toSign = who ? await unsignedFor(db, who, now) : [];
    const open = who ? await openFor(db, who, everyone) : { tasks: [], todos: [] };
    return html(statusPage(base, { who, isChair, toSign, mine: open.tasks, ownTodos: open.todos, everyone, forChair: isChair ? picture?.forJacob ?? [] : [],
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

  const meetingPath = /^\/moder\/(\d+)(\/slet|\/forslag)?$/.exec(path);
  if (meetingPath) {
    const id = Number(meetingPath[1]);
    const found = await meeting(db, id);
    if (!found) return html(notFound(base, who), 404);
    if (request.method === "POST" && meetingPath[2] === "/forslag") {
      // Requested: "Her bør Sagas forslag til dagsorden også kunne trigges."
      const [all, states] = await Promise.all([approvedMinutes(db), minutesStatusByDate(db)]);
      const page = (suggestion: string[], notice: string) => html(meetingPage(base, found, { minutes: all.find(m => m.meeting_date === found.meeting_date) ?? null, state: states.get(found.meeting_date) ?? null,
        suggestion, today, uploads: Boolean(env.BOARD_RECORDINGS), aiReady: Boolean(env.AI_API_KEY && env.AI_MODEL) }, who, notice));
      if (!env.AI_API_KEY || !env.AI_MODEL) return page([], "Saga kan ikke lave forslag lige nu (hendes AI er ikke sat op).");
      try {
        const items = await suggestAgenda(env, deps, db, found);
        return page(items, items.length ? "Sagas forslag er klar: tryk »Indsæt Sagas forslag«, ret til og tryk Gem." : "Saga fandt ikke noget at foreslå ud fra materialet.");
      } catch (error) {
        console.warn("cockpit_agenda_failed", error instanceof Error ? error.message : error);
        return page([], "Saga kunne ikke lave et forslag lige nu. Prøv igen om lidt.");
      }
    }
    if (request.method === "POST" && meetingPath[2]) { await deleteMeeting(db, id); return redirect(`${base}/moder`); }
    if (request.method === "POST") {
      const input = meetingInput(await request.formData());
      if (input) await saveMeeting(db, input, who ?? "", now, id);
      return redirect(`${base}/moder/${id}?gemt=1`);
    }
    const [all, states, { picture }] = await Promise.all([approvedMinutes(db), minutesStatusByDate(db), boardPicture(db, now)]);
    const notice = url.searchParams.get("upload") ? "Optagelsen er modtaget. Saga går i gang inden for fem minutter (en lang optagelse tager lidt tid), og formanden får referatet til godkendelse i Telegram." : url.searchParams.get("gemt") ? "Gemt." : "";
    return html(meetingPage(base, found, { minutes: all.find(m => m.meeting_date === found.meeting_date) ?? null, state: states.get(found.meeting_date) ?? null,
      suggestion: picture?.document.nextAgenda ?? [], today, uploads: Boolean(env.BOARD_RECORDINGS), aiReady: Boolean(env.AI_API_KEY && env.AI_MODEL) }, who, notice));
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
    await closeSettled(db, minutes.id);
    const notice = url.searchParams.get("godkendt") ? "Tak - din godkendelse er noteret." : url.searchParams.get("rettelse") ? "Tak - formanden har fået din rettelse."
      : url.searchParams.get("oversat") ? "Saga kunne ikke oversætte referatet lige nu. Prøv igen om lidt." : "";
    const panel = signoffPanel(base, minutes, { members: members.names, signoffs: await signoffs(db, minutes.id), who, notice });
    // Requested: "Douglas taler engelsk" - the minutes stay Danish as written; "Read in English" has Saga translate them once.
    const english = state.lang === "en" && minutes.draft_markdown && !url.searchParams.get("original") ? await translatedMinutes(db, minutes.draft_markdown) : null;
    if (english) return html(layout(base, `Minutes ${minutes.meeting_date ?? ""}`.trim(), `<main>${panel}${englishMinutes(base, minutes, english)}</main>`, { section: "/moder", who, style: MINUTES_STYLE }));
    const body = /<body>([\s\S]*)<\/body>/.exec(markdownToHtml(minutes.draft_markdown ?? ""))?.[1] ?? "";
    const readEnglish = state.lang === "en" && minutes.draft_markdown ? `<form method="post" action="${base}/referat/${minutes.id}/engelsk" class="m-sign" style="margin-bottom:12px" onsubmit="const b=this.querySelector('button');b.disabled=true;b.textContent='Saga is translating … (up to a minute)'"><button>Read in English</button></form>` : "";
    const planned = minutes.meeting_date ? await meetingOn(db, minutes.meeting_date) : null;
    return html(layout(base, `Referat ${minutes.meeting_date ? shortDay(minutes.meeting_date) : ""}`.trim(), `<main>${panel}${readEnglish}${minutesDocument(base, minutes, planned, body, { who, corrections: await corrections(db, minutes.id) })}</main>`,
      { section: "/moder", who, style: MINUTES_STYLE }));
  }

  const englishPath = /^\/referat\/(\d+)\/engelsk$/.exec(path);
  if (englishPath && request.method === "POST") {
    const minutes = await approvedMinutesById(db, Number(englishPath[1]));
    if (!minutes?.draft_markdown) return html(notFound(base, who), 404);
    const ok = await translateMinutes(env, deps, db, minutes.draft_markdown).then(() => true).catch(() => false);
    return redirect(`${base}/referat/${minutes.id}${ok ? "" : "?oversat=fejl"}`);
  }

  // Requested: "Der bør vær en engelsk oversættelses knap - Douglas taler engelsk" - "Ja byg det sådan": chosen once, per member.
  if (path === "/sprog" && request.method === "POST") {
    if (!who) return redirect(`${base}/hvem`);
    const lang: Lang = String((await request.formData().catch(() => null))?.get("lang") ?? "") === "en" ? "en" : "da";
    await setMemberLang(db, who, lang, now);
    // Saga's front-page texts right away, when the member asks for English.
    if (lang === "en") await translateTexts(env, deps, db, await frontPageTexts(db, now)).catch(error => console.warn("cockpit_translate_failed", error instanceof Error ? error.message : error));
    return redirect(`${base}/profil`);
  }

  const chairSignedIn = Boolean(personal && members.chair && personal === members.chair);
  if ((path === "/profil" || path === "/mere") && request.method === "GET") return html(morePage(base, who, { lang: state.lang, locked: Boolean(personal), members: chairSignedIn ? members.names.filter(n => n !== personal) : [], done: url.searchParams.get("lukket") }));
  // The chair (logged in with a personal link) closes a member's access on every device.
  if (path === "/adgang" && request.method === "POST") {
    const member = String((await request.formData().catch(() => null))?.get("member") ?? "");
    if (!chairSignedIn || !members.names.includes(member) || member === personal) return html(notFound(base, who), 403);
    await signOutMember(db, member, now);
    return redirect(`${base}/profil?lukket=${encodeURIComponent(member)}`);
  }

  // Requested: "en påmindelsesliste / to do-liste, hvor man skal krydse af de opgaver der er tildelt en.
  // Man kan også selv skrive ind." Each member's own list; an item can be written to another member.
  // Requested: "Lav også plads til en ny underside: Forespørgsler. Her scanner Saga mailboksen for Forespørgsler".
  // Requested: "Lad \"Forespørgsler\" blive til \"Posthus\" med alm mailboks" - the old address leads there.
  if (path === "/foresporgsler" && request.method === "GET") return redirect(`${base}/posthus${url.search}`);
  if (path === "/posthus" && request.method === "GET") {
    const all = url.searchParams.get("alle") === "1";
    const [data, watch, account] = await Promise.all([enquiries(db, now, all), mailWatch(db, now), who && who === members.chair ? teamMailAccount(db) : Promise.resolve(null)]);
    const mailNotice = ({ ok: "team@ er forbundet. Saga har læst indbakken og undermapperne.", login: "Mailserveren afviste adgangskoden. Intet er gemt.", adresse: "Brug en adresse på @holistisk.org.",
      fejl: "Mailserveren svarede ikke. Intet er gemt - prøv igen om lidt.", noegle: "Hjerterum mangler nøglen til at gemme adgangskoden. Intet er gemt.", afbrudt: "Forbindelsen til team@ er afbrudt." } as Record<string, string>)[url.searchParams.get("mail") ?? ""] ?? null;
    const notice = url.searchParams.has("scannet") ? `Saga har læst de nye mails${url.searchParams.get("scannet") !== "0" ? ` og fundet ${url.searchParams.get("scannet")} forespørgsler` : " - ingen nye forespørgsler"}.` : url.searchParams.has("fejl") ? "Saga kunne ikke læse mailene lige nu. Prøv igen om lidt." : "";
    return html(postPage(base, { who, ...data, notice, canScan: Boolean(env.AI_API_KEY && env.AI_MODEL), all, nowMs: now,
      watch: watch.state === "ok" ? `Mailen tjekkes løbende - ${watch.detail.charAt(0).toLowerCase()}${watch.detail.slice(1)}` : watch.detail, watchOk: watch.state === "ok",
      // Reported: "Jeg kan stadig ikke tjekke mail i cockpit" - logged in with the shared password the chair saw no card at all.
      // The chair always sees it; only connecting or disconnecting needs Saga's personal link (anyone could say they are the chair).
      mailbox: who && who === members.chair ? { address: account?.address ?? null, by: account?.connected_by ?? null, at: account?.connected_at_ms ?? null, notice: mailNotice,
        canChange: chairSignedIn, loginLink: botLink } : null }));
  }
  // Requested: "medmindre det er mere optimalt at oprette den i hjerterums admin?" - "Godt". Only the chair, logged in
  // with a personal link, connects or disconnects team@.
  if (path === "/posthus/forbind" && request.method === "POST") {
    if (!chairSignedIn || !personal) return html(notFound(base, who), 403);
    const form = await request.formData().catch(() => null);
    const outcome = await connectTeamMail(env, db, { address: String(form?.get("address") ?? ""), password: String(form?.get("password") ?? ""), by: personal, nowMs: now })
      .then(() => "ok").catch(error => {
        const code = error instanceof Error ? error.message : "";
        return code === "mail_login_failed" ? "login" : code === "mail_address_invalid" ? "adresse" : code === "mail_key_missing" ? "noegle" : "fejl";
      });
    if (outcome === "ok") await readTeamMail(env, deps, db).catch(error => console.warn("team_mail_first_read_failed", error instanceof Error ? error.message : error));
    return redirect(`${base}/posthus?mail=${outcome}#forbindelse`);
  }
  if (path === "/posthus/afbryd" && request.method === "POST") {
    if (!chairSignedIn) return html(notFound(base, who), 403);
    await disconnectTeamMail(db, now);
    return redirect(`${base}/posthus?mail=afbrudt#forbindelse`);
  }
  if ((path === "/posthus/klaret" || path === "/foresporgsler/klaret") && request.method === "POST") {
    if (!who) return redirect(`${base}/hvem`);
    const form = await request.formData().catch(() => null);
    const id = Number(form?.get("id"));
    if (Number.isSafeInteger(id) && id > 0) await setHandled(db, id, who, form?.get("done") === "1", now);
    return redirect(`${base}/posthus`);
  }
  if ((path === "/posthus/scan" || path === "/foresporgsler/scan") && request.method === "POST") {
    if (!env.AI_API_KEY || !env.AI_MODEL) return redirect(`${base}/posthus`);
    const found = await scanEnquiries(env, deps, db).catch(error => { console.warn("cockpit_enquiry_scan_failed", error instanceof Error ? error.message : error); return null; });
    return redirect(`${base}/posthus?${found === null ? "fejl=1" : `scannet=${found}`}`);
  }

  // Requested: "Hvis vi uploader et sådan skærmbillede til Saga ind i mellem, kan hun så opdatere det i systemet?"
  // Requested: "Byg en statistikside i jeres admin over besøg på jeres offentlige hjemmeside" (statsPage.ts, site-stats.ts).
  if (path === "/statistik" && request.method === "GET") {
    const stats = await siteStats(db, periodOf(url.searchParams.get("dage")), now);
    return html(statsPage(base, who, stats, Boolean(env.STATS_API_SECRET), await enquiryTopics(db, stats.from, stats.to)));
  }

  if (path === "/medlemmer" && request.method === "GET") {
    const [rows, history] = await Promise.all([latestStats(db), latestStats(db, 12)]);
    return html(membersPage(base, { who, rows, history, today, notice: url.searchParams.has("gemt") ? "Medlemstallene er gemt." : "" }));
  }
  if (path === "/medlemmer/laes" && request.method === "POST") {
    if (!who) return redirect(`${base}/hvem`);
    const file = (await request.formData().catch(() => null))?.get("billede");
    const [rows, history] = await Promise.all([latestStats(db), latestStats(db, 12)]);
    if (!(file instanceof File) || !IMAGE_TYPES.has(file.type) || !file.size || file.size > IMAGE_MAX || !env.AI_API_KEY || !env.AI_MODEL)
      return html(membersPage(base, { who, rows, history, today, read: null }));
    const read = await readScreenshot(env, deps, { type: file.type, base64: toBase64(new Uint8Array(await file.arrayBuffer())) }, today)
      .catch(error => { console.warn("cockpit_member_screenshot_failed", error instanceof Error ? error.message : error); return null; });
    return html(membersPage(base, { who, rows, history, today, read }));
  }
  if (path === "/medlemmer/gem" && request.method === "POST") {
    if (!who) return redirect(`${base}/hvem`);
    const input = statsInput(await request.formData(), today);
    if (!input) return redirect(`${base}/medlemmer`);
    await saveStats(db, input, who, now);
    return redirect(`${base}/medlemmer?gemt=1`);
  }

  if (path === "/opgaver" || path.startsWith("/opgaver/")) {
    if (!who) return redirect(`${base}/hvem`);
    if (request.method === "POST") {
      const form = await request.formData().catch(() => null);
      const field = (name: string, max: number) => String(form?.get(name) ?? "").trim().slice(0, max);
      if (path === "/opgaver/ny") {
        const text = field("text", 300), due = field("due", 10), owner = field("owner", 60) || who;
        if (!text || (members.names.length && !members.names.includes(owner) && owner !== who && owner !== "Alle")) return redirect(`${base}/opgaver`);
        await addTodo(db, { owner, text, due: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null, createdBy: who }, now);
        return redirect(`${base}/opgaver?${owner === who ? "tilfojet=1" : owner === "Alle" ? "alle=1" : `til=${encodeURIComponent(owner)}`}`);
      }
      // Requested: "make sure that there are no duplicates in the to-dos" - one line can stand for the same task from
      // several places (the minutes, the minutes document, Saga's list, your own); "also" carries the others.
      const lines = [[field("kind", 10), field("id", 400)], ...String(form?.get("also") ?? "").split(/\r?\n/).map(entry => entry.trim()).filter(Boolean).slice(0, 12)
        .map(entry => { const at = entry.indexOf(":"); return [entry.slice(0, at), entry.slice(at + 1, at + 401)]; })].filter(([kind, id]) => kind && id);
      const sagaItem = async (id: string) => (who === members.chair ? ((await boardPicture(db, now)).picture?.forJacob ?? []).find(f => f.key === id) : undefined);
      if (path === "/opgaver/afkryds") {
        const done = field("done", 1) === "1";
        for (const [kind, id] of lines) {
          if (kind === "punkt") { if (/^\d+$/.test(id!)) await setTodoDone(db, Number(id), who, done, now); }
          // Saga's questions and tasks for the chair - the same list Matrix shows him (chairTasks.ts).
          else if (kind === "saga") { const item = done ? await sagaItem(id!) : undefined; if (item) await markOwnerDone(db, item.key, item.text, now); }
          else if (kind === "opgave") await setTaskChecked(db, who, id!, done, now);
        }
        return redirect(`${base}/opgaver`);
      }
      // Requested: "I can't delete them." Your own items are deleted; a task from the minutes or Saga leaves your list.
      if (path === "/opgaver/fjern" || path === "/opgaver/slet") {
        for (const [kind, id] of path === "/opgaver/slet" ? [["punkt", field("id", 12)]] : lines) {
          if (kind === "punkt") { if (/^\d+$/.test(id!)) await removeTodo(db, Number(id), who); }
          else if (kind === "saga") { const item = await sagaItem(id!); if (item) await markOwnerDone(db, item.key, item.text, now); }
          else if (kind === "opgave") await removeTaskFor(db, who, id!, now);
        }
        return redirect(`${base}/opgaver`);
      }
      return html(notFound(base, who), 404);
    }
    if (path !== "/opgaver") return html(notFound(base, who), 404);
    const [{ picture }, minutes, checked, todos, removed] = await Promise.all([boardPicture(db, now), approvedMinutes(db), checkedTasks(db, who), todosFor(db, who), removedTasks(db, who)]);
    const sentTo = url.searchParams.get("til");
    const notice = url.searchParams.get("tilfojet") ? "Opgaven er skrevet på din liste." : url.searchParams.get("alle") ? "Opgaven er skrevet på hele bestyrelsens liste." : sentTo ? `Opgaven er skrevet på ${sentTo.slice(0, 60)}s liste.` : "";
    const all = currentTasks(allTasks(minutes, picture));
    const saga = who === members.chair ? currentForChair(picture?.forJacob ?? []) : [];
    return html(todosPage(base, { who, saga, members: members.names, tasks: tasksFor(who, all), checked, removed, todos: currentTodos(todos), notice, everyone: lastMonthTasks(allTasks(minutes, picture), now), boardChecks: await taskChecksByKey(db), now,
      votes: await awaitingVote(db, who, now) }));
  }

  // Requested: "Beslutninger og Afstemninger skal merges" - one page; the old address leads there.
  if (path === "/afstemninger" && request.method === "GET") return redirect(`${base}/beslutninger${url.search}`);
  if (path === "/beslutninger" && request.method === "GET") {
    const [{ picture }, minutes, voted, list] = await Promise.all([boardPicture(db), approvedMinutes(db), voteDecisions(db), proposals(db, now)]);
    const NOTICE: Record<string, string> = { ny: "Forslaget er stillet. Hele bestyrelsen har det nu på sin to-do.", stemt: "Din stemme er registreret.", afgjort: "Forslaget er allerede afgjort.", tilbage: "Forslaget er trukket tilbage.",
      droeft: "Noteret: du ønsker forslaget drøftet på et møde. Saga tager det med i sit forslag til næste dagsorden.", ikkedroeft: "Dit ønske om at drøfte forslaget på et møde er taget tilbage." };
    return html(decisionsPage(base, [...voted, ...allDecisions(minutes, picture)], who,
      { ...voteBlocks(base, { list, who, members: members.names.length }), notice: NOTICE[url.searchParams.get("besked") ?? ""] ?? "" }));
  }
  // Requested: "Vi skal også finde plads til et nyt punkt - \"Opret forslag til afstemning\"" (cockpit/votes.ts).
  if (path === "/afstemninger/ny" && request.method === "POST") {
    if (!who) return redirect(`${base}/hvem`);
    const form = await request.formData().catch(() => null);
    const id = await createProposal(db, { title: String(form?.get("title") ?? ""), text: String(form?.get("text") ?? ""), days: Number(form?.get("days") ?? 7), who,
      members: Math.max(members.names.length, 1) }, now);
    return redirect(`${base}/beslutninger${id ? `?besked=ny#p${id}` : ""}`);
  }
  if (path === "/afstemninger/stem" && request.method === "POST") {
    if (!who) return redirect(`${base}/hvem`);
    const form = await request.formData().catch(() => null);
    const id = Number(form?.get("id"));
    const ok = Number.isSafeInteger(id) && id > 0 && await castVote(db, id, who, String(form?.get("vote") ?? "") as Vote, now);
    return redirect(`${base}/beslutninger?besked=${ok ? "stemt" : "afgjort"}#p${id}`);
  }
  // Requested: "Til et forslag skal et medlem kunne notere: Jeg ønsker at drøfte dette på et møde".
  if (path === "/afstemninger/droeft" && request.method === "POST") {
    if (!who) return redirect(`${base}/hvem`);
    const id = Number((await request.formData().catch(() => null))?.get("id"));
    const done = Number.isSafeInteger(id) && id > 0 ? await toggleDiscuss(db, id, who, now) : null;
    return redirect(`${base}/beslutninger?besked=${done === "added" ? "droeft" : done === "removed" ? "ikkedroeft" : "afgjort"}#p${id}`);
  }
  if (path === "/afstemninger/tilbage" && request.method === "POST") {
    if (!who) return redirect(`${base}/hvem`);
    const id = Number((await request.formData().catch(() => null))?.get("id"));
    const ok = Number.isSafeInteger(id) && id > 0 && await withdrawProposal(db, id, who, now);
    return redirect(`${base}/beslutninger?besked=${ok ? "tilbage" : "afgjort"}`);
  }

  if (path === "/arrangementer" && request.method === "GET") {
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100), yearText = url.searchParams.get("aar") ?? "";
    const year = /^20\d{2}$/.test(yearText) ? Number(yearText) : null;
    const [stats, coming, recent, results, backfill, review, drafts, teachers] = await Promise.all([eventStats(db, now), comingEvents(db, now, 60, 16),
      db.prepare("SELECT id, title, starts_at_ms, ends_at_ms, location, host, category, link, image_url, description, removed_at_ms FROM house_events WHERE starts_at_ms < ? AND removed_at_ms IS NULL ORDER BY starts_at_ms DESC LIMIT 20")
        .bind(now).all<Parameters<typeof eventsPage>[1]["recent"][number]>().then(r => r.results ?? []),
      query || year ? searchEvents(db, query, { year, limit: 100 }) : Promise.resolve(null), serviceStatus(db, "house_events_full"),
      eventsForReview(db, now), openDrafts(db), fixedTeachers(db)]);
    const NOTICES: Record<string, string> = { godkendt: "Eventet er godkendt og vises nu offentligt.", afvist: "Eventet er afvist og vises ikke.", fast: "Listen over faste undervisere er opdateret.",
      fejl: "Saga kunne ikke lave et udkast lige nu. Prøv igen om lidt.", kasseret: "Udkastet er kasseret." };
    const desk = deskSection(base, { review, drafts, teachers, notice: NOTICES[url.searchParams.get("besked") ?? ""] ?? "", aiReady: Boolean(env.AI_API_KEY && env.AI_MODEL) });
    return html(eventsPage(base, { stats, coming, recent, results, query, year, thisYear: Number(today.slice(0, 4)), syncing: !backfill?.ok, who, desk }));
  }

  // Requested: "Vi skal også have en underside til arrangementer, som hedder Undervisere" (cockpit/teachers.ts).
  if (path === "/arrangementer/undervisere" && request.method === "GET") {
    return html(teachersPage(base, { teachers: await listTeachers(db, now), query: (url.searchParams.get("q") ?? "").trim().slice(0, 80), nowMs: now, who }));
  }
  const teacherPath = /^\/arrangementer\/undervisere\/([^/]+)$/.exec(path);
  if (teacherPath) {
    let key = "";
    try { key = teacherKey(decodeURIComponent(teacherPath[1]!)); } catch { key = ""; }
    const found = key ? (await listTeachers(db, now)).find(t => t.key === key) : undefined;
    const record = key ? await teacherRecord(db, key) : null;
    const name = found?.name ?? record?.name;
    if (!name) return html(notFound(base, who), 404);
    const here = `${base}/arrangementer/undervisere/${encodeURIComponent(key)}`;
    if (request.method === "POST") {
      if (!who) return redirect(`${base}/hvem`);
      const form = await request.formData().catch(() => null);
      if (form?.get("action") === "summary") {
        if (!env.AI_API_KEY || !env.AI_MODEL) return redirect(here);
        try { await summarizeTeacher(env, deps, db, name, who); return redirect(`${here}?besked=resume`); }
        catch (error) { console.warn("cockpit_teacher_summary_failed", error instanceof Error ? error.message : error); return redirect(`${here}?besked=fejl`); }
      }
      if (form) await saveContact(db, name, form, who, now);
      return redirect(`${here}?besked=gemt`);
    }
    const NOTICE: Record<string, string> = { gemt: "Kontaktoplysningerne er gemt.", resume: "Saga har lavet et nyt resumé.", fejl: "Saga kunne ikke lave et resumé lige nu. Prøv igen om lidt." };
    const [known, events] = await Promise.all([knownContacts(db, name), teacherEvents(db, name)]);
    return html(teacherPage(base, { name, record, known, events, fixed: found?.fixed ?? false, nowMs: now, notice: NOTICE[url.searchParams.get("besked") ?? ""] ?? "",
      aiReady: Boolean(env.AI_API_KEY && env.AI_MODEL), who }));
  }

  // Requested: "Vi skal også forberede Saga til at kunne hjælpe med at sætte et event op" (cockpit/eventDesk.ts).
  if (path === "/arrangementer/nyt" && request.method === "POST") {
    if (!who) return redirect(`${base}/hvem`);
    const wanted = String((await request.formData().catch(() => null))?.get("request") ?? "").trim().slice(0, 4000);
    if (!wanted || !env.AI_API_KEY || !env.AI_MODEL) return redirect(`${base}/arrangementer`);
    try { return redirect(`${base}/arrangementer/udkast/${await draftEvent(env, deps, db, wanted, who)}`); }
    catch (error) {
      console.warn("cockpit_event_draft_failed", error instanceof Error ? error.message : error);
      return redirect(`${base}/arrangementer?besked=fejl`);
    }
  }
  const draftPath = /^\/arrangementer\/udkast\/(\d+)$/.exec(path);
  if (draftPath) {
    const row = await eventDraft(db, Number(draftPath[1]));
    if (!row || row.status === "discarded") return html(notFound(base, who), 404);
    if (request.method === "GET") return html(layoutDraft(base, who, draftPage(base, row, url.searchParams.get("besked") ?? "")));
    if (request.method === "POST") {
      if (!who) return redirect(`${base}/hvem`);
      const form = await request.formData().catch(() => null);
      const action = String(form?.get("action") ?? "save");
      if (action === "discard") { await discardDraft(db, row.id, now); return redirect(`${base}/arrangementer?besked=kasseret`); }
      if (row.status === "draft" && form) await saveDraft(db, row.id, draftFrom({ ...parseDraft(row), ...Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")) }), now);
      if (action === "create") {
        const created = await createFromDraft(db, row.id, who, now);
        return redirect(`${base}/arrangementer/udkast/${row.id}?besked=${encodeURIComponent(created.ok ? "Eventet er oprettet i Hjerterums nye system. Husk MembershipWorks-teksten herunder, så længe vi kører begge systemer." : created.reason)}`);
      }
      return redirect(`${base}/arrangementer/udkast/${row.id}?besked=${encodeURIComponent("Gemt.")}`);
    }
  }
  if (path === "/arrangementer/godkend" && request.method === "POST") {
    if (!who) return redirect(`${base}/hvem`);
    const form = await request.formData().catch(() => null);
    const id = Number(form?.get("id")), approve = form?.get("decision") === "approve";
    if (Number.isSafeInteger(id) && id > 0) await decideEvent(db, id, approve, who, String(form?.get("note") ?? "").trim(), now);
    return redirect(`${base}/arrangementer?besked=${approve ? "godkendt" : "afvist"}`);
  }
  if (path === "/arrangementer/faste" && request.method === "POST") {
    if (!who) return redirect(`${base}/hvem`);
    const form = await request.formData().catch(() => null);
    const email = String(form?.get("email") ?? "");
    if (form?.get("remove") === "1") await removeFixedTeacher(db, email);
    else await addFixedTeacher(db, email, String(form?.get("name") ?? ""), who, now);
    return redirect(`${base}/arrangementer?besked=fast`);
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
    try { return answer({ html: await askSaga(env, deps, db, who, input, base, state.lang) }); }
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

const layoutDraft = (base: string, who: string | null, body: string) => layout(base, "Udkast til arrangement", body, { section: "/arrangementer", who, style: DESK_STYLE });
const notFound = (base: string, who: string | null) => problem(base, who, "Siden findes ikke.");
function problem(base: string, who: string | null, text: string): string {
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hjerterum bestyrelse</title></head>
<body style="font:15px/1.5 -apple-system,sans-serif;max-width:520px;margin:12vh auto;padding:0 16px"><p>${text.replace(/[<>&]/g, "")}</p><p><a href="${base}/">Til overblikket</a>${who ? "" : ""}</p></body></html>`;
}
