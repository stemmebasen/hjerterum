import { describe, expect, it } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { addTodo, DEFAULT_PLACE, meeting, saveMeeting } from "./data.js";
import { scheduledAgendaSuggestion } from "./agenda.js";
import { translateHtml } from "./i18n.js";
import { deps, fakeServices, sagaEnv, testDatabase, memberCookie, memberCookies } from "../saga/test-support.js";

// Requested (on a meeting's page): "Her bør Sagas forslag til dagsorden også kunne trigges." -
// "Default lokation: Hjerterum, Guldsmedgade 26B, 8000 Aarhus".
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-10-02T10:00:00Z");

describe("a meeting's agenda and place", () => {
  // Requested: "Saga skal ikke foreslå noget til et møde, før hun ved, om det er et teammøde." and "Sagas forslag til næste teammøde skal fremgå, når man kommer ind på siden. Disse forslag skal genereres
  // én gang i døgnet. [Det skal være muligt at] fjerne dem uden brug af AI-kald."
  const setup = (ai: (system: string, user: string) => string, at = NOW) => {
    const db = testDatabase();
    const services = fakeServices({ ai });
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    const call = (path: string, init: RequestInit & { cookie?: string; now?: number } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
      ...init, headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, init.now ?? at));
    const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
    const login = async () => {
      const f = new FormData(); f.append("password", "hjerte-2026");
      return memberCookie(((await call("/login", { method: "POST", body: f })).headers.get("set-cookie") ?? "").split(";")[0]!, "Jacob Hauge");
    };
    return { db, env, services, call, form, login };
  };
  const overview = async (db: ReturnType<typeof testDatabase>, nextAgenda: string[]) => {
    const { saveOverview } = await import("../saga/store.js");
    await saveOverview(db, "Resumé.", NOW, { docHash: "x", data: JSON.stringify({ summary: "Resumé.", temperature: { level: "god", why: "" }, topics: [], forJacob: [], forMembers: [],
      document: { latestMeeting: "", missingMinutes: [], dates: [], figures: [], openThreads: [], proposals: [], tasks: [], decisions: [], nextAgenda } }) });
  };

  it("lets Saga suggest the agenda on demand - as points at the bottom, each with a cross - for a team meeting, and defaults the place to Hjerterum", async () => {
    let asked = "";
    const { db, call, form, login } = setup((system, user) => { asked = system + user; return '{"items":["Godkendelse af dagsorden","1. Generalforsamling 14. okt.: roller","Eventuelt"]}'; });
    const cookie = await login();
    const id = await saveMeeting(db, { date: "2026-10-15", time: "13:30", place: "", agenda: "", kind: "team" }, "Jacob Hauge", NOW);
    expect((await meeting(db, id))?.place).toBe(DEFAULT_PLACE);

    const page = await (await call(`/moder/${id}`, { cookie })).text();
    expect(page).toContain("Bed Saga om forslag til dagsorden");
    expect(page).toContain(`value="${DEFAULT_PLACE}"`);
    expect(page).toContain("Ingen punkter endnu.");
    expect(page).toContain('<span class="kind-tag team">Teammøde</span>');
    expect(page).not.toContain('id="slags"');
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
    // The overview of the meetings shows her points with the mark too.
    expect(await (await call("/moder", { cookie })).text()).toContain('<li>Generalforsamling 14. okt.: roller <span class="saga-mark inline">Sagas forslag</span></li>');

    // A cross deletes the point; a point of your own is one line - never running text - and stands without Saga's mark; the same point is not added twice.
    expect((await call(`/moder/${id}/punkt/slet`, { method: "POST", cookie, body: form({ text: "Eventuelt" }) })).headers.get("location")).toBe(`/moder/${id}#dagsorden`);
    await call(`/moder/${id}/punkt`, { method: "POST", cookie, body: form({ text: "  2.  Økonomi\n\nog budget for efteråret  " }) });
    await call(`/moder/${id}/punkt`, { method: "POST", cookie, body: form({ text: "økonomi og budget for efteråret" }) });
    await call(`/moder/${id}/punkt`, { method: "POST", cookie, body: form({ text: "x".repeat(500) }) });
    const row = await meeting(db, id);
    expect(row?.agenda.split("\n")).toEqual(["Godkendelse af dagsorden", "Generalforsamling 14. okt.: roller", "Økonomi og budget for efteråret", "x".repeat(200)]);
    expect(row?.agenda_saga).toBe("Godkendelse af dagsorden\nGeneralforsamling 14. okt.: roller");
    // Deleting a point that is not there changes nothing; the date, time and place are saved without touching the agenda or the kind.
    await call(`/moder/${id}/punkt/slet`, { method: "POST", cookie, body: form({ text: "Findes ikke" }) });
    await call(`/moder/${id}`, { method: "POST", cookie, body: form({ meeting_date: "2026-10-15", start_time: "14:00", place: "" }) });
    expect((await meeting(db, id))?.agenda.split("\n")).toHaveLength(4);
    expect((await meeting(db, id))?.start_time).toBe("14:00");
    expect((await meeting(db, id))?.kind).toBe("team");
    expect((await call("/moder/999/punkt", { method: "POST", cookie, body: form({ text: "Spøgelse" }) })).status).toBe(404);
  });

  it("makes no suggestion before Saga knows it is a team meeting - and asks which kind it is", async () => {
    let calls = 0;
    const { db, call, form, login } = setup(() => { calls++; return '{"items":["Punkt"]}'; });
    await overview(db, ["Opfølgning på skiltet"]);
    const cookie = await login();
    const unknown = await saveMeeting(db, { date: "2026-10-15", time: "", place: "", agenda: "" }, "Jacob Hauge", NOW);
    const other = await saveMeeting(db, { date: "2026-10-14", time: "", place: "", agenda: "", kind: "andet" }, "Jacob Hauge", NOW);

    const page = await (await call(`/moder/${unknown}`, { cookie })).text();
    expect(page).toContain('<div class="kind-ask" id="slags"><p><strong>Hvilken slags møde er det?</strong> Saga foreslår kun punkter til teammøder');
    expect(page).not.toContain("Bed Saga om forslag til dagsorden");
    expect(page).not.toContain("Tilføj Sagas forslag fra dokumentet");
    expect(await (await call(`/moder/${other}`, { cookie })).text()).not.toContain("Bed Saga om forslag til dagsorden");
    // Asked anyway (an old link, a script): refused, and the AI is not called.
    for (const id of [unknown, other]) for (const path of ["forslag", "forslag/dokument"])
      expect((await call(`/moder/${id}/${path}`, { method: "POST", cookie })).headers.get("location")).toBe(`/moder/${id}?forslag=ikketeam#dagsorden`);
    expect(calls).toBe(0);
    expect(await (await call(`/moder/${unknown}?forslag=ikketeam`, { cookie })).text()).toContain("Saga foreslår kun punkter til teammøder. Sig først, at det er et teammøde.");
    expect((await meeting(db, unknown))?.agenda).toBe("");
    // The overview of the meetings asks too.
    expect(await (await call("/moder", { cookie })).text()).toContain('<a href="/moder/' + unknown + '#slags">Sig, hvilken slags møde det er</a>');

    // Said to be a team meeting: it is the next one, so her suggestion from the minutes document is on the agenda at once (no AI); said to be another: nothing.
    expect((await call(`/moder/${other}/art`, { method: "POST", cookie, body: form({ kind: "andet" }) })).headers.get("location")).toBe(`/moder/${other}#dagsorden`);
    expect((await meeting(db, other))?.agenda).toBe("");
    await call(`/moder/${unknown}/art`, { method: "POST", cookie, body: form({ kind: "team" }) });
    expect((await meeting(db, unknown))?.kind).toBe("team");
    expect((await meeting(db, unknown))?.agenda).toBe("Opfølgning på skiltet");
    expect((await meeting(db, unknown))?.agenda_saga).toBe("Opfølgning på skiltet");
    expect(calls).toBe(0);
    await call(`/moder/${unknown}/art`, { method: "POST", cookie, body: form({ kind: "noget andet" }) });
    expect((await meeting(db, unknown))?.kind).toBe("team");
  });

  it("puts Saga's suggestion from the minutes document on the agenda when a team meeting is planned - and nothing for another kind", async () => {
    const { db, call, form, login } = setup(() => "{}");
    await overview(db, ["Opfølgning på skiltet", "Lokaleleje"]);
    const cookie = await login();
    const id = (async (kind: string, date: string) => Number(/\/moder\/(\d+)/.exec((await call("/moder", { method: "POST", cookie, body: form({ meeting_date: date, start_time: "13:30", kind }) })).headers.get("location") ?? "")?.[1]));
    const team = await id("team", "2026-10-20");
    expect((await meeting(db, team))?.agenda).toBe("Opfølgning på skiltet\nLokaleleje");
    expect((await meeting(db, team))?.kind).toBe("team");
    // Another team meeting, later than the next one: not seeded. A meeting of another kind: never.
    const later = await id("team", "2026-10-27"), other = await id("andet", "2026-10-18");
    expect((await meeting(db, later))?.agenda).toBe("");
    expect((await meeting(db, other))?.agenda).toBe("");
    expect((await meeting(db, other))?.kind).toBe("andet");
    // The button on the meeting's page: pressed twice, nothing is added twice.
    expect(await (await call(`/moder/${later}`, { cookie })).text()).toContain("Tilføj Sagas forslag fra dokumentet (2 punkter)");
    expect((await call(`/moder/${later}/forslag/dokument`, { method: "POST", cookie })).headers.get("location")).toBe(`/moder/${later}?forslag=2#dagsorden`);
    expect((await call(`/moder/${later}/forslag/dokument`, { method: "POST", cookie })).headers.get("location")).toBe(`/moder/${later}?forslag=0#dagsorden`);
    expect(await (await call(`/moder/${later}?forslag=0`, { cookie })).text()).toContain("Saga fandt ikke noget nyt at foreslå ud fra materialet.");
  });

  it("makes Saga's suggestions for the next team meeting once a day, from the morning on, and and a point deleted with the cross takes no AI call and may come again in a fresh suggestion", async () => {
    const MORNING = Date.parse("2026-10-08T06:30:00Z"); // 08:30 in Copenhagen
    let calls = 0, prompt = "";
    const { db, env, services, call, form, login } = setup((system, user) => { calls++; prompt = system + user; return '{"items":["Godkendelse af dagsorden","Julefest: valg af dato","Eventuelt"]}'; }, MORNING);
    await overview(db, ["Lokaleleje"]);
    const cookie = await login();
    const next = await saveMeeting(db, { date: "2026-10-15", time: "13:30", place: "", agenda: "", kind: "team" }, "Jacob Hauge", MORNING);
    const unknown = await saveMeeting(db, { date: "2026-10-12", time: "", place: "", agenda: "" }, "Jacob Hauge", MORNING);
    const claims = new Set<string>();
    const claim = async (key: string, slot: number) => { const id = `${key}:${slot}`; if (claims.has(id)) return false; claims.add(id); return true; };
    const run = (at: number) => scheduledAgendaSuggestion(env, deps(services.fetcher, at), db, claim);

    // Before five in the morning: not yet. Then once - for the next team meeting only, not for the one whose kind is unknown (it is earlier).
    expect(await run(Date.parse("2026-10-08T01:00:00Z"))).toBe(0);
    expect(await run(MORNING)).toBe(4);
    expect(calls).toBe(1);
    expect(prompt).toContain("teammødet 2026-10-15");
    expect((await meeting(db, next))?.agenda.split("\n")).toEqual(["Lokaleleje", "Godkendelse af dagsorden", "Julefest: valg af dato", "Eventuelt"]);
    expect((await meeting(db, unknown))?.agenda).toBe("");
    // The same day: nothing more, no AI call.
    expect(await run(MORNING + 3_600_000)).toBe(0);
    expect(calls).toBe(1);
    // They are there when you come in on the page - marked as hers - and the overview and the front page show them.
    expect(await (await call("/moder", { cookie, now: MORNING })).text()).toContain('<li>Julefest: valg af dato <span class="saga-mark inline">Sagas forslag</span></li>');

    // The board deletes one with the cross: no AI call - and tomorrow's suggestion may bring it back, with what is new: she makes a fresh one every day.
    const before = calls;
    await call(`/moder/${next}/punkt/slet`, { method: "POST", cookie, now: MORNING, body: form({ text: "Julefest: valg af dato" }) });
    expect(calls).toBe(before);
    expect((await meeting(db, next))?.agenda.split("\n")).toEqual(["Lokaleleje", "Godkendelse af dagsorden", "Eventuelt"]);
    expect((await meeting(db, next))?.agenda_saga).toBe("Lokaleleje\nGodkendelse af dagsorden\nEventuelt");
    const tomorrow = Date.parse("2026-10-09T06:30:00Z");
    expect(await run(tomorrow)).toBe(1);
    expect(calls).toBe(before + 1);
    expect((await meeting(db, next))?.agenda.split("\n")).toEqual(["Lokaleleje", "Godkendelse af dagsorden", "Eventuelt", "Julefest: valg af dato"]);
    // No AI set up, or no team meeting ahead: nothing happens.
    const idle = setup(() => "{}", MORNING);
    await saveMeeting(idle.db, { date: "2026-10-15", time: "", place: "", agenda: "" }, "Jacob Hauge", MORNING);
    expect(await scheduledAgendaSuggestion(idle.env, deps(idle.services.fetcher, MORNING), idle.db, claim)).toBe(0);
    expect(await scheduledAgendaSuggestion({ ...env, AI_API_KEY: "" }, deps(services.fetcher, MORNING + 2 * 86_400_000), db, claim)).toBe(0);
  });

  it("shows the next team meeting on the front page - Saga's points among them - and the next meeting of any kind in the box", async () => {
    const { db, call, login } = setup(() => "{}");
    const cookie = await login();
    const other = await saveMeeting(db, { date: "2026-10-14", time: "", place: "", agenda: "Valg af dirigent", kind: "andet" }, "Jacob Hauge", NOW);
    const team = await saveMeeting(db, { date: "2026-10-15", time: "13:30", place: "", agenda: "Julefest: valg af dato", kind: "team" }, "Jacob Hauge", NOW);
    const front = await (await call("/", { cookie })).text();
    const card = front.slice(front.indexOf("<h2>Næste teammøde</h2>"), front.indexOf("<h2>Næste teammøde</h2>") + 1500);
    expect(card).toContain("Julefest: valg af dato");
    expect(card).not.toContain("Valg af dirigent");
    expect(card).toContain(`href="/moder/${team}"`);
    expect(front).toContain(`<a class="tile" href="/moder/${other}"><span class="label">Næste møde</span>`);
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
    const kind = translateHtml(`<legend>Hvilken slags møde er det?</legend><label>Teammøde</label><label>Andet møde</label><p><strong>Hvilken slags møde er det?</strong> Saga foreslår kun punkter til teammøder - sig først, hvad det er.</p>
<button>Det er et teammøde</button><button>Det er et andet møde</button><a>Sig, hvilken slags møde det er</a> <span>(Saga foreslår kun punkter til teammøder)</span><p>Saga foreslår kun punkter til teammøder. Sig først, at det er et teammøde.</p>
<p>Saga laver selv forslag til næste teammøde hver morgen, og de står nederst som punkter. Slet dem, du ikke vil have, med krydset - det koster ingen AI.</p>`);
    expect(kind).toContain("<legend>What kind of meeting is it?</legend><label>Team meeting</label><label>Other meeting</label>");
    expect(kind).toContain("<button>It is a team meeting</button><button>It is another kind of meeting</button><a>Say which kind of meeting it is</a>");
    expect(kind).toContain("Saga only suggests points for team meetings. Say first that it is a team meeting.");
    expect(kind).toContain("Saga makes suggestions for the next team meeting herself every morning");
    expect(kind).not.toMatch(/møde|Saga foreslår|Slet dem/);
  });
});
