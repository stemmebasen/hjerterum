import { scheduledEnquiryScan } from "../cockpit/enquiries.js";
import { scheduledEventReview } from "../cockpit/eventDesk.js";
import { scheduledBoardNow } from "../cockpit/boardNow.js";
import { scheduledBoardAccess } from "../cockpit/personalLogin.js";
import { archiveSiteMedia, scheduledSiteSync } from "../cockpit/site.js";
import { scheduledEnglishSummaries, scheduledTranslations } from "../cockpit/translate.js";
import { scheduledDecisionKinds } from "../cockpit/decisionKinds.js";
import { scheduledAgendaReminder } from "../cockpit/agenda.js";
import { scheduledRecordingCleanup } from "./recordingRetention.js";
import { removeDuplicateTodos } from "../cockpit/data.js";
import { mailWatch } from "./connections.js";
import { readTeamMail } from "./teamMail.js";
import { completeAs } from "./ai.js";
import { appendToDoc, createGoogleDoc, downloadDriveFile, driveAccessToken, listRecordings, MAX_RECORDING_BYTES, minutesDocText, minutesDocUrl, plainMinutes } from "./drive.js";
import { postsToBoard, requireDb, SAGA_NAME, type SagaDeps, type SagaEnv } from "./env.js";
import { markdownToHtml, section } from "./markdown.js";
import { transcribe } from "./transcribe.js";
import { docHash, parsePicture, trimMinutesDoc } from "./picture.js";
import { OVERVIEW_SYSTEM, boardContext, doneContext, mailContext, membersContext, MINUTES_SYSTEM, PRIVATE_SYSTEM, REPLY_SYSTEM, REVISE_SYSTEM, WEEKLY_SYSTEM } from "./prompts.js";
import {
  saveOverview, latestOverview, ownerDone, boardActivitySince, claimJob, serviceStatus, claimNextMinutes, insertMail, recentMail, createPostDraft, decideMinutes, decidePostDraft, getMinutes, getPostDraft, markPosted,
  plannedMeeting, queueMinutes, recentBoardMessages, recentMinutes, saveBoardMessage, updateMinutes, updatePostDraft
} from "./store.js";
import { approvalButtons, telegramClient } from "./telegram.js";
import { importDocMinutes } from "./importDoc.js";
import { boardKnowledge } from "../cockpit/ask.js";
import { boardMembers, memberDoneForSaga, responsibilities, responsibilitiesForSaga } from "../cockpit/data.js";
import { handlePendingCorrections } from "../cockpit/corrections.js";

const DAY = 86_400_000;
const copenhagenDate = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(ms);
const danishDate = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
};
const owner = (env: SagaEnv) => { if (!env.SAGA_OWNER_TELEGRAM_ID) throw new Error("owner_not_configured"); return env.SAGA_OWNER_TELEGRAM_ID; };
const board = (env: SagaEnv) => { if (!env.SAGA_BOARD_CHAT_ID) throw new Error("board_not_configured"); return env.SAGA_BOARD_CHAT_ID; };

/** The board's minutes document, trimmed to what fits (its newest meetings), and a
 * fingerprint of all of it. Never stops Saga: without it she answers from the chat and her own minutes. */
async function readArchive(env: SagaEnv, deps: SagaDeps, max = 30_000): Promise<{ text: string; hash: string }> {
  if (!env.GOOGLE_MINUTES_DOC_ID) return { text: "", hash: "none" };
  try {
    const text = (await minutesDocText(env, deps)).trim();
    return { text: trimMinutesDoc(text, max), hash: await docHash(text) };
  } catch (error) {
    console.warn("saga_doc_read_failed", error instanceof Error ? error.message : error);
    return { text: "", hash: "unread" };
  }
}
const archive = async (env: SagaEnv, deps: SagaDeps, max?: number) => (await readArchive(env, deps, max)).text;

async function context(env: SagaEnv, deps: SagaDeps, days = 30, doc?: string) {
  const db = requireDb(env);
  return boardContext(await recentBoardMessages(db, board(env), deps.now() - days * DAY), await recentMinutes(db, 3), doc ?? await archive(env, deps),
    mailContext(await recentMail(db, deps.now() - Math.min(days, 14) * DAY, 60)));
}

// ---- Hjerterum's mailbox ----

export type RelayedMail = { ref: string; from: string; subject: string; receivedAt: string; text: string };

/** New mails to team@ (relayed from Matrix) are kept, each once, as background for the overview.
 * Requested: "jeg skal ikke have hjælp til de daglige mails. Det er ikke mig der står for team@" -
 * no mail is judged one by one or sent on to the chair (and no AI call). */
export async function watchMail(env: SagaEnv, deps: SagaDeps, mails: RelayedMail[]): Promise<{ received: number; fresh: number }> {
  const db = requireDb(env);
  const fresh: number[] = [];
  for (const mail of mails) {
    const at = Date.parse(mail.receivedAt);
    const id = await insertMail(db, { ref: mail.ref, sender: mail.from.slice(0, 320), subject: (mail.subject || "(intet emne)").slice(0, 500),
      receivedAtMs: Number.isFinite(at) ? at : deps.now(), preview: mail.text.replace(/\s+/g, " ").trim().slice(0, 1500), nowMs: deps.now() });
    if (id) fresh.push(id);
  }
  return { received: mails.length, fresh: fresh.length };
}

/** Every post to the board goes through here: saved as pending and sent to Jacob with Godkend/Afvis. */
export async function proposePost(env: SagaEnv, deps: SagaDeps, kind: "reply" | "weekly_summary" | "announcement", text: string, replyTo?: number): Promise<number> {
  const db = requireDb(env);
  const id = await createPostDraft(db, { kind, text, replyTo: replyTo ?? null, nowMs: deps.now() });
  const label = kind === "reply" ? "Svar i bestyrelseschatten" : kind === "weekly_summary" ? "Ugeopsummering til bestyrelsen" : "Opslag i bestyrelseschatten";
  const sent = await telegramClient(env, deps).sendMessage(owner(env), `${label} - venter på dit ok:\n\n${text}\n\nSvar på denne besked for at rette teksten.`, { buttons: approvalButtons("post", id) });
  await updatePostDraft(db, id, { approvalMessageId: sent.message_id });
  return id;
}

export async function approvePost(env: SagaEnv, deps: SagaDeps, id: number, approve: boolean): Promise<string> {
  const db = requireDb(env);
  const draft = await getPostDraft(db, id);
  if (!draft || !(await decidePostDraft(db, id, approve ? "approved" : "rejected", deps.now()))) return "Allerede afgjort.";
  const telegram = telegramClient(env, deps);
  if (draft.approval_message_id) await telegram.editMessageReplyMarkup(owner(env), draft.approval_message_id).catch(() => undefined);
  if (!approve) return "Afvist - intet sendt.";
  try {
    const sent = await telegram.sendMessage(board(env), draft.text, draft.reply_to_message_id ? { replyTo: draft.reply_to_message_id } : {});
    await markPosted(db, id, sent.message_id);
    await saveBoardMessage(db, { chatId: board(env), messageId: sent.message_id, author: SAGA_NAME, authorId: null, text: draft.text, sentAtMs: deps.now(), fromAssistant: true });
    return "Sendt til bestyrelsen.";
  } catch (error) {
    await markPosted(db, id, null, error instanceof Error ? error.message : "post_failed");
    return "Kunne ikke sendes - prøv igen senere.";
  }
}

export async function revisePost(env: SagaEnv, deps: SagaDeps, id: number, instruction: string): Promise<void> {
  const db = requireDb(env);
  const draft = await getPostDraft(db, id);
  if (!draft || draft.status !== "pending") return;
  const text = await completeAs("ret-tekst")(env, deps, [{ role: "system", content: REVISE_SYSTEM }, { role: "user", content: `TEKST:\n${draft.text}\n\nRETTELSE:\n${instruction}` }]);
  await updatePostDraft(db, id, { text });
  const telegram = telegramClient(env, deps);
  if (draft.approval_message_id) await telegram.editMessageReplyMarkup(owner(env), draft.approval_message_id).catch(() => undefined);
  const sent = await telegram.sendMessage(owner(env), `Rettet - venter på dit ok:\n\n${text}\n\nSvar på denne besked for at rette igen.`, { buttons: approvalButtons("post", id) });
  await updatePostDraft(db, id, { approvalMessageId: sent.message_id });
}

/** Someone in the board chat asked Saga something: the answer is drafted for Jacob's approval. */
export async function draftBoardReply(env: SagaEnv, deps: SagaDeps, question: string, author: string, replyTo: number): Promise<void> {
  const answer = await completeAs("svar-gruppe")(env, deps, [{ role: "system", content: REPLY_SYSTEM },
    { role: "user", content: `${await context(env, deps)}\n\nSPØRGSMÅL FRA ${author}:\n${question}` }]);
  await proposePost(env, deps, "reply", answer, replyTo);
}

export async function answerOwnerPrivately(env: SagaEnv, deps: SagaDeps, question: string): Promise<void> {
  // The same knowledge as in the board cockpit (statutes, decisions, meetings, events, all the minutes,
  // the group and team@'s mail).
  const db = requireDb(env);
  const answer = await completeAs("privat-svar")(env, deps, [{ role: "system", content: PRIVATE_SYSTEM },
    { role: "user", content: `${await boardKnowledge(env, deps, db, question)}\n\nJACOB SPØRGER:\n${question}` }]);
  await telegramClient(env, deps).sendMessage(owner(env), answer);
}

export async function draftWeeklySummary(env: SagaEnv, deps: SagaDeps): Promise<boolean> {
  const messages = await recentBoardMessages(requireDb(env), board(env), deps.now() - 7 * DAY);
  if (!messages.some(m => !m.from_assistant) && !(await recentMail(requireDb(env), deps.now() - 7 * DAY, 1)).length) return false;
  const summary = await completeAs("ugeresume")(env, deps, [{ role: "system", content: WEEKLY_SYSTEM }, { role: "user", content: await context(env, deps, 7) }]);
  if (postsToBoard(env)) { await proposePost(env, deps, "weekly_summary", summary); return true; }
  // Listening only: the summary is the chair's own, straight to him (and to Matrix).
  const db = requireDb(env);
  const id = await createPostDraft(db, { kind: "weekly_summary", text: summary, nowMs: deps.now() });
  const sent = await telegramClient(env, deps).sendMessage(owner(env), `Ugen i bestyrelsen:\n\n${summary}`);
  if (await decidePostDraft(db, id, "approved", deps.now())) await markPosted(db, id, sent.message_id);
  return true;
}

/** Requested: "Jeg skal ikke se mails. Jeg skal have overordnet resume" - the board as a whole,
 * from its group, the minutes, the minutes document and team@, for the chair's Hjerterum page.
 * The same one AI call also gives the picture as data: the group's topics, the document's
 * decisions, proposals and tasks, and one list of what waits on Jacob ("Ja!" - "Men vi skal også
 * have lavet en lignende analyse af dokumentet"). A plain-text answer is kept as it is. */
export async function draftOverview(env: SagaEnv, deps: SagaDeps, doc?: { text: string; hash: string }): Promise<void> {
  const db = requireDb(env), since = deps.now() - 14 * DAY;
  // Nothing written, mailed or recorded: nothing to sum up (and no AI call).
  if (!(await recentBoardMessages(db, board(env), since, 1)).length && !(await recentMail(db, since, 1)).length && !(await recentMinutes(db, 1)).length) return;
  const read = doc ?? await readArchive(env, deps);
  const done = await ownerDone(db, deps.now() - 60 * DAY);
  const messages = [{ role: "system" as const, content: OVERVIEW_SYSTEM }, { role: "user" as const, content: `I DAG: ${danishDate(copenhagenDate(deps.now()))}\n\n${await context(env, deps, 14, read.text)}${doneContext(done)}${membersContext(responsibilitiesForSaga((await boardMembers(env, db)).names, await responsibilities(db)), await memberDoneForSaga(db, deps.now() - 60 * DAY))}` }];
  let answer = await completeAs("telegram-samtale")(env, deps, messages);
  let picture = parsePicture(answer);
  // Reported: the cockpit greeted with "```json {" - the answer was cut off mid-JSON (too long) and kept as
  // text. Once more, shorter; and a broken answer is never saved - the last good overview stands.
  if (!picture && looksLikeJson(answer)) {
    answer = await completeAs("telegram-samtale")(env, deps, [...messages, { role: "assistant", content: answer.slice(0, 2000) },
      { role: "user", content: "Dit svar blev for langt og blev afbrudt. Svar igen med præcis samme JSON-form, men kortere: højst 8 punkter i hver liste og korte tekster. Kun JSON." }]);
    picture = parsePicture(answer);
  }
  if (!picture && looksLikeJson(answer)) {
    console.warn("saga_overview_unreadable", answer.length);
    return;
  }
  await saveOverview(db, picture ? picture.summary : answer, deps.now(), { data: picture ? JSON.stringify(picture) : null, docHash: read.hash });
}

const looksLikeJson = (answer: string) => /^\s*(?:```|\{)/.test(answer);

/** Whether the overview is out of date: something new in the group, the mail or the minutes, the
 * minutes document changed since it was read (read without AI), or it predates the picture. */
export async function overviewStale(env: SagaEnv, deps: SagaDeps, db: NonNullable<SagaEnv["DB"]>): Promise<{ stale: boolean; doc?: { text: string; hash: string } }> {
  const last = await latestOverview(db);
  if (!last || last.doc_hash === null || await boardActivitySince(db, board(env), last.created_at_ms)) return { stale: true };
  // A picture from before Saga sent matters on to the members they concern (forMembers) is made again, so they get their lists at once.
  if (last.data && !last.data.includes('"forMembers"')) return { stale: true };
  if (!env.GOOGLE_MINUTES_DOC_ID) return { stale: false };
  const doc = await readArchive(env, deps);
  return { stale: doc.hash !== "unread" && doc.hash !== last.doc_hash, doc };
}

// ---- Minutes ----

/** A recording Jacob sent Saga privately. Telegram lets a bot download at most 20 MB. */
export async function queueTelegramRecording(env: SagaEnv, deps: SagaDeps, file: { fileId: string; fileName: string; mimeType: string | null; size: number }): Promise<string> {
  if (file.size > 20 * 1024 * 1024) return "Filen er over 20 MB, som er Telegrams grænse for bots. Læg optagelsen i Drev-mappen til optagelser, så tager jeg den derfra.";
  const queued = await queueMinutes(requireDb(env), { source: "telegram", fileId: file.fileId, fileName: file.fileName, mimeType: file.mimeType, meetingDate: copenhagenDate(deps.now()), nowMs: deps.now() });
  return queued ? "Modtaget. Jeg transskriberer optagelsen og sender dig et referatudkast til godkendelse." : "Den optagelse har jeg allerede fået.";
}

/** New recordings in the Drive recordings folder are queued (each file once). */
export async function queueDriveRecordings(env: SagaEnv, deps: SagaDeps): Promise<number> {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON || !env.GOOGLE_DRIVE_RECORDINGS_FOLDER_ID) return 0;
  const token = await driveAccessToken(env, deps);
  let queued = 0;
  for (const file of await listRecordings(env, deps, token)) {
    const meetingDate = file.createdTime ? copenhagenDate(Date.parse(file.createdTime)) : null;
    if (await queueMinutes(requireDb(env), { source: "drive", fileId: file.id, fileName: file.name, mimeType: file.mimeType, meetingDate, nowMs: deps.now() })) queued++;
  }
  return queued;
}

async function sendMinutesForApproval(env: SagaEnv, deps: SagaDeps, id: number, markdown: string, meetingDate: string | null, note: string): Promise<void> {
  const sent = await telegramClient(env, deps).sendDocument(owner(env), `Referat ${meetingDate ?? ""}.md`.replace(/\s+\.md$/, ".md"), markdown,
    `${note}\n\n${postsToBoard(env) ? "Godkend = gem på Drevet og del beslutninger og opgaver i bestyrelseschatten." : "Godkend = gem på Drevet (intet deles i gruppen)."} Svar på denne besked for at rette referatet.`, approvalButtons("minutes", id));
  await updateMinutes(requireDb(env), id, { approvalMessageId: sent.message_id }, deps.now());
}

/** Transcribes and drafts the oldest queued recording; a failure is retried up to three times. */
export async function processNextMinutes(env: SagaEnv, deps: SagaDeps): Promise<boolean> {
  const db = requireDb(env);
  const item = await claimNextMinutes(db, deps.now());
  if (!item) return false;
  try {
    let audio: ArrayBuffer;
    if (item.source === "drive") audio = await downloadDriveFile(deps, await driveAccessToken(env, deps), item.source_file_id);
    else if (item.source === "upload") {
      // Uploaded in the board cockpit (cockpit/handler.ts) and kept in R2 until now.
      const stored = await env.BOARD_RECORDINGS?.get(item.source_file_id);
      if (!stored) throw new Error("recording_not_found");
      audio = await stored.arrayBuffer();
    }
    else audio = await telegramClient(env, deps).downloadFile(item.source_file_id);
    if (audio.byteLength > MAX_RECORDING_BYTES) throw new Error("recording_too_large");
    const transcript = await transcribe(env, deps, audio, item.file_name, item.mime_type ?? "");
    const draft = await completeAs("referat")(env, deps, [{ role: "system", content: MINUTES_SYSTEM },
      { role: "user", content: `Mødedato: ${danishDate(item.meeting_date) || "ukendt"}${await agendaFor(db, item.meeting_date)}\n\nTRANSSKRIPTION:\n${transcript}`
        + await archive(env, deps, 8_000).then(text => text ? `\n\nBAGGRUND - tidligere referater (kun til navne og sammenhæng; referatet skrives ud fra transskriptionen):\n${text}` : "") }]);
    await updateMinutes(db, item.id, { status: "drafted", transcript, draft, error: null }, deps.now());
    await publishMinutes(env, deps, item.id, `Referat fra ${item.file_name}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "minutes_failed";
    const final = message === "recording_too_large" || message === "recording_not_found" || item.attempts >= 3;
    await updateMinutes(db, item.id, { status: final ? "failed" : "queued", error: message }, deps.now());
    if (final) await telegramClient(env, deps).sendMessage(owner(env), message === "recording_too_large"
      ? `Optagelsen ${item.file_name} er for stor til at behandle (over 60 MB). Gem den gerne i lavere kvalitet (fx m4a/mp3) og læg den ind igen.`
      : `Jeg kunne ikke lave referat af ${item.file_name} (${message}).`).catch(() => undefined);
  }
  return true;
}

/** Requested: "Her skal vi lave et pænt layout og alt med dagsorden i toppen" - the agenda the board
 * wrote in the cockpit for the meeting, so the minutes follow its points in order. */
async function agendaFor(db: ReturnType<typeof requireDb>, day: string | null): Promise<string> {
  const planned = day ? await plannedMeeting(db, day).catch(() => null) : null;
  const points = (planned?.agenda ?? "").split("\n").map(line => line.trim().replace(/^(\d+[.)]|[-*•])\s+/, "")).filter(Boolean);
  if (!points.length) return "";
  return `${planned?.start_time ? `\nTidspunkt: kl. ${planned.start_time}` : ""}${planned?.place ? `\nSted: ${planned.place}` : ""}`
    + "\n\nDAGSORDEN (skriv \"## Punkter\" i denne rækkefølge med disse numre og overskrifter; et punkt, der ikke blev drøftet, får \"- Drøftelse: Ikke drøftet\"; "
    + "drøftes noget uden for dagsordenen, så tag det med til sidst som et ekstra punkt):\n" + points.map((point, i) => `${i + 1}. ${point}`).join("\n");
}

/** Requested: "Referatet skal op uden godkendelse, men alle medlemmer skal pinges til at godkende
 * referatet". New minutes are put up in the cockpit at once (and in the minutes document when Saga
 * may write there); the chair gets them in Telegram and can still correct them by replying; the board
 * is asked to read and approve them, each member in the cockpit. */
export async function publishMinutes(env: SagaEnv, deps: SagaDeps, id: number, note: string): Promise<void> {
  const db = requireDb(env);
  const item = await getMinutes(db, id);
  if (!item?.draft_markdown || item.status !== "drafted") return;
  const stored = await approveMinutes(env, deps, id, true, { quiet: true });
  const link = cockpitLink(env, `/referat/${id}`);
  const sent = await telegramClient(env, deps).sendDocument(owner(env), `Referat ${item.meeting_date ?? ""}.md`.replace(/\s+\.md$/, ".md"), item.draft_markdown,
    `${note} Det er lagt op${link ? `: ${link}` : " i admin"}, og bestyrelsen godkender det dér. ${stored} Svar på denne besked for at rette referatet.`);
  await updateMinutes(db, id, { approvalMessageId: sent.message_id }, deps.now());
  // Requested: "Referatet er ikke endnu gengivet/inkluderet på forsiden" - Saga's picture of the board
  // (the front page's "Lige nu") is written again at once from the new minutes.
  if (env.SAGA_BOARD_CHAT_ID && env.AI_API_KEY) await draftOverview(env, deps).catch(error => console.warn("saga_overview_failed", error instanceof Error ? error.message : error));
  // Requested: "Hej alle sammen 😊 / Så er referatet klar til godkendelse: / URL".
  await pingBoard(env, deps, `Hej alle sammen 😊\nSå er referatet${item.meeting_date ? ` fra mødet ${danishDate(item.meeting_date)}` : ""} klar til godkendelse:\n${link || "Se det i admin."}`);
}

/** Minutes drafted before they went up on their own (they waited for the chair) are put up now. */
export async function publishDraftedMinutes(env: SagaEnv, deps: SagaDeps): Promise<void> {
  const rows = await requireDb(env).prepare("SELECT id FROM board_minutes WHERE status = 'drafted' ORDER BY created_at_ms LIMIT 3").all<{ id: number }>();
  for (const row of rows.results ?? []) await publishMinutes(env, deps, row.id, "Referatet ventede på din godkendelse.");
}

const cockpitLink = (env: SagaEnv, path: string) => env.COCKPIT_URL ? `${env.COCKPIT_URL.replace(/\/+$/, "")}${path}` : "";

/** One short message in the board's group - only when the chair has turned it on (SAGA_MINUTES_PING). */
async function pingBoard(env: SagaEnv, deps: SagaDeps, text: string): Promise<void> {
  if (env.SAGA_MINUTES_PING !== "on" || !env.SAGA_BOARD_CHAT_ID) return;
  const sent = await telegramClient(env, deps).sendMessage(env.SAGA_BOARD_CHAT_ID, text).catch(() => null);
  if (sent) await saveBoardMessage(requireDb(env), { chatId: env.SAGA_BOARD_CHAT_ID, messageId: sent.message_id, author: SAGA_NAME, authorId: null, text, sentAtMs: deps.now(), fromAssistant: true });
}

/** A board member asked for a correction in the cockpit: the chair hears it and can reply to correct. */
export async function tellChairAboutCorrection(env: SagaEnv, deps: SagaDeps, id: number, member: string, comment: string): Promise<void> {
  const db = requireDb(env);
  const item = await getMinutes(db, id);
  if (!item || !env.SAGA_TELEGRAM_BOT_TOKEN || !env.SAGA_OWNER_TELEGRAM_ID) return;
  const sent = await telegramClient(env, deps).sendMessage(owner(env), `${member} har en rettelse til referatet fra ${danishDate(item.meeting_date)}:\n\n${comment}\n\nSvar på denne besked med rettelsen, så retter jeg referatet.`);
  await updateMinutes(db, id, { approvalMessageId: sent.message_id }, deps.now());
}

export async function reviseMinutes(env: SagaEnv, deps: SagaDeps, id: number, instruction: string): Promise<void> {
  const db = requireDb(env);
  const item = await getMinutes(db, id);
  if (!item || (item.status !== "drafted" && item.status !== "approved") || !item.draft_markdown) return;
  if (item.status === "approved") {
    // Already up: corrected in place, and the board's sign-offs start over.
    const draft = await completeAs("referat-ret")(env, deps, [{ role: "system", content: REVISE_SYSTEM },
      { role: "user", content: `REFERAT:\n${item.draft_markdown}\n\nTRANSSKRIPTION (til opslag):\n${item.transcript ?? ""}\n\nRETTELSE:\n${instruction}` }]);
    await updateMinutes(db, id, { draft }, deps.now());
    await db.prepare("DELETE FROM board_minutes_signoffs WHERE minutes_id = ?").bind(id).run();
    const link = cockpitLink(env, `/referat/${id}`);
    const sent = await telegramClient(env, deps).sendDocument(owner(env), `Referat ${item.meeting_date ?? ""}.md`.replace(/\s+\.md$/, ".md"), draft,
      `Rettet og lagt op${link ? `: ${link}` : ""}. Bestyrelsen godkender den rettede udgave. Svar på denne besked for at rette igen.`);
    await updateMinutes(db, id, { approvalMessageId: sent.message_id }, deps.now());
    await pingBoard(env, deps, `Hej alle sammen 😊\nReferatet${item.meeting_date ? ` fra mødet ${danishDate(item.meeting_date)}` : ""} er rettet og klar til godkendelse igen:\n${link || "Se det i admin."}`);
    return;
  }
  const draft = await completeAs("referat-ret")(env, deps, [{ role: "system", content: REVISE_SYSTEM },
    { role: "user", content: `REFERAT:\n${item.draft_markdown}\n\nTRANSSKRIPTION (til opslag):\n${item.transcript ?? ""}\n\nRETTELSE:\n${instruction}` }]);
  await updateMinutes(db, id, { draft }, deps.now());
  if (item.approval_message_id) await telegramClient(env, deps).editMessageReplyMarkup(owner(env), item.approval_message_id).catch(() => undefined);
  await sendMinutesForApproval(env, deps, id, draft, item.meeting_date, "Rettet referat.");
}

/** Approved: a Google Doc in the minutes folder, and decisions, tasks and the link in the board chat. */
export async function approveMinutes(env: SagaEnv, deps: SagaDeps, id: number, approve: boolean, options: { quiet?: boolean } = {}): Promise<string> {
  const db = requireDb(env);
  const item = await getMinutes(db, id);
  if (!item || !item.draft_markdown || !(await decideMinutes(db, id, approve ? "approved" : "rejected", deps.now()))) return "Allerede afgjort.";
  const telegram = telegramClient(env, deps);
  if (item.approval_message_id) await telegram.editMessageReplyMarkup(owner(env), item.approval_message_id).catch(() => undefined);
  if (!approve) return "Afvist - intet gemt eller delt.";
  const title = `Referat - bestyrelsesmøde ${item.meeting_date ?? ""}`.trim();
  let link = "", failed = "";
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON && env.GOOGLE_MINUTES_DOC_ID) {
    // Requested: approved minutes go into the board's own minutes document, at the end.
    try {
      link = await appendToDoc(deps, await driveAccessToken(env, deps), env.GOOGLE_MINUTES_DOC_ID, title, plainMinutes(item.draft_markdown));
      await updateMinutes(db, id, { driveId: env.GOOGLE_MINUTES_DOC_ID, driveUrl: link }, deps.now());
    } catch (error) {
      failed = error instanceof Error ? error.message : "drive_failed";
      await updateMinutes(db, id, { error: failed }, deps.now());
    }
  } else if (env.GOOGLE_SERVICE_ACCOUNT_JSON && env.GOOGLE_DRIVE_MINUTES_FOLDER_ID) {
    try {
      const doc = await createGoogleDoc(env, deps, await driveAccessToken(env, deps), title, markdownToHtml(item.draft_markdown));
      await updateMinutes(db, id, { driveId: doc.id, driveUrl: doc.url }, deps.now());
      link = doc.url;
    } catch (error) {
      await updateMinutes(db, id, { error: error instanceof Error ? error.message : "drive_failed" }, deps.now());
    }
  }
  // An open document Saga can only read: the approved minutes are kept here, and the chair pastes them in.
  const readOnly = !link && !failed && !env.GOOGLE_SERVICE_ACCOUNT_JSON && minutesDocUrl(env);
  if (options.quiet) return link ? "Det er også skrevet ind i referatdokumentet." : failed ? `Det kunne ikke skrives i referatdokumentet (${failed}).`
    : readOnly ? "Saga kan ikke skrive i referatdokumentet, så sæt det ind dér, hvis det også skal stå i dokumentet." : "";
  if (!postsToBoard(env)) return link ? `Skrevet ind i referatdokumentet: ${link}`
    : failed ? `Godkendt, men det kunne ikke skrives i referatdokumentet (${failed}). Referatet er filen ovenfor.`
    : readOnly ? `Godkendt og gemt hos Saga. Hun kan læse referatdokumentet, men ikke skrive i det, så sæt referatet ind her: ${readOnly}`
    : "Godkendt. Referatet er filen ovenfor (referatdokumentet er ikke koblet på endnu).";
  const decisions = section(item.draft_markdown, /beslutninger/i), tasks = section(item.draft_markdown, /opgaver/i);
  const text = [`${title}`, decisions && `Beslutninger:\n${decisions}`, tasks && `Opgaver:\n${tasks}`, link ? `Hele referatet: ${link}` : ""].filter(Boolean).join("\n\n");
  const sent = await telegram.sendMessage(board(env), text);
  await saveBoardMessage(db, { chatId: board(env), messageId: sent.message_id, author: SAGA_NAME, authorId: null, text, sentAtMs: deps.now(), fromAssistant: true });
  if (!link) await telegram.sendDocument(board(env), `${title}.md`, item.draft_markdown, title).catch(() => undefined);
  return link ? "Gemt på Drevet og delt med bestyrelsen." : "Delt med bestyrelsen (Drevet er ikke sat op endnu, så referatet er vedhæftet som fil).";
}

// ---- Scheduled ----

// Requested (5 October): "Disse Telegram beskeder er unødvendige - og dem vil jeg gerne være fri for. Mailen har virket
// fint." The team@ watch is shown under Forbindelser in the cockpit; it no longer writes to Jacob on Telegram.

/** Every five minutes: new Drive recordings, one recording processed, and the weekly summary
 * on Sunday evening (18-19 Copenhagen time, once per week). */
export async function runSagaJobs(env: SagaEnv, deps: SagaDeps): Promise<void> {
  if (!env.DB || !env.SAGA_TELEGRAM_BOT_TOKEN || !env.SAGA_OWNER_TELEGRAM_ID) return;
  // Requested: "medmindre det er mere optimalt at oprette den i hjerterums admin?" - "Godt". Saga reads team@ herself,
  // every run, read-only (teamMail.ts); the run's outcome is what the watch below and Posthus show. First of all the
  // jobs: reported runs that stopped before the mail was read, the run's CPU spent on the jobs before it.
  await readTeamMail(env, deps, env.DB).catch(error => console.warn("saga_team_mail_failed", error instanceof Error ? error.message : error));
  // Asked: "Og er vi sikre på, at mailen bliver tjekket kontinuerligt?" - when team@ has not been checked for two hours
  // (or cannot be read), Saga tells Jacob privately, once a day. No AI.
  await queueDriveRecordings(env, deps).catch(error => console.warn("saga_drive_poll_failed", error instanceof Error ? error.message : error));
  await handlePendingCorrections(env, deps).catch(error => console.warn("saga_corrections_failed", error instanceof Error ? error.message : error));
  await publishDraftedMinutes(env, deps).catch(error => console.warn("saga_minutes_publish_failed", error instanceof Error ? error.message : error));
  // The document's meetings first: a recording of one of them then has its agenda to follow.
  await importDocMinutes(env, deps).catch(error => console.warn("saga_minutes_import_failed", error instanceof Error ? error.message : error));
  await processNextMinutes(env, deps).catch(error => console.warn("saga_minutes_failed", error instanceof Error ? error.message : error));
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", weekday: "short", hour: "2-digit", hour12: false })
    .formatToParts(deps.now()).map(p => [p.type, p.value]));
  // A fresh overview up to four times a day (the first one as soon as Saga runs) - only when
  // something happened since the last one. Requested: "Undersøg igen unødvendig og kontinuerlig
  // brug af AI" - it was rewritten every six hours whether or not anything was new.
  if (env.SAGA_BOARD_CHAT_ID && env.AI_API_KEY && await claimJob(env.DB, "saga_overview", Math.floor(deps.now() / (6 * 3_600_000)), deps.now())) {
    const { stale, doc } = await overviewStale(env, deps, env.DB);
    if (stale) await draftOverview(env, deps, doc).catch(error => console.warn("saga_overview_failed", error instanceof Error ? error.message : error));
  }
  // Requested: "Lav også plads til en ny underside: Forespørgsler. Her scanner Saga mailboksen for Forespørgsler".
  await scheduledEnquiryScan(env, deps, env.DB, (key, slot) => claimJob(env.DB!, key, slot, deps.now()))
    .catch(error => console.warn("saga_enquiries_failed", error instanceof Error ? error.message : error));
  // Requested: "Saga skal godkende events som medlemmer selv sætter op ud fra kriterier der allerede ligger i blueprint eller systemet".
  await scheduledEventReview(env, deps, env.DB, (key, slot) => claimJob(env.DB!, key, slot, deps.now()))
    .catch(error => console.warn("saga_event_review_failed", error instanceof Error ? error.message : error));
  // Requested: "Bestyrelsen lige nu" - "en gang i timen ... resume og overblik over hvad der rører sig netop nu".
  await scheduledBoardNow(env, deps, env.DB, (key, slot) => claimJob(env.DB!, key, slot, deps.now()))
    .catch(error => console.warn("saga_board_now_failed", error instanceof Error ? error.message : error));
  // Whoever has left the board's group loses the cockpit (cockpit/personalLogin.ts).
  await scheduledBoardAccess(env, deps, env.DB, (key, slot) => claimJob(env.DB!, key, slot, deps.now()))
    .catch(error => console.warn("saga_board_access_failed", error instanceof Error ? error.message : error));
  // Requested: "Please also delete duplicates when it comes to to-dos." - once a day, the to-dos that stand on a list twice are deleted (cockpit/data.ts).
  if (await claimJob(env.DB, "cockpit_todo_duplicates", Math.floor(deps.now() / DAY), deps.now()).catch(() => false)) {
    await removeDuplicateTodos(env.DB).then(n => { if (n) console.info("cockpit_todo_duplicates_removed", n); })
      .catch(error => console.warn("cockpit_todo_duplicates_failed", error instanceof Error ? error.message : error));
  }
  // Requested: the audio of a meeting is deleted once the minutes are made (saga/recordingRetention.ts).
  await scheduledRecordingCleanup(env, deps, env.DB, (key, slot) => claimJob(env.DB!, key, slot, deps.now()))
    .catch(error => console.warn("saga_recording_cleanup_failed", error instanceof Error ? error.message : error));
  // Requested: "Douglas taler engelsk" - Saga's front-page texts in English, when someone reads in English (weekdays).
  await scheduledTranslations(env, deps, env.DB, (key, slot) => claimJob(env.DB!, key, slot, deps.now()))
    .catch(error => console.warn("cockpit_translations_failed", error instanceof Error ? error.message : error));
  // Requested: "She might as well make both a Danish and English summary" - the English one is made with the Danish one, whether or not anyone reads in English now (cockpit/translate.ts).
  await scheduledEnglishSummaries(env, deps, env.DB, (key, slot) => claimJob(env.DB!, key, slot, deps.now()))
    .catch(error => console.warn("cockpit_english_summaries_failed", error instanceof Error ? error.message : error));
  // Requested: "Vi skal også differentiere mellem beslutninger og uformelle aftaler" - what is new in the minutes is sorted (cockpit/decisionKinds.ts).
  await scheduledDecisionKinds(env, deps, env.DB, (key, slot) => claimJob(env.DB!, key, slot, deps.now()))
    .catch(error => console.warn("cockpit_decision_kinds_failed", error instanceof Error ? error.message : error));
  // Requested: "I do not want Sagas suggestions ... implemented automatically": she suggests agenda points only when someone asks on the meeting's page (cockpit/agenda.ts).
  // Requested: "Om morgenen for teammødet skal Saga sende en besked til gruppen om, at dagsordenen er klar, og at vi ses klokken xx" - with a link (cockpit/agenda.ts).
  await scheduledAgendaReminder(env, deps, env.DB, (key, slot) => claimJob(env.DB!, key, slot, deps.now()))
    .catch(error => console.warn("cockpit_agenda_reminder_failed", error instanceof Error ? error.message : error));
  // Requested: "Generelt må hun gerne have al data fra den nuværende hjemmeside tilgængelig" - read once a day, no AI.
  await scheduledSiteSync(deps, env.DB, (key, slot) => claimJob(env.DB!, key, slot, deps.now()))
    .catch(error => console.warn("saga_site_sync_failed", error instanceof Error ? error.message : error));
  // Requested: "holistisk.org indhold bliver ikke ved med at være tilgængelig så det skal lagres" - the media files to R2, a few at a time.
  await archiveSiteMedia(env, deps, env.DB).catch(error => console.warn("saga_site_media_failed", error instanceof Error ? error.message : error));
  if (parts.weekday === "Sun" && parts.hour === "18" && env.SAGA_BOARD_CHAT_ID && env.AI_API_KEY) {
    const week = Math.floor(deps.now() / (7 * DAY));
    if (await claimJob(env.DB, "saga_weekly_summary", week, deps.now())) await draftWeeklySummary(env, deps).catch(error => console.warn("saga_weekly_failed", error instanceof Error ? error.message : error));
  }
}
