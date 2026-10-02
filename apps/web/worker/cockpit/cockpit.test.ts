import { describe, expect, it } from "vitest";
import config from "../config-entry.js";
import { handleCockpitRequest } from "./handler.js";
import { processNextMinutes } from "../saga/saga.js";
import { createPostDraft, decideMinutes, decidePostDraft, markOwnerDone, markPosted, queueMinutes, saveBoardMessage, saveOverview, updateMinutes } from "../saga/store.js";
import { itemKey } from "../saga/picture.js";
import { STATUTES } from "./statutes.js";
import legacy from "../../src/legacy-content.json";
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
    const plain = await setup({ COCKPIT_PASSWORD: "", SAGA_TELEGRAM_BOT_USERNAME: "" });
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
        openThreads: [], proposals: [], tasks: [{ who: "Lisbeth", what: "Skriv forslag om reduceret medlemskab", due: "14/10", since: "1/10" }, { who: "Lisbeth", what: "Gammel opgave fra før", due: "", since: "17/9" }], nextAgenda: [] },
      forJacob: [{ key: "", kind: "spørgsmål", text: "Skal vi svare Thomas Emil?", source: "telegram", from: "Blanka", since: "" }] };
    await saveOverview(db, picture.summary, NOW, { data: JSON.stringify(picture), docHash: "x" });
    const minutesId = (await queueMinutes(db, { source: "telegram", fileId: "f1", fileName: "møde.m4a", mimeType: "audio/mp4", meetingDate: "2026-10-01", nowMs: NOW }))!;
    await updateMinutes(db, minutesId, { status: "drafted", draft: "# Referat\n## Beslutninger\n- Budgettet er vedtaget\n## Opgaver\n- Gitta - Lav event-mail - 15. oktober\n- Alle - Del opslaget - ingen frist aftalt" }, NOW);
    await decideMinutes(db, minutesId, "approved", NOW);
    const lisbeth = await (await call("/cockpit/", { cookie: `${session}; hjerterum_cockpit_who=Lisbeth` })).text();
    expect(lisbeth).toContain("Hej Lisbeth");
    const mine = lisbeth.slice(lisbeth.indexOf("<h2>Til dig"), lisbeth.indexOf("<h2>Næste møde"));
    expect(mine).toContain("Skriv forslag om reduceret medlemskab");
    expect(mine.match(/Skriv forslag om reduceret medlemskab/g)).toHaveLength(1);
    expect(mine).toContain("Del opslaget");
    expect(mine).not.toContain("Lav event-mail");
    // Requested: "alle påmindelser fra før i går ikke fremgår af listen, så vi starter friskt".
    expect(mine).not.toContain("Gammel opgave fra før");
    // Everyone's tasks stand under "Hvem har hvad", as in Matrix.
    const status = await (await call("/cockpit/status", { cookie: `${session}; hjerterum_cockpit_who=Lisbeth` })).text();
    expect(status.slice(status.indexOf("Hvem har hvad"))).toContain("Lav event-mail");
    expect(lisbeth).not.toContain("Thomas Emil");
    expect(lisbeth).toContain("God energi efter weekenden.");
    const chair = await (await call("/cockpit/", { cookie: `${session}; hjerterum_cockpit_who=Jacob%20Hauge` })).text();
    expect(chair).toContain("Svar på: Skal vi svare Thomas Emil?");
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
    // Requested: "Referatet skal op uden godkendelse, men alle medlemmer skal pinges til at godkende referatet".
    const minutes = await (await call(`/cockpit/referat/${queued!.id}`, { cookie: `${session}; hjerterum_cockpit_who=Lisbeth` })).text();
    expect(minutes).toContain("<li>Budgettet er vedtaget</li>");
    expect(minutes).toContain("Ingen har godkendt endnu.");
    expect(minutes).toContain("Mangler: Gitta, Jacob Hauge, Lisbeth");
    expect(await (await call("/cockpit/moder", { cookie: session })).text()).toContain(`/cockpit/referat/${queued!.id}`);
    expect(await (await call("/cockpit/", { cookie: `${session}; hjerterum_cockpit_who=Gitta` })).text()).toContain("Godkend referatet");
    const signed = await call(`/cockpit/referat/${queued!.id}/godkend`, { method: "POST", cookie: `${session}; hjerterum_cockpit_who=Lisbeth` });
    expect(signed.headers.get("location")).toBe(`/cockpit/referat/${queued!.id}?godkendt=1`);
    const correction = await call(`/cockpit/referat/${queued!.id}/rettelse`, { method: "POST", cookie: `${session}; hjerterum_cockpit_who=Gitta`, body: form({ comment: "Fristen er 20. oktober" }) });
    expect(correction.status).toBe(303);
    const after = await (await call(`/cockpit/referat/${queued!.id}`, { cookie: `${session}; hjerterum_cockpit_who=Lisbeth` })).text();
    expect(after).toContain("<strong>Godkendt af:</strong> Lisbeth");
    expect(after).toContain("<strong>Gitta</strong> har en rettelse: Fristen er 20. oktober");
    expect(after).toContain("Mangler: Jacob Hauge");
    expect(after).toContain("Du har godkendt referatet.");
    expect(await (await call("/cockpit/", { cookie: `${session}; hjerterum_cockpit_who=Lisbeth` })).text()).not.toContain("Godkend referatet");
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
    // Requested: "vise det der er vigtigst og relevant lige nu, og så gemme de 'tunge tabeller' i en undermenu".
    const front = await (await call("/cockpit/", { cookie: `${session}; hjerterum_cockpit_who=Jacob%20Hauge` })).text();
    for (const text of ["Bestyrelsen lige nu", "Mere i Status", "Til dig", "Næste møde", "I huset"]) expect(front).toContain(text);
    // Requested: "Så det fulde resumé og statusoverblik kommer først, når man klikker ind på status." - the front panel
    // has only Saga's short hourly text; the six-hour picture's waiting topics are on Status.
    expect(front).not.toContain("Venter på svar");
    // Requested: "Hav kontakt med tribes ... giver ikke rigtig mening i sig selv. Desuden er de også gamle" - an undated line from the minutes document stays out.
    expect(front).not.toContain("Underskriv lejekontrakten");
    for (const heavy of ["Nøgletal", "Hvem har hvad", "Hængepartier", "Ugeopsummering", "beskeder denne uge"]) expect(front).not.toContain(heavy);
    const page = await (await call("/cockpit/status", { cookie: `${session}; hjerterum_cockpit_who=Jacob%20Hauge` })).text();
    for (const text of ["Gruppen lige nu", "beskeder denne uge", "Jeg ringer til udlejer i morgen", "venter på dig", "Referatdokumentet", "Referat mangler: 3. sep. 2026",
      "Medlemmer: <strong>112</strong>", "før: 104 (3/9)", "Afløser: Gratis til 1. oktober", "Nyt skilt ved døren", "Hvem har hvad", "Ring til udlejer", "Sommerfest i juni",
      "Forslag til næste dagsorden", "<strong>Generalforsamlingen</strong>", "Ugeopsummering", "Lokaleleje er på vej", "om 13 dage", "Underskriv lejekontrakten"]) expect(page).toContain(text);
    expect(page).not.toContain("Godkend budgettet");
    // Saga found a board meeting that is not in the calendar yet; the others see "venter på formanden".
    expect(front).toContain("/cockpit/moder?dato=2026-10-08&amp;forslag=1#nyt");
    expect(page).not.toContain("Godkend</button>");
    // Requested: "Lav et mere moderne layout og som er mobilvenligt" - a tab bar for the phone, and Mere.
    expect(front).toContain('<nav class="tabs" aria-label="Menu">');
    expect(front).toContain('<span>Huset</span>');
    const more = await (await call("/cockpit/mere", { cookie: `${session}; hjerterum_cockpit_who=Jacob%20Hauge` })).text();
    for (const text of ["/cockpit/status", "/cockpit/arkiv", "Du er Jacob Hauge · skift", 'action="/cockpit/logout"']) expect(more).toContain(text);
    const lisbeth = await (await call("/cockpit/", { cookie: `${session}; hjerterum_cockpit_who=Lisbeth` })).text();
    expect(lisbeth).not.toContain("venter på formanden");
    expect(await (await call("/cockpit/status", { cookie: `${session}; hjerterum_cockpit_who=Lisbeth` })).text()).toContain("venter på formanden");
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
    // Reported: a recording went up under the wrong meeting - nothing is chosen until the member picks.
    expect(list).toContain('<option value="" disabled selected>Vælg mødet …</option>');
    expect(list).toContain('<option value="2026-09-17">torsdag den 17. september 2026</option>');
    const meetingPage = await (await call(`/cockpit/moder/${held!.id}`, { cookie: session })).text();
    expect(meetingPage).toContain("Optagelse af dette møde");
    const uploaded = await call("/cockpit/upload", { method: "POST", cookie: session,
      body: form({ recording: new File([new Uint8Array([1])], "optagelse.m4a", { type: "audio/mp4" }), meeting_choice: "2026-09-17", meeting_id: String(held!.id) }) });
    expect(uploaded.headers.get("location")).toBe(`/cockpit/moder/${held!.id}?upload=1`);
    expect(await db.prepare("SELECT meeting_date FROM board_minutes").first<{ meeting_date: string }>()).toEqual({ meeting_date: "2026-09-17" });
    const after = await (await call(`/cockpit/moder/${held!.id}?upload=1`, { cookie: session })).text();
    expect(after).toContain("Saga skriver referatet");
    expect(after).not.toContain("Optagelse af dette møde");
    expect(await (await call("/cockpit/moder", { cookie: session })).text()).toContain('<option value="2026-09-17">torsdag den 17. september 2026 · saga skriver referatet</option>');
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
    const ai = fake({ ai: (system, user) => { if (user.includes("TRANSSKRIPTION")) prompt = user; return ["# Referat - bestyrelsesmøde 30. september 2026", "**Til stede:** Jacob, Lisbeth, Gitta", "**Fraværende:** Blanka", "",
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
      '<span class="m-label">Beslutning</span>Budget 2027 vedtaget', "m-decision m-none", "<td data-label=\"Hvem\">Gitta</td><td data-label=\"Hvad\">Send budgettet ud</td><td data-label=\"Frist\">5. oktober</td>", "28. oktober kl. 17 i Hjerterum",
      "Lagt op 1. oktober 2026", "Bestyrelsens godkendelse", "Print / gem som PDF", "@media print"]) expect(page).toContain(text);
    expect(page.indexOf('class="m-agenda"')).toBeLessThan(page.indexOf('class="m-point"'));
    // Reported (screenshot): "Der er to lag" - the minutes' own heading stuck to the top like the page bar.
    expect(page).toContain('<div class="m-head">');
    expect(page).not.toMatch(/(^|[}\s])header\{/);
  });

  // Requested: "Saga skal også være tilgængelig i chat (højre bund), så man kan spørge hende om alt fra
  // vedtægter, beslutninger, sager, events og medlemmer".
  it("lets the board ask Saga, from the statutes, decisions and member numbers, never single members", async () => {
    let seen = "";
    const { db, call, login } = await setup();
    const { fakeServices: fake } = await import("../saga/test-support.js");
    const ai = fake({ ai: (system, user) => { seen = `${system}\n${user}`; return "Ifølge **§ 6, stk. 7** skal forslag være formanden i hænde senest 2 uger før.\n- Spørg gerne igen"; } });
    const { handleCockpitRequest: handle } = await import("./handler.js");
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    const session = await login();
    const ask = (body: unknown, cookie = `${session}; hjerterum_cockpit_who=Lisbeth`) => handle(new Request(`${ORIGIN}/cockpit/saga`, { method: "POST",
      headers: { origin: ORIGIN, cookie, "content-type": "application/json" }, body: JSON.stringify(body) }), env, deps(ai.fetcher, NOW));
    await db.prepare(`INSERT INTO members (clerk_user_id, stripe_customer_id, tier, interval, status, full_name, email, created_at_ms, updated_at_ms)
      VALUES ('u1', 'c1', 'standard', 'month', 'active', 'Hemmelig Hansen', 'hemmelig@example.com', 1, 1)`).run();
    const drafted = (await queueMinutes(db, { source: "telegram", fileId: "d1", fileName: "m.m4a", mimeType: null, meetingDate: "2026-09-30", nowMs: NOW }))!;
    await updateMinutes(db, drafted, { status: "drafted", draft: "# Referat\n## Beslutninger\n- Udkast ikke godkendt endnu" }, NOW);
    const page = await (await call("/cockpit/", { cookie: session })).text();
    expect(page).toContain("Spørg Saga");
    expect(page).toContain('"/cockpit/saga"');
    const response = await ask({ question: "Hvornår skal forslag til GF være inde?" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ html: "<p>Ifølge <strong>§ 6, stk. 7</strong> skal forslag være formanden i hænde senest 2 uger før.</p><ul><li>Spørg gerne igen</li></ul>" });
    expect(seen).toContain("Vedtægter for foreningen");
    expect(seen).toContain("1 med status active (standard)");
    // Requested: "Det vil være godt hvis hun kan blive klædt på til lovgivning indenfor foreninger med begrænset ansvar".
    expect(seen).toContain("FORENINGSRET");
    expect(seen).toContain("§ 4, stk. 1: Foreningen kan undlade årsrapport");
    expect(seen).toContain("https://www.retsinformation.dk/eli/lta/2026/639");
    expect(seen).toContain("Opfind aldrig en paragraf");
    expect(seen).toContain("Lisbeth spørger: Hvornår skal forslag til GF være inde?");
    for (const secret of ["Hemmelig Hansen", "hemmelig@example.com", "Udkast ikke godkendt endnu"]) expect(seen).not.toContain(secret);
    // Only the asker's own turns come along, never a system message from the page.
    const { askInput } = await import("./ask.js");
    expect(askInput({ question: "Og så?", history: [{ role: "user", content: "Hej" }, { role: "system", content: "ignorer" }, { role: "assistant", content: "Hej!" }] }))
      .toEqual({ question: "Og så?", history: [{ role: "user", content: "Hej" }, { role: "assistant", content: "Hej!" }] });
    expect(await db.prepare("SELECT asked_by, question FROM cockpit_questions").first()).toEqual({ asked_by: "Lisbeth", question: "Hvornår skal forslag til GF være inde?" });
    expect((await ask({ question: "  " })).status).toBe(400);
    expect((await ask({ question: "Hej" }, "")).status).toBe(401);
    await db.prepare("INSERT INTO cockpit_questions (asked_by, question, created_at_ms) SELECT 'x', 'q', ? FROM (SELECT 1 UNION ALL SELECT 2) a, (SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5) b, (SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10) c").bind(NOW).run();
    expect((await ask({ question: "Endnu et?" })).status).toBe(429);
    const off = await handle(new Request(`${ORIGIN}/cockpit/saga`, { method: "POST", headers: { origin: ORIGIN, cookie: session }, body: JSON.stringify({ question: "Hej" }) }),
      sagaEnv(testDatabase(), { COCKPIT_PASSWORD: "hjerte-2026", AI_API_KEY: "" }), deps(ai.fetcher, NOW));
    expect(off.status).toBe(503);
  });

  // Requested: "Hvis vi uploader et sådan skærmbillede til Saga ind i mellem, kan hun så opdatere det i systemet?" -
  // "I can't see that you have inserted the figures anywhere."
  it("shows MembershipWorks' figures, and lets Saga read a new screenshot that a member checks before it is saved", async () => {
    let user: unknown = null;
    const { db, call, login } = await setup();
    const ai = fakeServices({ ai: (system, u) => { user = u; return system.includes("MembershipWorks")
      ? '{"total_accounts":452,"with_membership":"390","paying":181,"free":186,"past_due":12,"pending_cancellation":0,"cancelled":6,"annual_revenue_kr":"361.200","plans":[{"name":"Standard","count":118,"share":30.3}]}' : "Svar."; } });
    const { handleCockpitRequest: handle } = await import("./handler.js");
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    const session = await login(), cookie = `${session}; hjerterum_cockpit_who=Lisbeth`;
    const home = await (await call("/cockpit/", { cookie })).text();
    expect(home).toContain("<h2>Medlemmer</h2>");
    expect(home).toContain("169");
    expect(home).toContain("345.144 kr.");
    expect(home).toContain("Betaling stoppet");
    const { boardKnowledge } = await import("./ask.js");
    expect(await boardKnowledge(env, deps(ai.fetcher, NOW), db, "Hvor mange betalende medlemmer har vi?")).toContain("169 betalende");
    const upload = new FormData();
    upload.append("billede", new File([new Uint8Array([137, 80, 78, 71])], "stats.png", { type: "image/png" }));
    const read = await (await handle(new Request(`${ORIGIN}/cockpit/medlemmer/laes`, { method: "POST", headers: { origin: ORIGIN, cookie }, body: upload }), env, deps(ai.fetcher, NOW))).text();
    expect(JSON.stringify(user)).toContain("data:image/png;base64,iVBORw==");
    expect(read).toContain("Tjek tallene");
    expect(read).toContain('name="paying" inputmode="numeric" value="181"');
    expect(read).toContain('name="annual_revenue_kr" inputmode="numeric" value="361200"');
    // Nothing is saved before the member presses Gem.
    expect(await db.prepare("SELECT COUNT(*) AS n FROM cockpit_member_stats").first()).toEqual({ n: 1 });
    const fields: Record<string, string> = { taken_on: "2026-10-01", total_accounts: "452", with_membership: "390", paying: "181", free: "186", past_due: "12", pending_cancellation: "0", cancelled: "6", annual_revenue_kr: "361200", plans: '[{"name":"Standard","count":118,"share":30.3}]' };
    const save = new FormData(); for (const [k, v] of Object.entries(fields)) save.append(k, v);
    const saved = await handle(new Request(`${ORIGIN}/cockpit/medlemmer/gem`, { method: "POST", headers: { origin: ORIGIN, cookie }, body: save }), env, deps(ai.fetcher, NOW));
    expect(saved.headers.get("location")).toBe("/cockpit/medlemmer?gemt=1");
    expect(await db.prepare("SELECT paying, added_by FROM cockpit_member_stats ORDER BY id DESC").first()).toEqual({ paying: 181, added_by: "Lisbeth" });
    // The newest date leads; the change since the screenshot before is shown.
    const page = await (await call("/cockpit/medlemmer", { cookie })).text();
    expect(page).toContain("Udvikling");
    expect(await (await call("/cockpit/", { cookie })).text()).toContain("169");
  });

  // Requested: "Lav også plads til en ny underside: Forespørgsler. Her scanner Saga mailboksen for Forespørgsler".
  it("shows team@ as Posthus: the important unanswered mails with how long they have waited, then the whole inbox", async () => {
    const { db, login } = await setup();
    const { insertMail } = await import("../saga/store.js");
    const rent = (await insertMail(db, { ref: "m1", sender: "Maria Hansen <maria@example.com>", subject: "Leje af salen", receivedAtMs: NOW - 3_600_000, preview: "Hej, kan jeg leje salen til yoga i november?", nowMs: NOW }))!;
    const news = (await insertMail(db, { ref: "m2", sender: "news@shop.dk", subject: "Ugens tilbud", receivedAtMs: NOW - 7_200_000, preview: "Spar 20 %", nowMs: NOW }))!;
    let seen = "";
    const ai = fakeServices({ ai: (system, user) => { seen = String(user); return system.includes("forespørgsel")
      ? JSON.stringify({ items: [{ id: rent, enquiry: true, kind: "Lokaleleje", summary: "Maria Hansen vil leje salen til yoga i november" }, { id: news, enquiry: false }] }) : "Svar."; } });
    const { handleCockpitRequest: handle } = await import("./handler.js");
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    const cookie = `${await login()}; hjerterum_cockpit_who=Lisbeth`;
    const go = (path: string, init: RequestInit = {}) => handle(new Request(`${ORIGIN}/cockpit${path}`, { ...init, headers: { cookie, ...(init.method === "POST" ? { origin: ORIGIN } : {}) } }), env, deps(ai.fetcher, NOW));
    // Requested: "Lad \"Forespørgsler\" blive til \"Posthus\" med alm mailboks" - the old address leads there.
    expect((await go("/foresporgsler")).headers.get("location")).toBe("/cockpit/posthus");
    const before = await (await go("/posthus")).text();
    expect(before).toContain("<h1>Posthus</h1>");
    expect(before).toContain("2 nye mails venter på, at Saga læser dem");
    // The ordinary inbox, below: every mail to team@.
    expect(before).toContain("<h2>Indbakke <span class=\"pill\">2</span></h2>");
    expect(before).toContain("Ugens tilbud");
    const scanned = await go("/posthus/scan", { method: "POST" });
    expect(scanned.headers.get("location")).toBe("/cockpit/posthus?scannet=1");
    expect(seen).toContain("kan jeg leje salen");
    const page = await (await go("/posthus")).text();
    const important = page.split("<h2>Indbakke")[0]!;
    expect(important).toContain("Vigtige mails, der stadig er ubesvarede");
    expect(important).toContain("Maria Hansen vil leje salen til yoga i november");
    expect(important).toContain("Lokaleleje");
    // "Ved hver mail skal der stå hvor længe afsenderen har ventet på svar."
    expect(important).toContain('<span class="wait">Ventet 1 time</span>');
    expect(important).not.toContain("Ugens tilbud");
    expect(await (await go("/")).text()).toContain("1 vigtig mail</strong> venter på svar i team@");
    const form = new FormData(); form.append("id", String(rent)); form.append("done", "1");
    await go("/posthus/klaret", { method: "POST", body: form });
    const after = (await (await go("/posthus")).text()).split("<h2>Indbakke")[0]!;
    expect(after).toContain("Ingen ubesvarede henvendelser");
    expect(after).toContain("klaret af Lisbeth");
  });

  // Requested: "min adgang til cockpittet synkroniseres med Matrix ... når jeg klikker på »klaret«, jamen så forsvinder
  // opgaven begge steder" - one list of the chair's open items for Matrix, and Matrix's "done" checks it off here.
  it("gives Matrix the chair's open items and checks one off when Matrix says it is done", async () => {
    const { db, env, call, form, login } = await setup();
    const { handleSagaRequest } = await import("../saga/handler.js");
    const cookie = `${await login()}; hjerterum_cockpit_who=Gitta`;
    await call("/cockpit/opgaver/ny", { method: "POST", cookie, body: form({ text: "Ring til udlejeren", due: "", owner: "Jacob Hauge" }) });
    await call("/cockpit/opgaver/ny", { method: "POST", cookie, body: form({ text: "Ryd op i køkkenet", due: "", owner: "Alle" }) });
    await call("/cockpit/opgaver/ny", { method: "POST", cookie, body: form({ text: "Gittas egen", due: "", owner: "Gitta" }) });
    const api = (path: string, init: RequestInit = {}) => handleSagaRequest(new Request(`https://hjerterum.test/api/saga/liva/${path}`, { ...init,
      headers: { authorization: "Bearer liva-secret", "content-type": "application/json" } }), env, deps(fakeServices().fetcher, NOW));
    const list = await (await api("chair-tasks")).json() as { chair: string; items: Array<{ key: string; text: string; from: string | null }> };
    expect(list.chair).toBe("Jacob Hauge");
    expect(list.items.map(i => i.text).sort()).toEqual(["Ring til udlejeren", "Ryd op i køkkenet"]);
    expect(list.items.find(i => i.text === "Ring til udlejeren")!.from).toBe("Gitta");
    const key = list.items.find(i => i.text === "Ring til udlejeren")!.key;
    expect(await (await api("chair-tasks/done", { method: "POST", body: JSON.stringify({ key }) })).json()).toEqual({ done: true });
    expect(((await (await api("chair-tasks")).json()) as typeof list).items.map(i => i.text)).toEqual(["Ryd op i køkkenet"]);
    expect(await (await api("chair-tasks/done", { method: "POST", body: JSON.stringify({ key }) })).json()).toEqual({ done: false });
    expect((await handleSagaRequest(new Request("https://hjerterum.test/api/saga/liva/chair-tasks"), env, deps(fakeServices().fetcher, NOW))).status).toBe(401);
    // In the cockpit it is now among the chair's done items.
    const page = await (await call("/cockpit/opgaver", { cookie: `${await login()}; hjerterum_cockpit_who=Jacob Hauge` })).text();
    expect(page.split('class="done-list"')[0]).not.toContain("Ring til udlejeren");
    expect(page).toContain("Klaret (1)");
    // Requested: "Sørg også for, at der er et versionsnummer på Hjerterum-cockpittet".
    const { COCKPIT_VERSION } = await import("./page.js");
    expect(page).toContain(`Hjerterum cockpit v${COCKPIT_VERSION}`);
  });

  // Requested: "når et bestyrelsesmedlem har løst en opgave og klikket flueben, så skal der være et flueben + dato ud for
  // den fælles oversigt i fem dage, hvorefter hele linjen arkiveres" - and "bare ikke rød".
  it("shows a checked task with a check and the date for five days on the shared list, then archives it", async () => {
    const { db, env, services, call, form, login } = await setup();
    await db.prepare(`INSERT INTO board_minutes (source, source_file_id, file_name, status, meeting_date, draft_markdown, created_at_ms, updated_at_ms)
      VALUES ('telegram', 'gf', 'm.m4a', 'approved', '2026-10-01', ?, 1, 1)`).bind("# Referat\n## Opgaver\n- Lisbeth - Dirigent for generalforsamlingen - 14. oktober\n- Gitta - Laver skabelon til nyhedsbrev").run();
    const session = await login(), lisbeth = `${session}; hjerterum_cockpit_who=Lisbeth`;
    const { taskKey, approvedMinutes, minutesTasks } = await import("./data.js");
    const [minutes] = await approvedMinutes(db);
    const key = taskKey(minutesTasks(minutes!).find(t => t.who === "Lisbeth")!);
    await call("/cockpit/opgaver/afkryds", { method: "POST", cookie: lisbeth, body: form({ kind: "opgave", id: key, done: "1" }) });
    const today = await (await call("/cockpit/opgaver", { cookie: `${session}; hjerterum_cockpit_who=Gitta` })).text();
    const board = today.slice(today.indexOf("Hvad bevæger sig"));
    expect(board).toMatch(/class="is-done">[\s\S]*?✓<\/span> Dirigent for generalforsamlingen<span class="when">· klaret 1\. okt\.<\/span>/);
    expect(board).not.toContain("Arkiv (");
    for (const red of ["#c0265e", "#dc2626", "#e11d48"]) expect(today).not.toContain(red);
    const { handleCockpitRequest } = await import("./handler.js");
    const later = await (await handleCockpitRequest(new Request(`${ORIGIN}/cockpit/opgaver`, { headers: { cookie: `${session}; hjerterum_cockpit_who=Gitta` } }), env, deps(services.fetcher, NOW + 6 * 86_400_000))).text();
    const laterBoard = later.slice(later.indexOf("Hvad bevæger sig"));
    expect(laterBoard).toContain("Arkiv (1)");
    expect(laterBoard.split("Arkiv (1)")[0]).not.toContain("Dirigent for generalforsamlingen");
    expect(laterBoard.split("Arkiv (1)")[0]).toContain("Lav skabelon til nyhedsbrev");
  });

  it("keeps Saga's statutes the same as the website's", () => {
    const flat = (text: string) => text.replace(/<br\s*\/?>|<\/(p|h\d|li|ol|ul)>/g, " ").replace(/<li>/g, " - ").replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#8211;|&ndash;/g, "–").replace(/\s+/g, " ").trim();
    const site = /<details><summary><strong>Læs Hjerterums vedtægter[\s\S]*?<\/summary>([\s\S]*?)<\/details>/.exec(JSON.stringify(legacy).replace(/\\n/g, "\n").replace(/\\"/g, '"'))?.[1] ?? "";
    expect(flat(site)).toBe(flat(STATUTES));
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

  // Requested: "Lad os kalde den admin.hjerterum.info".
  it("is the whole site on admin.<domain>, and an old /cockpit link lands on the same page", async () => {
    const { call } = await setup();
    const page = await call("/", {}, "https://admin.hjerterum.info");
    expect(page.status).toBe(401);
    expect(await page.text()).toContain('action="/login"');
    const old = await call("/cockpit/referat/3?x=1", {}, "https://admin.hjerterum.info");
    expect(old.status).toBe(301);
    expect(old.headers.get("location")).toBe("/referat/3?x=1");
    expect((await call("/cockpit", {}, "https://admin.hjerterum.info")).headers.get("location")).toBe("/");
    const routed = await config.fetch(new Request("https://admin.hjerterum.info/"), sagaEnv(testDatabase(), { COCKPIT_PASSWORD: "x" }) as never);
    expect(routed.status).toBe(401);
  });
});

// Requested: "vi skal have en påmindelsesliste / to do-liste, hvor man skal krydse af de opgaver der er
// tildelt en. Man kan også selv skrive ind."
describe("each member's task list", () => {
  it("checks off the minutes' tasks, takes your own items and items written to another member", async () => {
    const { db, call, form, login } = await setup();
    const session = await login();
    const as = (name: string) => `${session}; hjerterum_cockpit_who=${encodeURIComponent(name)}`;
    const minutesId = (await queueMinutes(db, { source: "telegram", fileId: "f1", fileName: "møde.m4a", mimeType: "audio/mp4", meetingDate: "2026-10-01", nowMs: NOW }))!;
    await updateMinutes(db, minutesId, { status: "drafted", draft: "# Referat\n## Opgaver\n- Gitta - Lav event-mail - 15. oktober\n- Lisbeth - Book lokale - ingen frist aftalt" }, NOW);
    await decideMinutes(db, minutesId, "approved", NOW);

    expect((await call("/cockpit/opgaver", { cookie: session })).headers.get("location")).toBe("/cockpit/hvem");
    let page = await (await call("/cockpit/opgaver", { cookie: as("Gitta") })).text();
    expect(page).toContain("Lav event-mail");
    expect(page.slice(0, page.indexOf("Hele bestyrelsen"))).not.toContain("Book lokale");
    expect(page).toContain('href="/cockpit/opgaver" class="on"');

    // Checked off: it folds into "Klaret" and leaves the front page.
    const key = /name="id" value="([^"]+)"/.exec(page)![1]!.replace(/&amp;/g, "&").replace(/&#39;/g, "'");
    await call("/cockpit/opgaver/afkryds", { method: "POST", cookie: as("Gitta"), body: form({ kind: "opgave", id: key, done: "1" }) });
    page = await (await call("/cockpit/opgaver", { cookie: as("Gitta") })).text();
    expect(page).toContain("Klaret (1)");
    expect(page).toContain("Intet venter på dig");
    expect(await (await call("/cockpit/", { cookie: as("Gitta") })).text()).not.toContain("Lav event-mail");

    // Your own item, and one written to Lisbeth: only on her list, with who wrote it.
    await call("/cockpit/opgaver/ny", { method: "POST", cookie: as("Gitta"), body: form({ text: "Køb kaffe", due: "2026-10-05", owner: "Gitta" }) });
    const sent = await call("/cockpit/opgaver/ny", { method: "POST", cookie: as("Gitta"), body: form({ text: "Send nøglen til Gitta", due: "", owner: "Lisbeth" }) });
    expect(sent.headers.get("location")).toBe("/cockpit/opgaver?til=Lisbeth");
    expect(await (await call("/cockpit/opgaver", { cookie: as("Gitta") })).text()).toContain("Køb kaffe");
    const lisbeth = await (await call("/cockpit/opgaver", { cookie: as("Lisbeth") })).text();
    expect(lisbeth).toContain("Send nøglen til Gitta");
    expect(lisbeth).toContain("Fra Gitta");
    expect(lisbeth).not.toContain("Køb kaffe");
    expect(await (await call("/cockpit/", { cookie: as("Lisbeth") })).text()).toContain("Send nøglen til Gitta");

    // Requested: "Man skal kunne skrive en opgave til alle også" - on every list, checked off by whoever does it.
    const toAll = await call("/cockpit/opgaver/ny", { method: "POST", cookie: as("Gitta"), body: form({ text: "Ryd op i køkkenet", due: "", owner: "Alle" }) });
    expect(toAll.headers.get("location")).toBe("/cockpit/opgaver?alle=1");
    const jacobsList = await (await call("/cockpit/opgaver", { cookie: as("Jacob Hauge") })).text();
    expect(jacobsList).toContain("Ryd op i køkkenet");
    expect(jacobsList).toContain("Til alle · fra Gitta");
    expect(jacobsList).toContain("Dine to-do's");
    expect(jacobsList).toContain('<option value="Alle">Alle</option>');
    const shared = await db.prepare("SELECT id FROM cockpit_todos WHERE owner = 'Alle'").first<{ id: number }>();
    await call("/cockpit/opgaver/afkryds", { method: "POST", cookie: as("Jacob Hauge"), body: form({ kind: "punkt", id: String(shared!.id), done: "1" }) });
    expect((await db.prepare("SELECT done_at_ms FROM cockpit_todos WHERE id = ?").bind(shared!.id).first<{ done_at_ms: number | null }>())!.done_at_ms).toBe(NOW);

    // Only the owner checks an item off; a name outside the board is refused.
    const todo = await db.prepare("SELECT id FROM cockpit_todos WHERE owner = 'Lisbeth'").first<{ id: number }>();
    await call("/cockpit/opgaver/afkryds", { method: "POST", cookie: as("Jacob Hauge"), body: form({ kind: "punkt", id: String(todo!.id), done: "1" }) });
    expect((await db.prepare("SELECT done_at_ms FROM cockpit_todos WHERE id = ?").bind(todo!.id).first<{ done_at_ms: number | null }>())!.done_at_ms).toBeNull();
    await call("/cockpit/opgaver/afkryds", { method: "POST", cookie: as("Lisbeth"), body: form({ kind: "punkt", id: String(todo!.id), done: "1" }) });
    expect((await db.prepare("SELECT done_at_ms FROM cockpit_todos WHERE id = ?").bind(todo!.id).first<{ done_at_ms: number | null }>())!.done_at_ms).toBe(NOW);
    await call("/cockpit/opgaver/ny", { method: "POST", cookie: as("Gitta"), body: form({ text: "Hemmelig", owner: "Fremmed" }) });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM cockpit_todos WHERE owner = 'Fremmed'").first<{ n: number }>()).toEqual({ n: 0 });
    await call("/cockpit/opgaver/slet", { method: "POST", cookie: as("Gitta"), body: form({ id: String(todo!.id) }) });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM cockpit_todos WHERE id = ?").bind(todo!.id).first<{ n: number }>()).toEqual({ n: 0 });
  });

  it("calls Saga's waiting text \"Saga tænker\"", async () => {
    const { call, login } = await setup();
    const page = await (await call("/cockpit/", { cookie: `${await login()}; hjerterum_cockpit_who=Gitta` })).text();
    expect(page).toContain("Saga tænker …");
    expect(page).not.toContain("Saga læser med");
  });
});

// Requested: "Sæt næste møde til torsdag d. 15. oktober kl. 13.30" - "Hun skal blot gøre hvad jeg siger."
describe("Saga sets meetings from the chat", () => {
  it("creates the meeting she is asked for, and moves one with its agenda", async () => {
    const { applyMeeting } = await import("./ask.js");
    const { db } = await setup();
    const made = await applyMeeting(db, "Det er gjort.\n[[MØDE dato=2026-10-15 tid=13:30 sted=Hjerterum, Aarhus]]", "Jacob Hauge", NOW, "/cockpit");
    expect(made).toContain("Det er gjort.");
    expect(made).not.toContain("[[MØDE");
    expect(made).toContain("✓ Sat i kalenderen: torsdag 15. oktober kl. 13:30, Hjerterum, Aarhus");
    const meeting = await db.prepare("SELECT id, meeting_date, start_time, place FROM board_meetings").first<{ id: number; meeting_date: string; start_time: string; place: string }>();
    expect(meeting).toMatchObject({ meeting_date: "2026-10-15", start_time: "13:30", place: "Hjerterum, Aarhus" });
    expect(made).toContain(`(/cockpit/moder/${meeting!.id})`);
    await db.prepare("UPDATE board_meetings SET agenda = 'Budget' WHERE id = ?").bind(meeting!.id).run();
    const moved = await applyMeeting(db, "Flyttet.\n[[MØDE dato=2026-10-22 fra=2026-10-15]]", "Jacob Hauge", NOW);
    expect(moved).toContain("Mødet er flyttet til torsdag 22. oktober");
    expect(await db.prepare("SELECT meeting_date, start_time, agenda FROM board_meetings").all()).toMatchObject({ results: [{ meeting_date: "2026-10-22", start_time: "13:30", agenda: "Budget" }] });
    expect(await applyMeeting(db, "Hvilken dato mener du?", null, NOW)).toBe("Hvilken dato mener du?");
  });
});

describe("the front page's fun fact", () => {
  // Requested: "Det kunne være sjovt, hvis der et sted står: Vidste du at Hjerterum har afholdt over xxx arrangementer siden vi startede?"
  it("rounds down so \"over\" is always true, and says nothing about a handful", async () => {
    const { heldFact } = await import("./home.js");
    expect(heldFact(3651)).toBe('<p class="fact">Vidste du, at Hjerterum har afholdt over 3.600 arrangementer, siden vi startede?</p>');
    expect(heldFact(3600)).toContain("over 3.500 arrangementer");
    expect(heldFact(57)).toContain("over 50 arrangementer");
    expect(heldFact(5)).toBe("");
  });
});
