import { describe, expect, it } from "vitest";
import { addressesSaga, handleSagaRequest } from "./handler.js";
import { markdownToHtml, section } from "./markdown.js";
import { runSagaJobs } from "./saga.js";
import { getMinutes, getPostDraft } from "./store.js";
import { deps, fakeServices, OWNER, BOARD, sagaEnv, testDatabase } from "./test-support.js";
import { speakerTranscript } from "./transcribe.js";
import { trimMinutesDoc } from "./picture.js";
import type { SagaEnv } from "./env.js";
import { OVERVIEW_SYSTEM } from "./prompts.js";

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
    // Requested: "Referatet skal op uden godkendelse" - it is written into the document at once.
    const update = services.calls.find(c => c.url.endsWith("minutes-doc:batchUpdate"));
    const requests = (update?.body as { requests: Array<Record<string, any>> }).requests;
    expect(requests[0]).toEqual({ insertText: { location: { index: 119 }, text: expect.stringContaining("\nReferat - bestyrelsesmøde 2026-09-23\nReferat\n\nTil stede\n• Jacob") } });
    expect(requests[0]!.insertText.text).toContain("• Budgettet er vedtaget.");
    expect(requests[1]).toMatchObject({ updateParagraphStyle: { range: { startIndex: 120, endIndex: 120 + "Referat - bestyrelsesmøde 2026-09-23".length + 1 }, paragraphStyle: { namedStyleType: "HEADING_2" } } });
    expect(await getMinutes(db, 1)).toMatchObject({ status: "approved", drive_document_url: "https://docs.google.com/document/d/minutes-doc/edit" });
    expect(services.telegram("sendDocument").at(-1)?.body).toMatchObject({ chat_id: OWNER, caption: expect.stringContaining("Det er også skrevet ind i referatdokumentet.") });
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

  // Requested: "jeg skal ikke have hjælp til de daglige mails. Det er ikke mig der står for team@
  // Jeg skal blot have et overordnet resume og temperaturtjek".
  it("keeps each new mail once as background, never judging it or sending it on to the chair", async () => {
    const db = testDatabase();
    const services = fakeServices({ ai: () => "burde ikke blive kaldt" });
    const env = sagaEnv(db);
    expect((await relay(env, services.fetcher, mails, "wrong-secre")).status).toBe(401);
    expect(await (await relay(env, services.fetcher, mails)).json()).toEqual({ received: 3, fresh: 3 });
    expect(await (await relay(env, services.fetcher, mails)).json()).toEqual({ received: 3, fresh: 0 });
    expect(services.telegram("sendMessage")).toHaveLength(0);
    expect(services.calls.filter(c => (c.body as { chat_id?: string })?.chat_id === BOARD)).toHaveLength(0);
    const overview = await (await handleSagaRequest(new Request("https://hjerterum.test/api/saga/liva/overview", { headers: { authorization: "Bearer liva-secret" } }), env, deps(services.fetcher, NOW))).json() as { mail: unknown };
    expect(overview.mail).toEqual({ week: { total: 3 } });
  });

  it("uses the mail for the overview's themes and temperature, and in his own answers", async () => {
    const db = testDatabase();
    const prompts: Array<{ system: string; user: string }> = [];
    const services = fakeServices({ ai: (system, user) => { prompts.push({ system, user }); return user.includes("JACOB SPØRGER") ? "Udlejeren varsler huslejestigning." : "- Roligt.\nTemperatur: God."; } });
    const env = sagaEnv(db);
    await relay(env, services.fetcher, mails.slice(0, 1));
    await webhook(env, services.fetcher, privateMessage(9, { text: "Er der noget i mailen?" }));
    expect(prompts.at(-1)!.user).toContain("HJERTERUMS MAIL (team@holistisk.org)");
    expect(prompts.at(-1)!.user).not.toContain("KRÆVER OPMÆRKSOMHED");
    expect(OVERVIEW_SYSTEM).toContain("Temperatur:");
    expect(OVERVIEW_SYSTEM).toContain("Bookinger, aflysninger og den daglige drift nævnes ikke");
    expect(OVERVIEW_SYSTEM).toContain("medlemmerne");
    expect(OVERVIEW_SYSTEM).toContain("Vigtigst er bestyrelsens Telegram-gruppe");
  });
});

describe("Saga's minutes", () => {
  // Requested: "Referatet skal op uden godkendelse, men alle medlemmer skal pinges til at godkende referatet"
  // - "Hej alle sammen 😊 / Så er referatet klar til godkendelse: / URL".
  it("puts the minutes up at once, pings the board to approve them, and the chair can still correct them", async () => {
    const db = testDatabase();
    let transcript = "";
    const services = fakeServices({ ai: (system, user) => {
      if (user.includes("RETTELSE")) return MINUTES.replace("1. oktober", "8. oktober");
      if (user.includes("TRANSSKRIPTION")) transcript = user; return MINUTES;
    } });
    const env = sagaEnv(db, { SAGA_MINUTES_PING: "on", COCKPIT_URL: "https://cockpit.hjerterum.info" });
    await webhook(env, services.fetcher, privateMessage(5, { voice: { file_id: "voice-1", mime_type: "audio/ogg", file_size: 5000 } }));

    expect(services.telegram("sendMessage")[0]?.body).toMatchObject({ chat_id: OWNER, text: expect.stringMatching(/^Modtaget/) });
    expect(services.telegram("getFile")).toHaveLength(1);
    expect(transcript).toContain("Taler 1: Vi vedtager budgettet.\nTaler 2: Enig.");
    expect(transcript).toContain("Mødedato: 23. september 2026");
    const [document] = services.telegram("sendDocument");
    expect(document?.body).toMatchObject({ chat_id: OWNER, document: "[file Referat 2026-09-23.md]", caption: expect.stringContaining("https://cockpit.hjerterum.info/referat/1") });
    expect((document?.body as { reply_markup?: string }).reply_markup).toBeUndefined();
    const published = (await getMinutes(db, 1))!;
    expect(published).toMatchObject({ status: "approved", draft_markdown: MINUTES });
    const pings = () => services.telegram("sendMessage").filter(c => (c.body as { chat_id: string }).chat_id === BOARD).map(c => (c.body as { text: string }).text);
    expect(pings()).toEqual(["Hej alle sammen 😊\nSå er referatet fra mødet 23. september 2026 klar til godkendelse:\nhttps://cockpit.hjerterum.info/referat/1"]);

    // The same recording again is not transcribed twice.
    await webhook(env, services.fetcher, privateMessage(6, { voice: { file_id: "voice-1", file_size: 5000 } }));
    expect(services.telegram("sendMessage").filter(c => (c.body as { chat_id: string }).chat_id === OWNER)[1]?.body).toMatchObject({ text: "Den optagelse har jeg allerede fået." });

    // A reply corrects the minutes in place; the board's sign-offs start over.
    await db.prepare("INSERT INTO board_minutes_signoffs (minutes_id, member, status, comment, at_ms) VALUES (1, 'Gitta', 'approved', NULL, 1)").run();
    await webhook(env, services.fetcher, privateMessage(7, { text: "Næste møde er 8. oktober", reply_to_message: { message_id: published.approval_message_id } }));
    expect(await getMinutes(db, 1)).toMatchObject({ status: "approved", draft_markdown: expect.stringContaining("8. oktober") });
    expect(await count(db, "board_minutes_signoffs")).toBe(0);
    expect(services.telegram("sendDocument")).toHaveLength(2);
    expect(pings()[1]).toBe("Hej alle sammen 😊\nReferatet fra mødet 23. september 2026 er rettet og klar til godkendelse igen:\nhttps://cockpit.hjerterum.info/referat/1");
    // Without the ping turned on, Saga stays silent in the group.
    const quiet = testDatabase(), other = fakeServices({ ai: () => MINUTES });
    await webhook(sagaEnv(quiet), other.fetcher, privateMessage(5, { voice: { file_id: "voice-2", file_size: 5000 } }));
    expect(await getMinutes(quiet, 1)).toMatchObject({ status: "approved" });
    expect(other.calls.filter(c => (c.body as { chat_id?: string })?.chat_id === BOARD)).toHaveLength(0);
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
    expect(await getMinutes(db, 1)).toMatchObject({ source: "drive", source_file_id: "rec-1", status: "approved", meeting_date: "2026-09-22" });
    const token = services.calls.find(c => c.url === "https://oauth2.googleapis.com/token");
    expect(String(token?.body)).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");

    // A second run finds the same file and does not queue it again.
    await runSagaJobs(env, deps(services.fetcher, NOW + 300_000));
    expect(await count(db, "board_minutes")).toBe(1);

    const upload = services.calls.find(c => c.url.startsWith("https://www.googleapis.com/upload/drive/v3/files"));
    expect(upload?.method).toBe("POST");
    expect(await getMinutes(db, 1)).toMatchObject({ status: "approved", drive_document_url: "https://docs.google.com/document/d/doc-1/edit" });
    expect(services.telegram("sendMessage").filter(c => (c.body as { chat_id: string }).chat_id === BOARD)).toHaveLength(0);
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
      minutes: [{ id: 1, meetingDate: "2026-09-23", status: "approved", decisions: "- Budgettet er vedtaget.", tasks: "- Jacob - sender budgettet - fredag", url: null }],
      pending: [],
      pendingApprovals: 0, weeklySummary: null,
      mail: { week: { total: 0 } },
      // New minutes have Saga write her overview again at once.
      overview: { text: MINUTES, at: new Date(NOW).toISOString() },
      picture: null,
      group: { activity: { thisWeek: 1, lastWeek: 0, members: [{ name: "Mette", count: 1 }] }, link: "https://t.me/c/222/1",
        recent: [{ author: "Mette", text: "Husk kage til mødet", sentAt: new Date(NOW - 60_000).toISOString(), link: "https://t.me/c/222/1" }] },
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
    expect(services.calls.some(c => c.url.includes("googleapis.com"))).toBe(false);
    expect(await getMinutes(db, 1)).toMatchObject({ status: "approved" });
    expect(services.telegram("sendDocument").at(-1)?.body).toMatchObject({ caption: expect.stringContaining("Saga kan ikke skrive i referatdokumentet") });
  });
});

// Requested: "hvad vil være en smart gengivelse af telegram gruppechatten?" - "Ja!" - "Men vi skal også
// have lavet en lignende analyse af dokumentet - f.eks. beslutninger, foreslag, opgaver. Måske skal vi
// samle ét sted med spørgsmål og todos til mig drager ud af både telegram og doc og mail".
describe("the board's picture: the group, the document and what waits on the chair", () => {
  const PICTURE = {
    summary: "## Gruppen\n- Kagekassen er besluttet.\n\nTemperatur: God - folk er engagerede.",
    temperature: { level: "god", why: "Folk er engagerede." },
    topics: [{ title: "Kagekasse", status: "besluttet", who: ["Mette"], waitsOnJacob: false, note: "Vedtaget." },
      { title: "Nyt lokale", status: "venter", who: ["Mette", "Ole"], waitsOnJacob: true, note: "Venter på formandens svar." }, { title: "" }],
    document: { latestMeeting: "17/9 2026", missingMinutes: ["10/9 2026"],
      dates: [{ date: "2026-10-14", what: "Generalforsamling" }, { date: "14. oktober", what: "Ikke en dag" }],
      figures: [{ label: "Medlemmer", value: "ca. 168", date: "17/9 2026", previous: "ca. 137 (20/8 2026)" }, { label: "Kasse" }],
      decisions: [{ topic: "Generalforsamling", text: "Afholdes 14. oktober 2026.", date: "17/9 2026", replaces: "30. september (3/9)" }],
      openThreads: [{ text: "Lavere husleje hos udlejer", since: "23/7 2026", status: "ingen opfølgning" }, { text: "Medlemskab for bestyrelsen", since: "17/9 2026", status: "parkeret" }],
      proposals: [{ text: "Sommerfest i juni", by: "Ole" }],
      tasks: [{ who: "Mette", what: "Indkøbe kage", due: "fredag", since: "17/9 2026" }, { who: "x" }], nextAgenda: ["Medlemskab for bestyrelsen", ""] },
    forJacob: [{ kind: "spørgsmål", text: "Skal vi leje lokalet på Nørrebro?", source: "telegram", from: "Mette", since: "" },
      { kind: "opgave", text: "Underskriv lejekontrakten", source: "dokument", from: "" },
      { kind: "opgave", text: "Svar kommunen om tilskud", source: "mail", from: "Kommunen" },
      { kind: "opgave", text: "Underskriv  lejekontrakten!", source: "dokument", from: "" }]
  };
  const google = async () => ({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "saga@hjerterum.iam.gserviceaccount.com", private_key: await testPrivateKey() }), GOOGLE_MINUTES_DOC_ID: "minutes-doc" });
  const overviewOf = async (env: SagaEnv, fetcher: typeof fetch) => (await (await handleSagaRequest(new Request("https://hjerterum.test/api/saga/liva/overview", {
    headers: { authorization: "Bearer liva-secret" } }), env, deps(fetcher, NOW))).json()) as { overview: { text: string }; picture: { topics: unknown[]; document: Record<string, unknown[]>; forJacob: Array<{ key: string; text: string; source: string }>; temperature: unknown } };
  const done = (env: SagaEnv, fetcher: typeof fetch, body: unknown) => handleSagaRequest(new Request("https://hjerterum.test/api/saga/liva/done", {
    method: "POST", headers: { authorization: "Bearer liva-secret", "content-type": "application/json" }, body: JSON.stringify(body) }), env, deps(fetcher, NOW));

  it("keeps the picture from the same one AI call, checked field by field, and hides what the chair marked as done", async () => {
    const db = testDatabase();
    const contexts: string[] = [];
    const services = fakeServices({ ai: (system, user) => { if (system.includes("overordnet overblik")) { contexts.push(user); return "```json\n" + JSON.stringify(PICTURE) + "\n```"; } return "[]"; } });
    const env = sagaEnv(db, await google());
    await webhook(env, services.fetcher, boardMessage(1, "Skal vi leje lokalet på Nørrebro, Jacob?"));
    await runSagaJobs(env, deps(services.fetcher, NOW));
    expect(contexts).toHaveLength(1);
    // The AI knows what day it is, so "kommende datoer" and "ingen opfølgning" mean something.
    expect(contexts[0]).toMatch(/^I DAG: 23\. september 2026\n/);
    const first = await overviewOf(env, services.fetcher);
    expect(first.overview.text).toBe(PICTURE.summary);
    expect(first.picture.temperature).toEqual({ level: "god", why: "Folk er engagerede." });
    // An unknown status becomes "drøftes"; an item without a title or text is dropped; the same item twice is shown once.
    expect(first.picture.topics).toEqual([PICTURE.topics[0], { ...PICTURE.topics[1], status: "drøftes" }]);
    // A date that is not a real day, a figure without a value and an empty agenda point are dropped; an unknown status becomes "afventer".
    expect(first.picture.document).toEqual({ latestMeeting: "17/9 2026", missingMinutes: ["10/9 2026"], dates: [PICTURE.document.dates[0]],
      figures: [PICTURE.document.figures[0]], decisions: PICTURE.document.decisions,
      openThreads: [PICTURE.document.openThreads[0], { ...PICTURE.document.openThreads[1], status: "afventer" }],
      proposals: PICTURE.document.proposals, tasks: [PICTURE.document.tasks[0]], nextAgenda: ["Medlemskab for bestyrelsen"] });
    expect(first.picture.forJacob.map(f => [f.text, f.source])).toEqual([["Skal vi leje lokalet på Nørrebro?", "telegram"], ["Underskriv lejekontrakten", "dokument"], ["Svar kommunen om tilskud", "mail"]]);

    const sign = first.picture.forJacob[1]!;
    expect((await done(env, services.fetcher, { key: sign.key, text: "Noget andet" })).status).toBe(400);
    expect(await (await done(env, services.fetcher, { key: sign.key, text: sign.text })).json()).toEqual({ done: true });
    expect((await overviewOf(env, services.fetcher)).picture.forJacob.map(f => f.text)).toEqual(["Skal vi leje lokalet på Nørrebro?", "Svar kommunen om tilskud"]);

    // The next overview is told what is done, so it is not raised again.
    const later = boardMessage(2, "Lokalet er lejet");
    later.message.date = (NOW + 7 * 3_600_000) / 1000;
    await webhook(env, services.fetcher, later);
    await runSagaJobs(env, deps(services.fetcher, NOW + 12 * 3_600_000));
    expect(contexts).toHaveLength(2);
    expect(contexts[1]).toContain("JACOB HAR MARKERET SOM KLARET:\n- Underskriv lejekontrakten");
  });

  it("writes a new overview when only the minutes document changed, read without AI, and keeps a plain-text answer as text", async () => {
    const db = testDatabase();
    let doc = "Referat 1. september 2026\nBeslutning: Ny kagekasse.", calls = 0;
    const services = fakeServices({ ai: (system) => { if (system.includes("overordnet overblik")) { calls++; return "Roligt i bestyrelsen.\n\nTemperatur: Rolig."; } return "[]"; } });
    const fetcher: typeof fetch = async (input, init) => String(input).includes("/export?") ? new Response(doc) : services.fetcher(input, init);
    const env = sagaEnv(db, await google());
    await webhook(env, services.fetcher, boardMessage(1, "Husk kage"));
    await runSagaJobs(env, deps(fetcher, NOW));
    expect(calls).toBe(1);
    expect((await overviewOf(env, fetcher)).picture).toBeNull();
    expect((await overviewOf(env, fetcher)).overview.text).toBe("Roligt i bestyrelsen.\n\nTemperatur: Rolig.");
    await runSagaJobs(env, deps(fetcher, NOW + 6 * 3_600_000));
    expect(calls).toBe(1);
    doc += "\nReferat 20. september 2026\nForslag: Sommerfest.";
    await runSagaJobs(env, deps(fetcher, NOW + 12 * 3_600_000));
    expect(calls).toBe(2);
  });

  it("writes the picture once for an overview from before it, then only when something is new", async () => {
    const db = testDatabase();
    let calls = 0;
    const services = fakeServices({ ai: (system) => { if (system.includes("overordnet overblik")) { calls++; return JSON.stringify(PICTURE); } return "[]"; } });
    const env = sagaEnv(db);
    await webhook(env, services.fetcher, boardMessage(1, "Husk kage"));
    await db.prepare("INSERT INTO board_overviews (text, created_at_ms) VALUES (?, ?)").bind("Gammelt overblik", NOW).run();
    await runSagaJobs(env, deps(services.fetcher, NOW + 3_600_000));
    await runSagaJobs(env, deps(services.fetcher, NOW + 7 * 3_600_000));
    expect(calls).toBe(1);
  });
});

// The board writes its newest meeting at the top of the document and Saga appends hers at the end,
// so what the AI reads is cut by meeting date, not by position.
describe("the minutes document for the AI", () => {
  const meeting = (date: string, body: string) => `Dato for møde: ${date}  kl.13:30-15:30\n\nDeltagere: Douglas, Jacob\n\nReferat\n${body}\n`;
  const doc = "Dagsordener & referater\n" + meeting("17/9/ 2026", "Nyeste møde. " + "a".repeat(300)) + meeting("10/9 2026", "Kun dagsorden.")
    + meeting("27/8/2026", "Ældre møde. " + "b".repeat(300)) + meeting("23/7 2026", "Ældste møde. " + "c".repeat(300))
    + "Referat - bestyrelsesmøde 1. oktober 2026\nSagas eget referat, tilføjet sidst.";

  it("keeps the newest meetings first, wherever they stand, and names the ones left out", () => {
    const text = trimMinutesDoc(doc, 900);
    expect(text.indexOf("Sagas eget referat")).toBe(text.indexOf("Referat - bestyrelsesmøde 1. oktober 2026") + "Referat - bestyrelsesmøde 1. oktober 2026\n".length);
    expect(text.indexOf("1. oktober")).toBeLessThan(text.indexOf("Nyeste møde"));
    expect(text.indexOf("Nyeste møde")).toBeLessThan(text.indexOf("Kun dagsorden"));
    expect(text).not.toContain("Ældste møde");
    expect(text).toMatch(/\[Ældre møder ikke medtaget: .*23\/7 2026\]$/);
  });

  it("keeps everything when it fits, and cuts a document without meeting dates at its start and end", () => {
    expect(trimMinutesDoc(doc, 100_000)).toContain("Ældste møde");
    expect(trimMinutesDoc(doc, 100_000)).not.toContain("ikke medtaget");
    const plain = "start " + "x".repeat(2000) + " slut";
    expect(trimMinutesDoc(plain, 400)).toMatch(/^start x+\n\[…\]\nx+ slut$/);
  });
});
