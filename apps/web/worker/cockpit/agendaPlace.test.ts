import { describe, expect, it } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { addTodo, DEFAULT_PLACE, meeting, saveMeeting } from "./data.js";
import { translateHtml } from "./i18n.js";
import { deps, fakeServices, sagaEnv, testDatabase, memberCookie, memberCookies } from "../saga/test-support.js";

// Requested (on a meeting's page): "Her bør Sagas forslag til dagsorden også kunne trigges." -
// "Default lokation: Hjerterum, Guldsmedgade 26B, 8000 Aarhus".
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-10-02T10:00:00Z");

describe("a meeting's agenda and place", () => {
  it("lets Saga suggest the agenda on demand - as points at the bottom, each with a cross - and defaults the place to Hjerterum", async () => {
    const db = testDatabase();
    let asked = "";
    const services = fakeServices({ ai: (system, user) => { asked = system + user; return '{"items":["Godkendelse af dagsorden","1. Generalforsamling 14. okt.: roller","Eventuelt"]}'; } });
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    const call = (path: string, init: RequestInit & { cookie?: string } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
      ...init, headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, NOW));
    const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
    const login = new FormData(); login.append("password", "hjerte-2026");
    const session = ((await call("/login", { method: "POST", body: login })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const cookie = await memberCookie(session, "Jacob Hauge");
    const id = await saveMeeting(db, { date: "2026-10-15", time: "13:30", place: "", agenda: "" }, "Jacob Hauge", NOW);
    expect((await meeting(db, id))?.place).toBe(DEFAULT_PLACE);

    const page = await (await call(`/moder/${id}`, { cookie })).text();
    expect(page).toContain("Bed Saga om forslag til dagsorden");
    expect(page).toContain(`value="${DEFAULT_PLACE}"`);
    expect(page).toContain("Ingen punkter endnu.");
    // Requested: "Der skal altså ikke være fri tekst": no text field for the whole agenda - one point at a time.
    expect(page).not.toContain('<textarea name="agenda"');
    expect(page).toContain(`<form class="addpoint" method="post" action="/moder/${id}/punkt"><input name="text" required maxlength="200"`);

    const suggested = await call(`/moder/${id}/forslag`, { method: "POST", cookie });
    expect(suggested.headers.get("location")).toBe(`/moder/${id}?forslag=3#dagsorden`);
    expect(asked).toContain("Opfind intet");
    expect(asked).toContain("2026-10-15");
    // Her points stand on the agenda at the bottom (the numbering is left out), marked as hers, each with a cross.
    expect((await meeting(db, id))?.agenda).toBe("Godkendelse af dagsorden\nGeneralforsamling 14. okt.: roller\nEventuelt");
    const withSaga = await (await call(`/moder/${id}?forslag=3`, { cookie })).text();
    expect(withSaga).toContain("Saga har lagt 3 punkter nederst på dagsordenen. Slet dem, du ikke vil have, med krydset.");
    expect(withSaga.match(/<span class="saga-mark">Sagas forslag<\/span>/g)).toHaveLength(3);
    expect(withSaga.match(/<form class="cross"/g)).toHaveLength(3);
    expect(withSaga).toContain(`<li><span class="t">Generalforsamling 14. okt.: roller</span><span class="saga-mark">Sagas forslag</span><form class="cross" method="post" action="/moder/${id}/punkt/slet"><input type="hidden" name="text" value="Generalforsamling 14. okt.: roller"><button aria-label="Fjern punktet: Generalforsamling 14. okt.: roller" title="Fjern punktet">×</button></form></li>`);

    // A cross deletes the point; a point of your own is one line - never running text - and stands without Saga's mark; the same point is not added twice.
    expect((await call(`/moder/${id}/punkt/slet`, { method: "POST", cookie, body: form({ text: "Eventuelt" }) })).headers.get("location")).toBe(`/moder/${id}#dagsorden`);
    await call(`/moder/${id}/punkt`, { method: "POST", cookie, body: form({ text: "  2.  Økonomi\n\nog budget for efteråret  " }) });
    await call(`/moder/${id}/punkt`, { method: "POST", cookie, body: form({ text: "økonomi og budget for efteråret" }) });
    await call(`/moder/${id}/punkt`, { method: "POST", cookie, body: form({ text: "x".repeat(500) }) });
    const row = await meeting(db, id);
    expect(row?.agenda.split("\n")).toEqual(["Godkendelse af dagsorden", "Generalforsamling 14. okt.: roller", "Økonomi og budget for efteråret", "x".repeat(200)]);
    expect(row?.agenda_saga).toBe("Godkendelse af dagsorden\nGeneralforsamling 14. okt.: roller");
    // Deleting a point that is not there changes nothing; the date, time and place are saved without touching the agenda.
    await call(`/moder/${id}/punkt/slet`, { method: "POST", cookie, body: form({ text: "Findes ikke" }) });
    await call(`/moder/${id}`, { method: "POST", cookie, body: form({ meeting_date: "2026-10-15", start_time: "14:00", place: "" }) });
    expect((await meeting(db, id))?.agenda.split("\n")).toHaveLength(4);
    expect((await meeting(db, id))?.start_time).toBe("14:00");
    expect((await call("/moder/999/punkt", { method: "POST", cookie, body: form({ text: "Spøgelse" }) })).status).toBe(404);
  });

  it("puts Saga's suggestion from the minutes document on the agenda as points, when the meeting is planned or later", async () => {
    const db = testDatabase();
    const { saveOverview } = await import("../saga/store.js");
    await saveOverview(db, "Resumé.", NOW, { docHash: "x", data: JSON.stringify({ summary: "Resumé.", temperature: { level: "god", why: "" }, topics: [], forJacob: [], forMembers: [],
      document: { latestMeeting: "", missingMinutes: [], dates: [], figures: [], openThreads: [], proposals: [], tasks: [], decisions: [], nextAgenda: ["Opfølgning på skiltet", "Lokaleleje"] } }) });
    const services = fakeServices({});
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    const call = (path: string, init: RequestInit & { cookie?: string } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
      ...init, headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, NOW));
    const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
    const login = new FormData(); login.append("password", "hjerte-2026");
    const session = ((await call("/login", { method: "POST", body: login })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const cookie = await memberCookie(session, "Jacob Hauge");
    // Planned with the tick box: her points are on the agenda from the start.
    const made = await call("/moder", { method: "POST", cookie, body: form({ meeting_date: "2026-10-20", start_time: "13:30", saga_forslag: "1" }) });
    const id = Number(/\/moder\/(\d+)/.exec(made.headers.get("location") ?? "")?.[1]);
    expect((await meeting(db, id))?.agenda).toBe("Opfølgning på skiltet\nLokaleleje");
    // Planned without it: an empty agenda, and a button on the meeting's page; pressed twice, nothing is added twice.
    const plain = Number(/\/moder\/(\d+)/.exec((await call("/moder", { method: "POST", cookie, body: form({ meeting_date: "2026-10-27" }) })).headers.get("location") ?? "")?.[1]);
    expect((await meeting(db, plain))?.agenda).toBe("");
    expect(await (await call(`/moder/${plain}`, { cookie })).text()).toContain("Tilføj Sagas forslag fra dokumentet (2 punkter)");
    expect((await call(`/moder/${plain}/forslag/dokument`, { method: "POST", cookie })).headers.get("location")).toBe(`/moder/${plain}?forslag=2#dagsorden`);
    expect((await call(`/moder/${plain}/forslag/dokument`, { method: "POST", cookie })).headers.get("location")).toBe(`/moder/${plain}?forslag=0#dagsorden`);
    expect((await meeting(db, plain))?.agenda).toBe("Opfølgning på skiltet\nLokaleleje");
    expect(await (await call(`/moder/${plain}?forslag=0`, { cookie })).text()).toContain("Saga fandt ikke noget nyt at foreslå ud fra materialet.");
  });

  // Requested: "Presets" - Jacob's five questions in Saga's chat, and "Hvad er mine to-do's?" answered for the one asking.
  it("offers the five presets and gives Saga the asker's own tasks", async () => {
    const db = testDatabase();
    let asked = "";
    const services = fakeServices({ ai: (system, user) => { asked = system + user; return "Du har én opgave."; } });
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    const call = (path: string, init: RequestInit & { cookie?: string } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
      ...init, headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.headers ?? {}) } }), env, deps(services.fetcher, NOW));
    const login = new FormData(); login.append("password", "hjerte-2026");
    const session = ((await call("/login", { method: "POST", body: login })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const cookie = await memberCookie(session, "Lisbeth");
    const page = await (await call("/", { cookie })).text();
    for (const preset of ["Hjælp mig med at opsætte event", "Hvad er mine to-do&#39;s?", "Hvilke beslutninger har vi truffet om medlemskab?", "Hvilke sager hænger lige nu?", "Hvilke arrangementer er der de næste to uger?"])
      expect(page).toContain(preset);
    await addTodo(db, { owner: "Lisbeth", text: "Bestil rengøring", due: null, createdBy: "Jacob Hauge" }, NOW);
    await addTodo(db, { owner: "Gitta", text: "Lav SoMe-opslag", due: null, createdBy: "Gitta" }, NOW);
    expect((await call("/saga", { method: "POST", cookie, headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "Hvad er mine to-do's?" }) })).status).toBe(200);
    expect(asked).toContain("LISBETHS ÅBNE OPGAVER");
    expect(asked).toContain("Bestil rengøring - på to-do-listen, skrevet af Jacob Hauge");
    expect(asked).not.toContain("Lav SoMe-opslag");
    expect(asked).toContain("/arrangementer");
  });

  it("has the agenda of points in English", () => {
    const en = translateHtml(`<p class="muted small">Ingen punkter endnu.</p><button aria-label="Fjern punktet: Økonomi" title="Fjern punktet">×</button><span class="saga-mark">Sagas forslag</span>
<input name="text" placeholder="Nyt punkt, fx Økonomi" aria-label="Nyt punkt"><button>Tilføj punkt</button><button class="ghost">Tilføj Sagas forslag fra dokumentet (2 punkter)</button>
<label><input type="checkbox"> Tag Sagas forslag med som punkter på dagsordenen (2)</label><p class="notice">Saga har lagt 3 punkter nederst på dagsordenen. Slet dem, du ikke vil have, med krydset.</p><h3>Dato, tid og sted</h3>`);
    expect(en).toContain("No points yet.");
    expect(en).toContain('aria-label="Remove the point: Økonomi" title="Remove the point"');
    expect(en).toContain('<span class="saga-mark">Saga&#39;s suggestion</span>'.replace("&#39;", "'"));
    expect(en).toContain('placeholder="New point, e.g. Finances" aria-label="New point"><button>Add point</button>');
    expect(en).toContain("Add Saga's suggestions from the document (2 points)");
    expect(en).toContain("Take Saga's suggestions along as points on the agenda (2)");
    expect(en).toContain("Saga has put 3 points at the bottom of the agenda. Delete the ones you do not want with the cross.");
    expect(en).toContain("<h3>Date, time and place</h3>");
  });
});
