import { describe, expect, it } from "vitest";
import { addressesSaga, handleSagaRequest } from "./handler.js";
import { markdownToHtml, section } from "./markdown.js";
import { runSagaJobs } from "./saga.js";
import { getMinutes, getPostDraft } from "./store.js";
import { deps, fakeServices, OWNER, BOARD, sagaEnv, testDatabase } from "./test-support.js";
import { speakerTranscript } from "./transcribe.js";
import type { SagaEnv } from "./env.js";

const NOW = Date.parse("2026-09-23T10:00:00Z");
const MINUTES = "# Referat\n\n## Til stede\n- Jacob\n\n## Beslutninger\n- Budgettet er vedtaget.\n\n## Opgaver\n- Jacob - sender budgettet - fredag\n\n## Næste møde\n- 1. oktober";

function webhook(env: SagaEnv, fetcher: typeof fetch, update: unknown, secret = "hook-secret") {
  return handleSagaRequest(new Request("https://hjerterum.test/api/saga/telegram", {
    method: "POST", headers: { "content-type": "application/json", ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) },
    body: JSON.stringify(update)
  }), env, deps(fetcher, NOW));
}
const boardMessage = (id: number, text: string, from = { id: 222, first_name: "Mette" }) =>
  ({ update_id: id, message: { message_id: id, date: NOW / 1000 - 60, chat: { id: Number(BOARD), type: "supergroup" }, from, text } });
const privateMessage = (id: number, fields: Record<string, unknown>, from = Number(OWNER)) =>
  ({ update_id: id, message: { message_id: id, date: NOW / 1000, chat: { id: from, type: "private" }, from: { id: from, first_name: "Jacob" }, ...fields } });
const callback = (data: string, from = Number(OWNER)) => ({ update_id: 9000, callback_query: { id: "cb", from: { id: from, first_name: "Jacob" }, data } });
const count = (db: ReturnType<typeof testDatabase>, table: string) =>
  db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>().then(row => Number(row?.n));

async function testPrivateKey(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let binary = "";
  for (const byte of der) binary += String.fromCharCode(byte);
  return `-----BEGIN PRIVATE KEY-----\n${btoa(binary)}\n-----END PRIVATE KEY-----\n`;
}

describe("Saga helpers", () => {
  it("labels speakers in the transcript", () => {
    expect(speakerTranscript({ words: [
      { text: "Hej", speaker_id: "a" }, { text: " alle.", speaker_id: "a" }, { text: "(latter)", speaker_id: "b", type: "audio_event" },
      { text: "Hej.", speaker_id: "b" }, { text: "Godt.", speaker_id: "a" }] })).toBe("Taler 1: Hej alle.\nTaler 2: Hej.\nTaler 1: Godt.");
    expect(speakerTranscript({ text: " Kun tekst. " })).toBe("Kun tekst.");
  });

  it("turns minutes into HTML and finds sections", () => {
    const html = markdownToHtml("# Referat\n- **Vedtaget** <budget>\n\nTekst");
    expect(html).toContain("<h1>Referat</h1><ul><li><strong>Vedtaget</strong> &lt;budget&gt;</li></ul><p>Tekst</p>");
    expect(section(MINUTES, /beslutninger/i)).toBe("- Budgettet er vedtaget.");
    expect(section(MINUTES, /opgaver/i)).toBe("- Jacob - sender budgettet - fredag");
    expect(section(MINUTES, /budget/i)).toBe("");
  });

  it("knows when a board message is meant for her", () => {
    const base = { message_id: 1, date: 0, chat: { id: 1, type: "group" } };
    expect(addressesSaga({ ...base, text: "@HjerterumSagaBot hvad besluttede vi?" }, "HjerterumSagaBot")).toBe(true);
    expect(addressesSaga({ ...base, text: "Saga, hvornår er næste møde?" }, "HjerterumSagaBot")).toBe(true);
    expect(addressesSaga({ ...base, text: "Sagaen om budgettet fortsætter?" }, "HjerterumSagaBot")).toBe(false);
    expect(addressesSaga({ ...base, text: "Saga er god." }, "HjerterumSagaBot")).toBe(false);
    expect(addressesSaga({ ...base, text: "Tak", reply_to_message: { message_id: 2, from: { id: 5, is_bot: true, username: "HjerterumSagaBot" } } }, "HjerterumSagaBot")).toBe(true);
    expect(addressesSaga({ ...base, text: "Tak", reply_to_message: { message_id: 2, from: { id: 6, is_bot: true, username: "AndenBot" } } }, "HjerterumSagaBot")).toBe(false);
  });
});

describe("Saga's Telegram webhook", () => {
  it("refuses updates without the webhook secret", async () => {
    const db = testDatabase(), services = fakeServices();
    expect((await webhook(sagaEnv(db), services.fetcher, boardMessage(1, "Hej"), "")).status).toBe(401);
    expect((await webhook(sagaEnv(db), services.fetcher, boardMessage(1, "Hej"), "hook-secreT")).status).toBe(401);
    expect(await count(db, "board_messages")).toBe(0);
  });

  it("keeps the board chat and only drafts a reply for Jacob's approval", async () => {
    const db = testDatabase(), services = fakeServices({ ai: () => "Næste møde er 1. oktober." });
    const env = sagaEnv(db);
    await webhook(env, services.fetcher, boardMessage(1, "Husk kage til mødet"));
    expect(await count(db, "board_messages")).toBe(1);
    expect(services.calls).toHaveLength(0);

    await webhook(env, services.fetcher, boardMessage(2, "Saga, hvornår er næste møde?"));
    const [approval] = services.telegram("sendMessage");
    expect(approval?.body).toMatchObject({ chat_id: OWNER, reply_markup: { inline_keyboard: [[{ callback_data: "approve:post:1" }, { callback_data: "reject:post:1" }]] } });
    expect((approval?.body as { text: string }).text).toContain("Næste møde er 1. oktober.");
    // Nothing reaches the board before the approval.
    expect(services.calls.filter(c => (c.body as { chat_id?: string })?.chat_id === BOARD)).toHaveLength(0);
    expect(await getPostDraft(db, 1)).toMatchObject({ status: "pending", reply_to_message_id: 2 });
  });

  it("ignores private messages from anyone but Jacob and refuses their approvals", async () => {
    const db = testDatabase(), services = fakeServices();
    const env = sagaEnv(db);
    await webhook(env, services.fetcher, privateMessage(5, { text: "Hvad står der i referatet?" }, 333));
    expect(services.calls).toHaveLength(0);

    await webhook(env, services.fetcher, boardMessage(2, "Saga, hvornår er næste møde?"));
    await webhook(env, services.fetcher, callback("approve:post:1", 333));
    expect(services.telegram("answerCallbackQuery")[0]?.body).toMatchObject({ text: "Kun formanden kan godkende." });
    expect(await getPostDraft(db, 1)).toMatchObject({ status: "pending" });
  });

  it("posts an approved reply once, as a reply to the question", async () => {
    const db = testDatabase(), services = fakeServices({ ai: () => "Den 1. oktober." });
    const env = sagaEnv(db);
    await webhook(env, services.fetcher, boardMessage(2, "Saga, hvornår er næste møde?"));
    await webhook(env, services.fetcher, callback("approve:post:1"));
    await webhook(env, services.fetcher, callback("approve:post:1"));

    const posts = services.telegram("sendMessage").filter(c => (c.body as { chat_id: string }).chat_id === BOARD);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toMatchObject({ text: "Den 1. oktober.", reply_parameters: { message_id: 2 } });
    expect(services.telegram("answerCallbackQuery").map(c => (c.body as { text: string }).text)).toEqual(["Sendt til bestyrelsen.", "Allerede afgjort."]);
    expect(await getPostDraft(db, 1)).toMatchObject({ status: "posted" });
    expect(await count(db, "board_messages")).toBe(2);
  });

  it("revises a draft when Jacob replies to the approval message, and a rejection sends nothing", async () => {
    const db = testDatabase(), services = fakeServices({ ai: (system, user) => user.includes("RETTELSE") ? "Kortere svar." : "Langt svar." });
    const env = sagaEnv(db);
    await webhook(env, services.fetcher, boardMessage(2, "Saga, hvornår er næste møde?"));
    const approvalId = (await getPostDraft(db, 1))!.approval_message_id!;
    await webhook(env, services.fetcher, privateMessage(10, { text: "Gør det kortere", reply_to_message: { message_id: approvalId } }));
    expect(await getPostDraft(db, 1)).toMatchObject({ text: "Kortere svar.", status: "pending" });
    expect(services.telegram("editMessageReplyMarkup")[0]?.body).toMatchObject({ message_id: approvalId });

    await webhook(env, services.fetcher, callback("reject:post:1"));
    expect(await getPostDraft(db, 1)).toMatchObject({ status: "rejected" });
    expect(services.calls.filter(c => (c.body as { chat_id?: string })?.chat_id === BOARD)).toHaveLength(0);
  });

  it("answers Jacob privately from the board's context", async () => {
    const db = testDatabase();
    let seen = "";
    const services = fakeServices({ ai: (_system, user) => { seen = user; return "I talte om kage."; } });
    const env = sagaEnv(db);
    await webhook(env, services.fetcher, boardMessage(1, "Husk kage til mødet"));
    await webhook(env, services.fetcher, privateMessage(5, { text: "Hvad talte vi om?" }));
    expect(seen).toContain("Husk kage til mødet");
    expect(services.telegram("sendMessage")[0]?.body).toMatchObject({ chat_id: OWNER, text: "I talte om kage." });
  });
});

// Requested: "Jeg vil ikke have hun interagerer i gruppen." Posting is off unless turned on.
describe("Saga as a listener only (the default)", () => {
  const listening = (db: ReturnType<typeof testDatabase>, extra: Partial<SagaEnv> = {}) => { const { SAGA_BOARD_POSTING: _on, ...env } = sagaEnv(db, extra); return env as SagaEnv; };
  const toBoard = (services: ReturnType<typeof fakeServices>) => services.calls.filter(c => (c.body as { chat_id?: string })?.chat_id === BOARD);

  it("reads the group but never drafts or posts there, even when asked", async () => {
    const db = testDatabase(), services = fakeServices();
    const env = listening(db);
    await webhook(env, services.fetcher, boardMessage(2, "Saga, hvornår er næste møde?"));
    expect(await count(db, "board_messages")).toBe(1);
    expect(await count(db, "board_post_drafts")).toBe(0);
    expect(services.calls).toHaveLength(0);
  });

  it("gives the weekly summary to the chair privately, and approved minutes stay with him", async () => {
    const db = testDatabase(), services = fakeServices({ ai: (system) => system.includes("referat") || system.includes("Referat") ? MINUTES : "Ugen i bestyrelsen: kage." });
    const env = listening(db);
    const sunday18 = Date.parse("2026-09-27T16:30:00Z");
    await webhook(env, services.fetcher, { ...boardMessage(1, "Husk kage"), message: { ...boardMessage(1, "Husk kage").message, date: sunday18 / 1000 - 3600 } });
    await runSagaJobs(env, deps(services.fetcher, sunday18));
    const [summary] = services.telegram("sendMessage");
    expect(summary?.body).toMatchObject({ chat_id: OWNER });
    expect((summary?.body as { text: string; reply_markup?: unknown }).reply_markup).toBeUndefined();
    expect(await getPostDraft(db, 1)).toMatchObject({ kind: "weekly_summary", status: "posted" });

    await webhook(env, services.fetcher, privateMessage(5, { voice: { file_id: "voice-1", file_size: 5000 } }));
    await webhook(env, services.fetcher, callback("approve:minutes:1"));
    expect(await getMinutes(db, 1)).toMatchObject({ status: "approved" });
    expect(toBoard(services)).toHaveLength(0);
  });
});

// Requested: "the doc we use for all referater and decisions ... Saga should use to read up on
// things, but also to paste summaries".
describe("Saga and the board's minutes document", () => {
  it("reads the document for answers and appends approved minutes at its end", async () => {
    const db = testDatabase();
    const prompts: string[] = [];
    const services = fakeServices({ ai: (_system, user) => { prompts.push(user); return user.includes("JACOB SPØRGER") ? "Kagekassen blev vedtaget 1. september." : MINUTES; } });
    const { SAGA_BOARD_POSTING: _on, ...env } = sagaEnv(db, { GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "saga@hjerterum.iam.gserviceaccount.com", private_key: await testPrivateKey() }),
      GOOGLE_MINUTES_DOC_ID: "minutes-doc" });
    await webhook(env as SagaEnv, services.fetcher, privateMessage(4, { text: "Hvad besluttede vi om kage?" }));
    expect(prompts[0]).toContain("BESTYRELSENS REFERATDOKUMENT");
    expect(prompts[0]).toContain("Beslutning: Ny kagekasse.");
    expect(services.telegram("sendMessage")[0]?.body).toMatchObject({ chat_id: OWNER, text: "Kagekassen blev vedtaget 1. september." });

    await webhook(env as SagaEnv, services.fetcher, privateMessage(5, { voice: { file_id: "voice-1", file_size: 5000 } }));
    expect(prompts[1]).toContain("BAGGRUND - tidligere referater");
    await webhook(env as SagaEnv, services.fetcher, callback("approve:minutes:1"));
    const update = services.calls.find(c => c.url.endsWith("minutes-doc:batchUpdate"));
    const requests = (update?.body as { requests: Array<Record<string, any>> }).requests;
    expect(requests[0]).toEqual({ insertText: { location: { index: 119 }, text: expect.stringContaining("\nReferat - bestyrelsesmøde 2026-09-23\nReferat\n\nTil stede\n• Jacob") } });
    expect(requests[0]!.insertText.text).toContain("• Budgettet er vedtaget.");
    expect(requests[1]).toMatchObject({ updateParagraphStyle: { range: { startIndex: 120, endIndex: 120 + "Referat - bestyrelsesmøde 2026-09-23".length + 1 }, paragraphStyle: { namedStyleType: "HEADING_2" } } });
    expect(await getMinutes(db, 1)).toMatchObject({ status: "approved", drive_document_url: "https://docs.google.com/document/d/minutes-doc/edit" });
    expect(services.telegram("answerCallbackQuery").at(-1)?.body).toMatchObject({ text: "Skrevet ind i referatdokumentet: https://docs.google.com/document/d/minutes-doc/edit" });
    expect(services.calls.filter(c => (c.body as { chat_id?: string })?.chat_id === BOARD)).toHaveLength(0);
  });
});

// Requested: "connect Hjerterums main email ... Saga can use it to read the temperature and let
// me know if something demands my attention" - not shown in Posthus or Samtaler.
describe("Saga watching team@holistisk.org", () => {
  const relay = (env: SagaEnv, fetcher: typeof fetch, mails: unknown[], secret = "liva-secret") => handleSagaRequest(new Request("https://hjerterum.test/api/saga/liva/mail", {
    method: "POST", headers: { authorization: "Bearer " + secret, "content-type": "application/json" }, body: JSON.stringify({ mails }) }), env, deps(fetcher, NOW));
  const mails = [
    { ref: "m1", from: "udlejer@ejendom.dk", subject: "Varsel om huslejestigning", receivedAt: "2026-09-23T08:00:00Z", text: "Kære Hjerterum, huslejen stiger pr. 1. januar. Svar inden 1. oktober." },
    { ref: "m2", from: "news@shop.dk", subject: "Ugens tilbud", receivedAt: "2026-09-23T09:00:00Z", text: "Spar 20 %." },
    { ref: "m3", from: "medlem@gmail.com", subject: "Tak for sidst", receivedAt: "2026-09-23T09:30:00Z", text: "Det var en dejlig aften." },
  ];

  it("judges each new mail once and tells the chair only what demands his attention", async () => {
    const db = testDatabase();
    const services = fakeServices({ ai: () => 'Her er vurderingen: [{"n":1,"verdict":"attention","reason":"Huslejestigning med svarfrist 1. oktober"},{"n":2,"verdict":"ignore","reason":"Reklame"},{"n":3,"verdict":"fyi","reason":"Tak fra et medlem"}]' });
    const env = sagaEnv(db);
    expect((await relay(env, services.fetcher, mails, "wrong-secre")).status).toBe(401);
    expect(await (await relay(env, services.fetcher, mails)).json()).toEqual({ received: 3, fresh: 3, attention: 1 });
    const [notice] = services.telegram("sendMessage");
    expect(notice?.body).toMatchObject({ chat_id: OWNER });
    expect((notice?.body as { text: string }).text).toContain('Fra udlejer@ejendom.dk: "Varsel om huslejestigning"');
    expect((notice?.body as { text: string }).text).toContain("Huslejestigning med svarfrist 1. oktober");
    expect((notice?.body as { text: string }).text).not.toContain("Ugens tilbud");
    // The same mails again: nothing new, nothing sent.
    expect(await (await relay(env, services.fetcher, mails)).json()).toEqual({ received: 3, fresh: 0, attention: 0 });
    expect(services.telegram("sendMessage")).toHaveLength(1);
    expect(services.calls.filter(c => (c.body as { chat_id?: string })?.chat_id === BOARD)).toHaveLength(0);

    const overview = await (await handleSagaRequest(new Request("https://hjerterum.test/api/saga/liva/overview", { headers: { authorization: "Bearer liva-secret" } }), env, deps(services.fetcher, NOW))).json() as { mail: unknown };
    expect(overview.mail).toEqual({ week: { total: 3, attention: 1, ignored: 1 },
      attention: [{ sender: "udlejer@ejendom.dk", subject: "Varsel om huslejestigning", reason: "Huslejestigning med svarfrist 1. oktober", receivedAt: "2026-09-23T08:00:00.000Z" }] });
  });

  it("shows the chair a mail it could not judge rather than dropping it, and uses the mail in his answers", async () => {
    const db = testDatabase();
    const prompts: string[] = [];
    const services = fakeServices({ ai: (_system, user) => { prompts.push(user); return user.includes("JACOB SPØRGER") ? "Udlejeren varsler huslejestigning." : "ikke json"; } });
    const env = sagaEnv(db);
    expect(await (await relay(env, services.fetcher, mails.slice(0, 1))).json()).toEqual({ received: 1, fresh: 1, attention: 1 });
    expect((services.telegram("sendMessage")[0]?.body as { text: string }).text).toContain("Kunne ikke vurderes automatisk");
    await webhook(env, services.fetcher, privateMessage(9, { text: "Er der noget i mailen?" }));
    expect(prompts.at(-1)).toContain("HJERTERUMS MAIL (team@holistisk.org)");
    expect(prompts.at(-1)).toContain("Varsel om huslejestigning - KRÆVER OPMÆRKSOMHED");
  });
});

describe("Saga's minutes", () => {
  it("drafts minutes from a recording, revises them and shares decisions after approval", async () => {
    const db = testDatabase();
    let transcript = "";
    const services = fakeServices({ ai: (system, user) => {
      if (user.includes("RETTELSE")) return MINUTES.replace("1. oktober", "8. oktober");
      transcript = user; return MINUTES;
    } });
    const env = sagaEnv(db);
    await webhook(env, services.fetcher, privateMessage(5, { voice: { file_id: "voice-1", mime_type: "audio/ogg", file_size: 5000 } }));

    expect(services.telegram("sendMessage")[0]?.body).toMatchObject({ chat_id: OWNER, text: expect.stringMatching(/^Modtaget/) });
    expect(services.telegram("getFile")).toHaveLength(1);
    expect(transcript).toContain("Taler 1: Vi vedtager budgettet.\nTaler 2: Enig.");
    expect(transcript).toContain("Mødedato: 23. september 2026");
    const [document] = services.telegram("sendDocument");
    expect(document?.body).toMatchObject({ chat_id: OWNER, document: "[file Referat 2026-09-23.md]" });
    expect(JSON.parse((document?.body as { reply_markup: string }).reply_markup)).toEqual({ inline_keyboard: [[
      { text: "Godkend", callback_data: "approve:minutes:1" }, { text: "Afvis", callback_data: "reject:minutes:1" }]] });
    const drafted = (await getMinutes(db, 1))!;
    expect(drafted).toMatchObject({ status: "drafted", draft_markdown: MINUTES });

    // The same recording again is not transcribed twice.
    await webhook(env, services.fetcher, privateMessage(6, { voice: { file_id: "voice-1", file_size: 5000 } }));
    expect(services.telegram("sendMessage")[1]?.body).toMatchObject({ text: "Den optagelse har jeg allerede fået." });

    await webhook(env, services.fetcher, privateMessage(7, { text: "Næste møde er 8. oktober", reply_to_message: { message_id: drafted.approval_message_id } }));
    expect((await getMinutes(db, 1))!.draft_markdown).toContain("8. oktober");
    expect(services.telegram("sendDocument")).toHaveLength(2);

    await webhook(env, services.fetcher, callback("approve:minutes:1"));
    const [post] = services.telegram("sendMessage").filter(c => (c.body as { chat_id: string }).chat_id === BOARD);
    expect((post?.body as { text: string }).text).toBe("Referat - bestyrelsesmøde 2026-09-23\n\nBeslutninger:\n- Budgettet er vedtaget.\n\nOpgaver:\n- Jacob - sender budgettet - fredag");
    // Without Drive the full minutes go to the board as a file.
    expect(services.telegram("sendDocument").at(-1)?.body).toMatchObject({ chat_id: BOARD });
    expect(await getMinutes(db, 1)).toMatchObject({ status: "approved" });
    expect(services.telegram("answerCallbackQuery")[0]?.body).toMatchObject({ text: expect.stringContaining("Drevet er ikke sat op") });
  });

  it("refuses a recording over Telegram's 20 MB limit", async () => {
    const db = testDatabase(), services = fakeServices();
    await webhook(sagaEnv(db), services.fetcher, privateMessage(5, { audio: { file_id: "big", file_size: 21 * 1024 * 1024 } }));
    expect((services.telegram("sendMessage")[0]?.body as { text: string }).text).toContain("20 MB");
    expect(await count(db, "board_minutes")).toBe(0);
  });

  it("takes recordings from Drive and saves approved minutes as a Google Doc", async () => {
    const db = testDatabase(), services = fakeServices({ ai: () => MINUTES });
    const env = sagaEnv(db, { GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "saga@hjerterum.iam.gserviceaccount.com", private_key: await testPrivateKey() }),
      GOOGLE_DRIVE_RECORDINGS_FOLDER_ID: "rec-folder", GOOGLE_DRIVE_MINUTES_FOLDER_ID: "min-folder" });
    await runSagaJobs(env, deps(services.fetcher, NOW));
    expect(await getMinutes(db, 1)).toMatchObject({ source: "drive", source_file_id: "rec-1", status: "drafted", meeting_date: "2026-09-22" });
    const token = services.calls.find(c => c.url === "https://oauth2.googleapis.com/token");
    expect(String(token?.body)).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");

    // A second run finds the same file and does not queue it again.
    await runSagaJobs(env, deps(services.fetcher, NOW + 300_000));
    expect(await count(db, "board_minutes")).toBe(1);

    await webhook(env, services.fetcher, callback("approve:minutes:1"));
    const upload = services.calls.find(c => c.url.startsWith("https://www.googleapis.com/upload/drive/v3/files"));
    expect(upload?.method).toBe("POST");
    expect(await getMinutes(db, 1)).toMatchObject({ status: "approved", drive_document_url: "https://docs.google.com/document/d/doc-1/edit" });
    const [post] = services.telegram("sendMessage").filter(c => (c.body as { chat_id: string }).chat_id === BOARD);
    expect((post?.body as { text: string }).text).toContain("Hele referatet: https://docs.google.com/document/d/doc-1/edit");
    expect(services.telegram("sendDocument").filter(c => (c.body as { chat_id: string }).chat_id === BOARD)).toHaveLength(0);
  });

  it("gives up on a failing recording after three attempts and tells Jacob", async () => {
    const db = testDatabase(), services = fakeServices();
    const { ELEVENLABS_API_KEY: _unused, ...env } = sagaEnv(db);
    await webhook(env, services.fetcher, privateMessage(5, { voice: { file_id: "voice-1", file_size: 5000 } }));
    await runSagaJobs(env, deps(services.fetcher, NOW + 300_000));
    await runSagaJobs(env, deps(services.fetcher, NOW + 600_000));
    await runSagaJobs(env, deps(services.fetcher, NOW + 900_000));
    expect(await getMinutes(db, 1)).toMatchObject({ status: "failed", attempts: 3 });
    const told = services.telegram("sendMessage").map(c => (c.body as { text: string }).text);
    expect(told.filter(text => text.includes("transcription_not_configured"))).toHaveLength(1);
  });
});

describe("Saga's weekly summary and Liva's overview", () => {
  const sunday18 = Date.parse("2026-09-27T16:30:00Z");

  it("drafts the weekly summary on Sunday at 18 Copenhagen time, once", async () => {
    const db = testDatabase(), services = fakeServices({ ai: () => "Ugen i bestyrelsen." });
    const env = sagaEnv(db);
    await webhook(env, services.fetcher, { ...boardMessage(1, "Husk kage"), message: { ...boardMessage(1, "Husk kage").message, date: sunday18 / 1000 - 3600 } });
    await runSagaJobs(env, deps(services.fetcher, sunday18 - 3_600_000));
    expect(await count(db, "board_post_drafts")).toBe(0);
    await runSagaJobs(env, deps(services.fetcher, sunday18));
    await runSagaJobs(env, deps(services.fetcher, sunday18 + 300_000));
    expect(await count(db, "board_post_drafts")).toBe(1);
    expect(await getPostDraft(db, 1)).toMatchObject({ kind: "weekly_summary", status: "pending", text: "Ugen i bestyrelsen." });
  });

  it("skips the weekly summary when the board has been quiet", async () => {
    const db = testDatabase(), services = fakeServices();
    await runSagaJobs(sagaEnv(db), deps(services.fetcher, sunday18));
    expect(await count(db, "board_post_drafts")).toBe(0);
    expect(services.calls).toHaveLength(0);
  });

  it("shows Liva the board's week behind a bearer secret", async () => {
    const db = testDatabase(), services = fakeServices({ ai: () => MINUTES });
    const env = sagaEnv(db);
    await webhook(env, services.fetcher, boardMessage(1, "Husk kage til mødet"));
    await webhook(env, services.fetcher, privateMessage(5, { voice: { file_id: "voice-1", file_size: 5000 } }));
    const overview = (authorization?: string) => handleSagaRequest(new Request("https://hjerterum.test/api/saga/liva/overview?days=3", {
      headers: authorization ? { authorization } : {} }), env, deps(services.fetcher, NOW));

    expect((await overview()).status).toBe(401);
    expect((await overview("Bearer wrong-secre")).status).toBe(401);
    const response = await overview("Bearer liva-secret");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      assistant: "Saga", days: 3,
      messages: [{ author: "Mette", text: "Husk kage til mødet", sentAt: new Date(NOW - 60_000).toISOString() }],
      minutes: [{ id: 1, meetingDate: "2026-09-23", status: "drafted", decisions: "- Budgettet er vedtaget.", tasks: "- Jacob - sender budgettet - fredag", url: null }],
      pending: [{ kind: "minutes", id: 1, label: "Referat 2026-09-23", text: MINUTES, fileName: "optagelse-" + NOW / 1000, at: new Date(NOW).toISOString() }],
      pendingApprovals: 1, weeklySummary: null,
      mail: { week: { total: 0, attention: 0, ignored: 0 }, attention: [] },
      overview: null,
      connections: {
        telegram: { ok: true, detail: expect.stringContaining("Forbundet") },
        googleDoc: { ok: false, detail: expect.stringContaining("ingen Google-adgang") },
        mail: { ok: null, detail: expect.any(String) },
        ai: { ok: true, detail: expect.stringContaining("Virker") }
      },
      minutesDoc: { url: null, writable: false }
    });
    // Requested: "Telegram-gruppen bør også være sat op" - a bot with no webhook is connected to Saga.
    expect(services.telegram("setWebhook").at(-1)?.body).toEqual({ url: "https://hjerterum.test/api/saga/telegram", secret_token: "hook-secret", allowed_updates: ["message", "callback_query"] });
  });

  it("lets the chair decide and revise from Matrix exactly as in Telegram, once", async () => {
    const db = testDatabase(), services = fakeServices({ ai: (_system, user) => user.includes("RETTELSE") ? "Kortere svar." : "Langt svar." });
    const env = sagaEnv(db);
    await webhook(env, services.fetcher, boardMessage(2, "Saga, hvornår er næste møde?"));
    const call = (path: string, body: unknown, secret = "liva-secret") => handleSagaRequest(new Request("https://hjerterum.test/api/saga/liva/" + path, {
      method: "POST", headers: { authorization: "Bearer " + secret, "content-type": "application/json" }, body: JSON.stringify(body) }), env, deps(services.fetcher, NOW));

    expect((await call("decide", { kind: "post", id: 1, approve: true }, "wrong-secre")).status).toBe(401);
    expect((await call("decide", { kind: "other", id: 1, approve: true })).status).toBe(400);
    expect(await (await call("revise", { kind: "post", id: 1, instruction: "Kortere" })).json()).toEqual({ revised: true });
    expect(await getPostDraft(db, 1)).toMatchObject({ text: "Kortere svar.", status: "pending" });
    expect(await (await call("decide", { kind: "post", id: 1, approve: true })).json()).toEqual({ result: "Sendt til bestyrelsen.", decided: true });
    expect(await (await call("decide", { kind: "post", id: 1, approve: true })).json()).toEqual({ result: "Allerede afgjort.", decided: false });
    expect(services.telegram("sendMessage").filter(c => (c.body as { chat_id: string }).chat_id === BOARD)).toHaveLength(1);
  });

  it("answers unknown paths with 404", async () => {
    const response = await handleSagaRequest(new Request("https://hjerterum.test/api/saga/other"), sagaEnv(testDatabase()), deps(fakeServices().fetcher));
    expect(response.status).toBe(404);
  });
});

// Requested: "Jeg skal ikke se mails. Jeg skal have overordnet resume" and
// "Er der kontakt til Google doc, telegram gruppen og mailen?"
describe("Saga's overview and connection check for the chair", () => {
  const overviewOf = async (env: SagaEnv, fetcher: typeof fetch, now = NOW) => (await (await handleSagaRequest(new Request("https://hjerterum.test/api/saga/liva/overview", {
    headers: { authorization: "Bearer liva-secret" } }), env, deps(fetcher, now))).json()) as { overview: { text: string } | null; connections: { telegram: { ok: boolean | null; detail: string }; googleDoc: { ok: boolean | null; detail: string }; mail: { ok: boolean | null; detail: string }; ai: { ok: boolean | null; detail: string } } };
  const withWebhook = (fetcher: typeof fetch, info: Record<string, unknown>): typeof fetch => async (input, init) =>
    String(input).endsWith("/getWebhookInfo") ? new Response(JSON.stringify({ ok: true, result: info })) : fetcher(input, init);
  const google = async () => ({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "saga@hjerterum.iam.gserviceaccount.com", private_key: await testPrivateKey() }), GOOGLE_MINUTES_DOC_ID: "minutes-doc" });

  it("writes an overall overview from the group, the minutes document and the mail, up to four times a day", async () => {
    const db = testDatabase();
    let context = "";
    const services = fakeServices({ ai: (system, user) => { if (system.includes("overordnet overblik")) { context = user; return "## Besluttet\n- Ny kagekasse."; } return "[]"; } });
    const env = sagaEnv(db, await google());
    await webhook(env, services.fetcher, boardMessage(1, "Husk kage til mødet"));
    await runSagaJobs(env, deps(services.fetcher, NOW));
    await runSagaJobs(env, deps(services.fetcher, NOW + 300_000));
    expect(await count(db, "board_overviews")).toBe(1);
    expect(context).toContain("Husk kage til mødet");
    expect(context).toContain("Ny kagekasse");
    expect((await overviewOf(env, services.fetcher)).overview).toMatchObject({ text: "## Besluttet\n- Ny kagekasse." });
    // Requested: "Undersøg igen unødvendig og kontinuerlig brug af AI" - six hours with nothing new
    // write no new overview; a new message in the group does.
    await runSagaJobs(env, deps(services.fetcher, NOW + 6 * 3_600_000));
    expect(await count(db, "board_overviews")).toBe(1);
    const later = boardMessage(2, "Mødet flyttes til torsdag");
    later.message.date = (NOW + 7 * 3_600_000) / 1000;
    await webhook(env, services.fetcher, later);
    await runSagaJobs(env, deps(services.fetcher, NOW + 12 * 3_600_000));
    expect(await count(db, "board_overviews")).toBe(2);
  });

  it("says the group is connected once the bot delivers to Saga and she has read the group", async () => {
    const db = testDatabase(), services = fakeServices();
    const env = sagaEnv(db, await google());
    const fetcher = withWebhook(services.fetcher, { url: "https://hjerterum.test/api/saga/telegram" });
    expect((await overviewOf(env, fetcher)).connections.telegram).toMatchObject({ ok: false, detail: expect.stringContaining("/setprivacy") });
    await webhook(env, services.fetcher, boardMessage(1, "Husk kage"));
    const { connections } = await overviewOf(env, fetcher);
    expect(connections.telegram).toMatchObject({ ok: true, detail: expect.stringContaining("Forbundet") });
    expect(connections.googleDoc).toMatchObject({ ok: true, detail: expect.stringContaining("referatdokumentet") });
  });

  it("names what is wrong: a bot pointed elsewhere, a group with another id, a document not shared, a failing AI", async () => {
    const db = testDatabase(), services = fakeServices();
    const env = sagaEnv(db, await google());
    expect((await overviewOf(env, withWebhook(services.fetcher, { url: "https://matrix.example/telegram" }))).connections.telegram.detail).toContain("matrix.example");
    expect((await overviewOf(env, withWebhook(services.fetcher, { url: "https://hjerterum.test/api/saga/telegram", last_error_message: "Connection timed out" })))
      .connections.telegram.detail).toContain("Connection timed out");
    expect(services.telegram("setWebhook")).toHaveLength(0);
    // A bot pointed elsewhere is never taken over; one refused with an old secret is reconnected.
    await overviewOf(env, withWebhook(services.fetcher, { url: "https://hjerterum.test/api/saga/telegram", last_error_message: "Wrong response from the webhook: 401 Unauthorized" }));
    expect(services.telegram("setWebhook")).toHaveLength(1);
    await webhook(env, services.fetcher, { ...boardMessage(2, "Hej"), message: { ...boardMessage(2, "Hej").message, chat: { id: -100999, type: "supergroup" } } });
    expect((await overviewOf(env, withWebhook(services.fetcher, { url: "https://hjerterum.test/api/saga/telegram" }))).connections.telegram.detail).toContain("-100999");

    const unshared: typeof fetch = async (input, init) => String(input).includes("/export?") ? new Response("", { status: 404 }) : services.fetcher(input, init);
    expect((await overviewOf(env, unshared)).connections.googleDoc).toMatchObject({ ok: false, detail: expect.stringContaining("Del det") });

    const failing: typeof fetch = async (input, init) => String(input).endsWith("/chat/completions")
      ? new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 }) : services.fetcher(input, init);
    await webhook(env, services.fetcher, boardMessage(3, "Husk kage"));
    await runSagaJobs(env, deps(failing, NOW));
    expect((await overviewOf(env, failing)).connections.ai).toMatchObject({ ok: false, detail: expect.stringContaining("Invalid API key") });
    const { AI_API_KEY: _key, ...keyless } = env;
    expect((await overviewOf(keyless, failing)).connections.ai).toMatchObject({ ok: false, detail: expect.stringContaining("AI_API_KEY") });
  });
});

// Requested: "Du har allerede fået link til det åbne referatdokument" - no Google account needed to read it.
describe("Saga reads the open minutes document through its link", () => {
  const overviewOf = async (env: SagaEnv, fetcher: typeof fetch) => (await (await handleSagaRequest(new Request("https://hjerterum.test/api/saga/liva/overview", {
    headers: { authorization: "Bearer liva-secret" } }), env, deps(fetcher))).json()) as { connections: { googleDoc: { ok: boolean | null; detail: string } }; minutesDoc: { url: string | null; writable: boolean } };

  it("reads a document shared with everyone with the link, and says it cannot write in it", async () => {
    const db = testDatabase(), services = fakeServices();
    const env = sagaEnv(db, { GOOGLE_MINUTES_DOC_ID: "open-doc" });
    const result = await overviewOf(env, services.fetcher);
    expect(result.connections.googleDoc).toMatchObject({ ok: true, detail: expect.stringContaining("åbne link") });
    expect(result.minutesDoc).toEqual({ url: "https://docs.google.com/document/d/open-doc/edit", writable: false });
    expect(services.calls.some(c => c.url === "https://docs.google.com/document/d/open-doc/export?format=txt" && !c.url.includes("googleapis"))).toBe(true);
  });

  it("says so when the link is not open (Google answers with its login page)", async () => {
    const db = testDatabase(), services = fakeServices();
    const login: typeof fetch = async (input, init) => String(input).startsWith("https://docs.google.com/")
      ? new Response("<html>Log ind</html>", { headers: { "content-type": "text/html; charset=utf-8" } }) : services.fetcher(input, init);
    const result = await overviewOf(sagaEnv(db, { GOOGLE_MINUTES_DOC_ID: "closed-doc" }), login);
    expect(result.connections.googleDoc).toMatchObject({ ok: false, detail: expect.stringContaining("Alle med linket") });
  });

  it("uses the open document for answers, and on approval points to it instead of writing", async () => {
    const db = testDatabase();
    const prompts: string[] = [];
    const services = fakeServices({ ai: (_system, user) => { prompts.push(user); return user.includes("JACOB SPØRGER") ? "Kagekassen blev vedtaget." : MINUTES; } });
    const { SAGA_BOARD_POSTING: _on, ...env } = sagaEnv(db, { GOOGLE_MINUTES_DOC_ID: "open-doc" });
    await webhook(env as SagaEnv, services.fetcher, privateMessage(4, { text: "Hvad besluttede vi om kage?" }));
    expect(prompts[0]).toContain("Beslutning: Ny kagekasse.");
    await webhook(env as SagaEnv, services.fetcher, privateMessage(5, { voice: { file_id: "voice-1", file_size: 5000 } }));
    await webhook(env as SagaEnv, services.fetcher, callback("approve:minutes:1"));
    expect(services.calls.some(c => c.url.includes("googleapis.com"))).toBe(false);
    expect(await getMinutes(db, 1)).toMatchObject({ status: "approved" });
    expect(services.telegram("answerCallbackQuery").at(-1)?.body).toMatchObject({ text: expect.stringContaining("https://docs.google.com/document/d/open-doc/edit") });
  });
});
