import { describe, expect, it } from "vitest";
import config from "../config-entry.js";
import { handleCockpitRequest } from "./handler.js";
import { processNextMinutes } from "../saga/saga.js";
import { createPostDraft, decideMinutes, decidePostDraft, markOwnerDone, markPosted, queueMinutes, saveBoardMessage, saveOverview, updateMinutes } from "../saga/store.js";
import { itemKey } from "../saga/picture.js";
import { BOARD, deps, fakeServices, OWNER, sagaEnv, testDatabase } from "../saga/test-support.js";
import type { SagaEnv } from "../saga/env.js";

// Requested: "Lad os bygge cockpit.hjerterum.info for bestyrelsen. Her er der styr på referater og
// dagsorden. Samt et overblik ... både generelt og personligt (f.eks. personlige todos) - baseret på
// hvem der er logget ind." - "Til start laver vi bare ét samlet login".

const ORIGIN = "https://hjerterum-platform-staging.example.workers.dev";
const NOW = Date.parse("2026-10-01T10:00:00Z");

function bucket() {
  const stored = new Map<string, { bytes: ArrayBuffer; type: string | undefined }>();
  return { stored, put: async (key: string, value: ArrayBuffer | ReadableStream, options?: { httpMetadata?: { contentType?: string } }) => {
    stored.set(key, { bytes: value as ArrayBuffer, type: options?.httpMetadata?.contentType }); return {}; },
    get: async (key: string) => stored.has(key) ? { arrayBuffer: async () => stored.get(key)!.bytes } : null };
}

async function setup(extra: Partial<SagaEnv> = {}) {
  const db = testDatabase();
  const services = fakeServices({ ai: system => system.includes("referat") ? "# Referat - bestyrelsesmøde 30. september 2026\n## Beslutninger\n- Budgettet er vedtaget\n## Opgaver\n- Gitta - Lav event-mail - 15. oktober" : "Svar." });
  const recordings = bucket();
  const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026", BOARD_RECORDINGS: recordings, ...extra });
  for (const [i, [name, id]] of ([["Jacob Hauge", OWNER], ["Lisbeth", "201"], ["Gitta", "202"]] as const).entries()) {
    await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: id, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
  }
  const call = (path: string, init: RequestInit & { cookie?: string } = {}, host = ORIGIN) => handleCockpitRequest(new Request(host + path, {
    ...init, headers: { ...(init.method === "POST" ? { origin: host } : {}), ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.headers ?? {}) } }), env, deps(services.fetcher, NOW));
  const form = (fields: Record<string, string | Blob>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
  const login = async () => {
    const response = await call("/cockpit/login", { method: "POST", body: form({ password: "hjerte-2026" }) });
    return (response.headers.get("set-cookie") ?? "").split(";")[0]!;
  };
  return { db, env, services, recordings, call, form, login };
}

describe("the board cockpit", () => {
  it("lets no one in without the shared password, and says when it is not set up", async () => {
    const plain = await setup({ COCKPIT_PASSWORD: "" });
    const closed = await plain.call("/cockpit");
    expect(closed.status).toBe(503);
    expect(await closed.text()).toContain("formanden mangler at vælge den fælles adgangskode");
    const { call, form } = await setup();
    const page = await call("/cockpit");
    expect(page.status).toBe(401);
    expect(await page.text()).toContain("Fælles adgangskode");
    expect((await call("/cockpit/moder")).status).toBe(401);
    expect((await call("/cockpit/login", { method: "POST", body: form({ password: "forkert" }) })).status).toBe(401);
  });

  it("logs in with the shared password, asks who you are, and stops guessing after ten tries", async () => {
    const { call, form } = await setup();
    const ok = await call("/cockpit/login", { method: "POST", body: form({ password: "hjerte-2026" }) });
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("/cockpit/hvem");
    expect(ok.headers.get("set-cookie")).toMatch(/^hjerterum_cockpit=\d+\.[\w-]+; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Lax; Secure$/);
    const cross = await call("/cockpit/login", { method: "POST", body: form({ password: "hjerte-2026" }), headers: { origin: "https://evil.example" } });
    expect(cross.status).toBe(403);
    for (let i = 0; i < 10; i++) await call("/cockpit/login", { method: "POST", body: form({ password: "gæt" + i }) });
    expect((await call("/cockpit/login", { method: "POST", body: form({ password: "hjerte-2026" }) })).status).toBe(429);
  });

  it("knows the board from its group, and remembers who you are", async () => {
    const { call, form, login } = await setup();
    const session = await login();
    const who = await (await call("/cockpit/hvem", { cookie: session })).text();
    for (const name of ["Gitta", "Jacob Hauge", "Lisbeth"]) expect(who).toContain(`value="${name}"`);
    const chosen = await call("/cockpit/hvem", { method: "POST", cookie: session, body: form({ who: "Lisbeth" }) });
    expect(chosen.headers.get("set-cookie")).toContain("hjerterum_cockpit_who=Lisbeth");
    expect((await call("/cockpit/hvem", { method: "POST", cookie: session, body: form({ who: "Ukendt Person" }) })).status).toBe(400);
  });

  it("shows each person their own tasks, and the chair also what waits on him", async () => {
    const { db, call, login } = await setup();
    const session = await login();
    const picture = { summary: "God energi efter weekenden.", temperature: { level: "god", why: "Travlt op til generalforsamlingen" },
      topics: [{ title: "Reduceret medlemskab", status: "drøftes", who: ["Lisbeth"], waitsOnJacob: false, note: "Forslag til GF" }],
      document: { latestMeeting: "17/9", missingMinutes: [], dates: [{ date: "2026-10-14", what: "Generalforsamling" }], figures: [], decisions: [{ topic: "Prøveperiode", text: "Gratis prøveperiode til 15. oktober", date: "17/9", replaces: "" }],
        openThreads: [], proposals: [], tasks: [{ who: "Lisbeth", what: "Skriv forslag om reduceret medlemskab", due: "14/10", since: "17/9" }], nextAgenda: [] },
      forJacob: [{ key: "", kind: "spørgsmål", text: "Skal vi svare Thomas Emil?", source: "telegram", from: "Blanka", since: "" }] };
    await saveOverview(db, picture.summary, NOW, { data: JSON.stringify(picture), docHash: "x" });
    const minutesId = (await queueMinutes(db, { source: "telegram", fileId: "f1", fileName: "møde.m4a", mimeType: "audio/mp4", meetingDate: "2026-09-17", nowMs: NOW }))!;
    await updateMinutes(db, minutesId, { status: "drafted", draft: "# Referat\n## Beslutninger\n- Budgettet er vedtaget\n## Opgaver\n- Gitta - Lav event-mail - 15. oktober\n- Alle - Del opslaget - ingen frist aftalt" }, NOW);
    await decideMinutes(db, minutesId, "approved", NOW);
    const lisbeth = await (await call("/cockpit/", { cookie: `${session}; hjerterum_cockpit_who=Lisbeth` })).text();
    expect(lisbeth).toContain("Hej Lisbeth");
    const mine = lisbeth.slice(lisbeth.indexOf("<h2>Til dig"), lisbeth.indexOf("<h2>Næste møde"));
    expect(mine).toContain("Skriv forslag om reduceret medlemskab");
    expect(mine.match(/Skriv forslag om reduceret medlemskab/g)).toHaveLength(1);
    expect(mine).toContain("Del opslaget");
    expect(mine).not.toContain("Lav event-mail");
    // Everyone's tasks stand under "Hvem har hvad", as in Matrix.
    expect(lisbeth.slice(lisbeth.indexOf("Hvem har hvad"))).toContain("Lav event-mail");
    expect(lisbeth).not.toContain("Thomas Emil");
    expect(lisbeth).toContain("God energi efter weekenden.");
    const chair = await (await call("/cockpit/", { cookie: `${session}; hjerterum_cockpit_who=Jacob%20Hauge` })).text();
    expect(chair).toContain("Til dig som formand");
    expect(chair).toContain("Skal vi svare Thomas Emil?");
    const decisions = await (await call("/cockpit/beslutninger", { cookie: session })).text();
    expect(decisions).toContain("Budgettet er vedtaget");
    expect(decisions).toContain("Gratis prøveperiode til 15. oktober");
    expect(decisions).toContain(`/cockpit/referat/${minutesId}`);
  });

  it("plans meetings with their agenda, the weekday taken from the date", async () => {
    const { db, call, form, login } = await setup();
    const session = await login();
    const created = await call("/cockpit/moder", { method: "POST", cookie: `${session}; hjerterum_cockpit_who=Gitta`,
      body: form({ meeting_date: "2026-10-08", start_time: "13:30", place: "Hjerterum", agenda: "Godkendelse af referat\n\nReduceret medlemskab\n Eventuelt " }) });
    expect(created.status).toBe(303);
    const id = /\/moder\/(\d+)/.exec(created.headers.get("location")!)![1];
    const list = await (await call("/cockpit/moder", { cookie: session })).text();
    expect(list).toContain("torsdag den 8. oktober 2026");
    expect(list).toContain("<li>Reduceret medlemskab</li>");
    const next = await (await call("/cockpit/", { cookie: session })).text();
    expect(next).toContain("kl. 13:30 · Hjerterum");
    await call(`/cockpit/moder/${id}`, { method: "POST", cookie: session, body: form({ meeting_date: "2026-10-08", start_time: "14:00", place: "", agenda: "Økonomi" }) });
    const row = await db.prepare("SELECT agenda, start_time, updated_by FROM board_meetings WHERE id = ?").bind(Number(id)).first<{ agenda: string; start_time: string; updated_by: string | null }>();
    expect(row).toEqual({ agenda: "Økonomi", start_time: "14:00", updated_by: null });
    await call(`/cockpit/moder/${id}/slet`, { method: "POST", cookie: session });
    expect((await call(`/cockpit/moder/${id}`, { cookie: session })).status).toBe(404);
  });

  it("takes an uploaded recording, Saga writes the minutes for the chair, and only approved minutes are shown", async () => {
    const { db, env, services, recordings, call, form, login } = await setup();
    const session = await login();
    const notAudio = await call("/cockpit/upload", { method: "POST", cookie: session, body: form({ recording: new File(["x"], "noter.pdf", { type: "application/pdf" }), meeting_date: "2026-09-30" }) });
    expect(notAudio.status).toBe(400);
    const uploaded = await call("/cockpit/upload", { method: "POST", cookie: session, body: form({ recording: new File([new Uint8Array([1, 2, 3])], "Bestyrelsesmøde 30-9.m4a", { type: "audio/mp4" }), meeting_date: "2026-09-30" }) });
    expect(uploaded.headers.get("location")).toBe("/cockpit/moder?upload=1");
    expect([...recordings.stored.keys()][0]).toMatch(/^cockpit\/2026-09-30\/[0-9a-f-]{36}\.m4a$/);
    const queued = await db.prepare("SELECT id, source, status, meeting_date FROM board_minutes").first<{ id: number; source: string; status: string; meeting_date: string }>();
    expect(queued).toMatchObject({ source: "upload", status: "queued", meeting_date: "2026-09-30" });
    expect(await processNextMinutes(env, deps(services.fetcher, NOW))).toBe(true);
    expect(services.calls.some(c => c.url === "https://api.elevenlabs.io/v1/speech-to-text")).toBe(true);
    expect(services.telegram("sendDocument")).toHaveLength(1);
    expect((await call(`/cockpit/referat/${queued!.id}`, { cookie: session })).status).toBe(404);
    expect(await (await call("/cockpit/", { cookie: session })).text()).toContain("1 referat venter på formandens godkendelse");
    await decideMinutes(db, queued!.id, "approved", NOW);
    const minutes = await (await call(`/cockpit/referat/${queued!.id}`, { cookie: session })).text();
    expect(minutes).toContain("<li>Budgettet er vedtaget</li>");
    expect(await (await call("/cockpit/moder", { cookie: session })).text()).toContain(`/cockpit/referat/${queued!.id}`);
  });

  // Requested: "Jeg synes dit overblik i matrix er super og detaljeret. Vi skal have det samme med".
  it("shows the board the same overview as the chair's Hjerterum page in Matrix", async () => {
    const { db, call, login } = await setup();
    const session = await login();
    const picture = { summary: "## Gruppen\n- **Generalforsamlingen** fylder\nTemperatur: god", temperature: { level: "travl", why: "GF nærmer sig" },
      topics: [{ title: "Lokaleleje", status: "afventer", who: ["Gitta"], waitsOnJacob: true, note: "Venter på svar fra udlejer" }],
      document: { latestMeeting: "2026-09-17", missingMinutes: ["2026-09-03"], dates: [{ date: "2026-10-08", what: "Bestyrelsesmøde" }, { date: "2026-10-14", what: "Generalforsamling" }],
        figures: [{ label: "Medlemmer", value: "112", date: "2026-09-17", previous: "104 (3/9)" }],
        decisions: [{ topic: "Prøveperiode", text: "Gratis til 15. oktober", date: "2026-09-17", replaces: "Gratis til 1. oktober" }],
        openThreads: [{ text: "Nyt skilt ved døren", since: "2026-08-20", status: "udsat" }], proposals: [{ text: "Sommerfest i juni", by: "Lisbeth" }],
        tasks: [{ who: "Gitta", what: "Ring til udlejer", due: "10/10", since: "2026-09-17" }], nextAgenda: ["Opfølgning på skiltet", "Lokaleleje"] },
      forJacob: [{ key: "", kind: "opgave", text: "Underskriv lejekontrakten", source: "dokument", from: "", since: "" }, { key: "", kind: "spørgsmål", text: "Godkend budgettet", source: "telegram", from: "Gitta", since: "" }] };
    await saveOverview(db, "x", NOW, { data: JSON.stringify(picture), docHash: "x" });
    await markOwnerDone(db, itemKey("Godkend budgettet"), "Godkend budgettet", NOW);
    await saveBoardMessage(db, { chatId: BOARD, messageId: 99, author: "Gitta", authorId: "202", text: "Jeg ringer til udlejer i morgen", sentAtMs: NOW - 3_600_000, fromAssistant: false });
    const weekly = await createPostDraft(db, { kind: "weekly_summary", text: "- Lokaleleje er på vej", nowMs: NOW });
    await decidePostDraft(db, weekly, "approved", NOW);
    await markPosted(db, weekly, 5);
    const page = await (await call("/cockpit/", { cookie: `${session}; hjerterum_cockpit_who=Jacob%20Hauge` })).text();
    for (const text of ["Gruppen lige nu", "beskeder denne uge", "Jeg ringer til udlejer i morgen", "venter på dig", "Referatdokumentet", "Referat mangler: 3. sep. 2026",
      "Medlemmer: <strong>112</strong>", "før: 104 (3/9)", "Afløser: Gratis til 1. oktober", "Nyt skilt ved døren", "Hvem har hvad", "Ring til udlejer", "Sommerfest i juni",
      "Forslag til næste dagsorden", "<strong>Generalforsamlingen</strong>", "Ugeopsummering", "Lokaleleje er på vej", "om 13 dage", "Underskriv lejekontrakten"]) expect(page).toContain(text);
    expect(page).not.toContain("Godkend budgettet");
    // Saga found a board meeting that is not in the calendar yet; the others see "venter på formanden".
    expect(page).toContain("/cockpit/moder?dato=2026-10-08&amp;forslag=1#nyt");
    expect(page).not.toContain("Godkend</button>");
    const lisbeth = await (await call("/cockpit/", { cookie: `${session}; hjerterum_cockpit_who=Lisbeth` })).text();
    expect(lisbeth).toContain("venter på formanden");
    expect(lisbeth).not.toContain("Underskriv lejekontrakten");
    const plan = await (await call("/cockpit/moder?dato=2026-10-08&forslag=1", { cookie: session })).text();
    expect(plan).toContain('value="2026-10-08"');
    expect(plan).toContain("Opfølgning på skiltet\nLokaleleje</textarea>");
    expect(await (await call("/cockpit/moder", { cookie: session })).text()).toContain("Indsæt Sagas forslag (2 punkter)");
  });

  it("uploads a recording to the meeting it belongs to", async () => {
    const { db, call, form, login } = await setup();
    const session = await login();
    for (const date of ["2026-09-03", "2026-09-17"]) await call("/cockpit/moder", { method: "POST", cookie: session, body: form({ meeting_date: "2026-10-20", agenda: "x" }) })
      .then(() => db.prepare("UPDATE board_meetings SET meeting_date = ? WHERE meeting_date = '2026-10-20'").bind(date).run());
    const held = await db.prepare("SELECT id FROM board_meetings WHERE meeting_date = '2026-09-17'").first<{ id: number }>();
    const list = await (await call("/cockpit/moder", { cookie: session })).text();
    expect(list).toMatch(/<option value="2026-09-17" selected>torsdag den 17\. september 2026<\/option>/);
    const meetingPage = await (await call(`/cockpit/moder/${held!.id}`, { cookie: session })).text();
    expect(meetingPage).toContain("Optagelse af dette møde");
    const uploaded = await call("/cockpit/upload", { method: "POST", cookie: session,
      body: form({ recording: new File([new Uint8Array([1])], "optagelse.m4a", { type: "audio/mp4" }), meeting_choice: "2026-09-17", meeting_id: String(held!.id) }) });
    expect(uploaded.headers.get("location")).toBe(`/cockpit/moder/${held!.id}?upload=1`);
    expect(await db.prepare("SELECT meeting_date FROM board_minutes").first<{ meeting_date: string }>()).toEqual({ meeting_date: "2026-09-17" });
    const after = await (await call(`/cockpit/moder/${held!.id}?upload=1`, { cookie: session })).text();
    expect(after).toContain("Saga skriver referatet");
    expect(after).not.toContain("Optagelse af dette møde");
    // The next upload suggests the meeting that still has no minutes.
    expect(await (await call("/cockpit/moder", { cookie: session })).text()).toMatch(/<option value="2026-09-03" selected>/);
  });

  // Requested: "Og så laves der et dokument pr referat - ok? Her skal vi lave et pænt layout og alt med dagsorden i toppen."
  it("writes the minutes along the meeting's agenda, and shows them as one document with the agenda on top", async () => {
    const { db, env, services, call, form, login } = await setup();
    const session = await login();
    await call("/cockpit/moder", { method: "POST", cookie: session, body: form({ meeting_date: "2026-10-20", start_time: "17:00", place: "Hjerterum, Valby", agenda: "1. Godkendelse af referat\n- Økonomi\nEventuelt" }) });
    await db.prepare("UPDATE board_meetings SET meeting_date = '2026-09-30'").run();
    expect((await db.prepare("SELECT agenda FROM board_meetings").first<{ agenda: string }>())!.agenda).toBe("Godkendelse af referat\nØkonomi\nEventuelt");
    let prompt = "";
    services.calls.length = 0;
    const { fakeServices: fake } = await import("../saga/test-support.js");
    const ai = fake({ ai: (system, user) => { prompt = user; return ["# Referat - bestyrelsesmøde 30. september 2026", "**Til stede:** Jacob, Lisbeth, Gitta", "**Fraværende:** Blanka", "",
      "## Punkter", "### 1. Godkendelse af referat", "- Drøftelse: Referatet fra 17/9 blev gennemgået", "- Beslutning: Godkendt", "### 2. Økonomi", "- Drøftelse: Kassen er 41.200 kr.",
      "- Beslutning: Budget 2027 vedtaget", "### 3. Eventuelt", "- Drøftelse: Ikke drøftet", "- Beslutning: Ingen beslutning", "", "## Beslutninger", "- Referatet er godkendt", "- Budget 2027 vedtaget", "",
      "## Opgaver", "- Gitta - Send budgettet ud - 5. oktober", "", "## Næste møde", "28. oktober kl. 17 i Hjerterum"].join("\n"); } });
    const id = (await queueMinutes(db, { source: "telegram", fileId: "f9", fileName: "møde.m4a", mimeType: "audio/mp4", meetingDate: "2026-09-30", nowMs: NOW }))!;
    await processNextMinutes(env, deps(ai.fetcher, NOW));
    expect(prompt).toContain("Tidspunkt: kl. 17:00");
    expect(prompt).toContain("DAGSORDEN");
    expect(prompt).toContain("1. Godkendelse af referat\n2. Økonomi\n3. Eventuelt");
    await decideMinutes(db, id, "approved", NOW);
    const page = await (await call(`/cockpit/referat/${id}`, { cookie: session })).text();
    for (const text of ["Referat af bestyrelsesmøde", "<dd>onsdag den 30. september 2026</dd>", "<dd>kl. 17:00</dd>", "<dd>Hjerterum, Valby</dd>", "<dd>Jacob, Lisbeth, Gitta</dd>", "<dd>Blanka</dd>",
      '<span class="m-label">Beslutning</span>Budget 2027 vedtaget', "m-decision m-none", "<td>Gitta</td><td>Send budgettet ud</td><td>5. oktober</td>", "28. oktober kl. 17 i Hjerterum",
      "Godkendt af formanden 1. oktober 2026", "Print / gem som PDF", "@media print"]) expect(page).toContain(text);
    expect(page.indexOf('class="m-agenda"')).toBeLessThan(page.indexOf('class="m-point"'));
  });

  it("shows the historical minutes from the board's document, one meeting at a time", async () => {
    const { services, call, login } = await setup({ GOOGLE_MINUTES_DOC_ID: "doc-1" });
    const original = services.fetcher;
    const { handleCockpitRequest: handle } = await import("./handler.js");
    const session = await login();
    const fetcher: typeof fetch = async (input, init) => String(input).includes("/export?")
      ? new Response("Dato for møde: 17/9/ 2026\nTil stede: Lisbeth, Gitta\nBeslutning: Prøveperiode\n\nDato for møde: 3/9/2026\nØkonomi gennemgået") : original(input, init);
    const env = sagaEnv(testDatabase(), { COCKPIT_PASSWORD: "hjerte-2026", GOOGLE_MINUTES_DOC_ID: "doc-1" });
    const page = await (await handle(new Request(`${ORIGIN}/cockpit/arkiv`, { headers: { cookie: session } }), env, deps(fetcher, NOW))).text();
    expect(page).toContain("torsdag den 17. september 2026");
    expect(page).toContain("torsdag den 3. september 2026");
    expect(page.indexOf("17. september")).toBeLessThan(page.indexOf("3. september"));
    expect(page).toContain("Økonomi gennemgået");
    expect(await (await call("/cockpit/arkiv", { cookie: session })).text()).toContain("Arkiv");
  });

  it("is the whole site on cockpit.<domain>, and the rest of Hjerterum is untouched elsewhere", async () => {
    const { call, login } = await setup();
    const page = await call("/", {}, "https://cockpit.hjerterum.info");
    expect(page.status).toBe(401);
    expect(await page.text()).toContain('action="/login"');
    void login;
    const routed = await config.fetch(new Request("https://cockpit.hjerterum.info/"), sagaEnv(testDatabase(), { COCKPIT_PASSWORD: "x" }) as never);
    expect(routed.status).toBe(401);
    expect(routed.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
});
