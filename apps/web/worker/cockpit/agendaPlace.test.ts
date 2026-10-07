import { describe, expect, it } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { addTodo, DEFAULT_PLACE, meeting, saveMeeting } from "./data.js";
import { agendaReadyText, englishAgenda, scheduledAgendaReminder, scheduledAgendaSuggestion } from "./agenda.js";
import { autoTranslated, translatePage, translations } from "./translate.js";
import { claimJob, recentBoardMessages } from "../saga/store.js";
import { BOARD } from "../saga/test-support.js";
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
    const { db, call, form, login, env, services } = setup((system, user) => { asked = system + user; return '{"items":["Godkendelse af dagsorden","1. Generalforsamling 14. okt.: roller","Eventuelt"]}'; });
    const cookie = await login();
    const id = await saveMeeting(db, { date: "2026-10-15", time: "13:30", place: "", agenda: "", kind: "team" }, "Jacob Hauge", NOW);
    expect((await meeting(db, id))?.place).toBe(DEFAULT_PLACE);

    const page = await (await call(`/moder/${id}`, { cookie })).text();
    expect(page).toContain("Bed Saga om forslag til dagsorden");
    expect(page).toContain(`value="${DEFAULT_PLACE}"`);
    expect(page).toContain("Ingen punkter endnu.");
    // Requested: "På denne side bør det fremgå tydeligt, at man er ved at redigere mødet.": a banner above the date, and the title says it too.
    expect(page).toContain('<p class="editing-banner"><svg');
    expect(page).toMatch(/<p class="editing-banner">[^]*Rediger møde<\/p><h1>torsdag den 15\. oktober 2026<\/h1>/);
    expect(page).toContain("<title>Rediger møde");
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
    expect(withSaga).toContain(`<li data-point="Generalforsamling 14. okt.: roller"><button type="button" class="grip" aria-label="Flyt punktet: Generalforsamling 14. okt.: roller"`);
    expect(withSaga).toMatch(/<span class="t">Generalforsamling 14\. okt\.: roller<\/span><span class="saga-mark">Sagas forslag<\/span><button type="button" class="pencil" data-edit aria-label="Ret punktet: Generalforsamling 14\. okt\.: roller" title="Ret punktet">/);
    expect(withSaga).toContain(`<form class="cross" method="post" action="/moder/${id}/punkt/slet"><input type="hidden" name="text" value="Generalforsamling 14. okt.: roller"><button aria-label="Fjern punktet: Generalforsamling 14. okt.: roller" title="Fjern punktet">×</button></form>`);
    // Requested: "en let måde at redigere et punkt på. Måske en lille blå blyant til venstre for krydset": the pencil stands before the cross and opens the point for editing in place.
    expect(withSaga.indexOf('class="pencil" data-edit aria-label="Ret punktet: Generalforsamling')).toBeLessThan(withSaga.indexOf('<form class="cross" method="post" action="/moder/' + id + '/punkt/slet"><input type="hidden" name="text" value="Generalforsamling'));
    expect(withSaga).toContain(`<form class="editpoint" method="post" action="/moder/${id}/punkt/ret"><input type="hidden" name="old" value="Generalforsamling 14. okt.: roller"><input name="text" value="Generalforsamling 14. okt.: roller" required maxlength="200"`);
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
    // The pencil: the new text takes the old one's place; a point of Saga's that a member rewrote is theirs now (no mark); empty text, a point that is not there and a duplicate change nothing.
    const edit = (old: string, text: string) => call(`/moder/${id}/punkt/ret`, { method: "POST", cookie, body: form({ old, text }) });
    expect((await edit("Generalforsamling 14. okt.: roller", "  Generalforsamling 14. okt.:\nroller og dirigent ")).headers.get("location")).toBe(`/moder/${id}#dagsorden`);
    expect((await meeting(db, id))?.agenda.split("\n")).toEqual(["Godkendelse af dagsorden", "Generalforsamling 14. okt.: roller og dirigent", "Økonomi og budget for efteråret", "x".repeat(200)]);
    expect((await meeting(db, id))?.agenda_saga).toBe("Godkendelse af dagsorden");
    await edit("Økonomi og budget for efteråret", "");
    await edit("Findes ikke", "Noget");
    await edit("Økonomi og budget for efteråret", "godkendelse af dagsorden");
    expect((await meeting(db, id))?.agenda.split("\n")).toEqual(["Godkendelse af dagsorden", "Generalforsamling 14. okt.: roller og dirigent", "Økonomi og budget for efteråret", "x".repeat(200)]);
    await edit("Økonomi og budget for efteråret", "Økonomi, budget og husleje");
    expect((await meeting(db, id))?.agenda.split("\n")[2]).toBe("Økonomi, budget og husleje");
    // Requested: "flytte punkterne op og ned. Helst drag and drop": each point has a grip (with two points or more), the list says where to send the new order, and the order is saved - the points
    // that were not given keep their old order after the given ones, and an unknown point is ignored.
    const moved = await (await call(`/moder/${id}`, { cookie })).text();
    expect(moved).toContain(`<ol class="agenda points" data-order="/moder/${id}/punkt/raekkefolge">`);
    expect(moved.match(/<button type="button" class="grip"/g)).toHaveLength(4);
    expect(moved).toContain('<li data-point="Godkendelse af dagsorden"><button type="button" class="grip" aria-label="Flyt punktet: Godkendelse af dagsorden"');
    const reorder = (points: string[], headers: Record<string, string> = {}) => handleCockpitRequest(new Request(`${ORIGIN}/moder/${id}/punkt/raekkefolge`, { method: "POST", headers: { origin: ORIGIN, cookie, ...headers },
      body: (() => { const f = new FormData(); for (const p of points) f.append("p", p); return f; })() }), env, deps(services.fetcher, NOW));
    // The scripts of the page run: each is valid JavaScript (a "\\n" lost in a template once made the whole drag-and-drop script a syntax error, which only a browser showed).
    const scripts = [...moved.matchAll(/<script>([^]*?)<\/script>/g)].map(m => m[1]!);
    expect(scripts.length).toBeGreaterThan(1);
    for (const code of scripts) expect(() => new Function(code), code.slice(0, 80)).not.toThrow();
    const dropped = await reorder(["Økonomi, budget og husleje", "Godkendelse af dagsorden"], { "x-requested-with": "fetch" });
    expect(dropped.status).toBe(204);
    expect((await meeting(db, id))?.agenda.split("\n")).toEqual(["Økonomi, budget og husleje", "Godkendelse af dagsorden", "Generalforsamling 14. okt.: roller og dirigent", "x".repeat(200)]);
    expect((await meeting(db, id))?.agenda_saga).toBe("Godkendelse af dagsorden");
    expect((await reorder(["Findes ikke", "x".repeat(200), "Godkendelse af dagsorden"])).headers.get("location")).toBe(`/moder/${id}#dagsorden`);
    expect((await meeting(db, id))?.agenda.split("\n")).toEqual(["x".repeat(200), "Godkendelse af dagsorden", "Økonomi, budget og husleje", "Generalforsamling 14. okt.: roller og dirigent"]);
    expect((await reorder([])).status).toBe(303);
    expect((await meeting(db, id))?.agenda.split("\n")).toHaveLength(4);
    expect((await handleCockpitRequest(new Request(`${ORIGIN}/moder/999/punkt/raekkefolge`, { method: "POST", headers: { origin: ORIGIN, cookie }, body: new FormData() }), env, deps(services.fetcher, NOW))).status).toBe(404);
    // Deleting a point that is not there changes nothing; the date, time and place are saved without touching the agenda or the kind.
    await call(`/moder/${id}/punkt/slet`, { method: "POST", cookie, body: form({ text: "Findes ikke" }) });
    await call(`/moder/${id}`, { method: "POST", cookie, body: form({ meeting_date: "2026-10-15", start_time: "14:00", place: "" }) });
    expect((await meeting(db, id))?.agenda.split("\n")).toHaveLength(4);
    expect((await meeting(db, id))?.start_time).toBe("14:00");
    expect((await meeting(db, id))?.kind).toBe("team");
    expect((await call("/moder/999/punkt", { method: "POST", cookie, body: form({ text: "Spøgelse" }) })).status).toBe(404);
  });

  it("makes no suggestion until the meeting is ticked as a team meeting - one \"Rediger møde\", one tick box", async () => {
    let calls = 0;
    const { db, call, form, login } = setup(() => { calls++; return '{"items":["Punkt"]}'; });
    await overview(db, ["Opfølgning på skiltet"]);
    const cookie = await login();
    const plain = await saveMeeting(db, { date: "2026-10-15", time: "", place: "", agenda: "" }, "Jacob Hauge", NOW);
    const other = await saveMeeting(db, { date: "2026-10-14", time: "", place: "", agenda: "", kind: "andet" }, "Jacob Hauge", NOW);

    // The overview has one button, "Rediger møde" - not a row of small links - and says nothing about kinds.
    const overviewPage = await (await call("/moder", { cookie })).text();
    expect(overviewPage).toContain(`<a class="button ghost" href="/moder/${plain}">Rediger møde</a>`);
    expect(overviewPage).not.toContain("Sig, hvilken slags møde det er");
    expect(overviewPage).not.toContain("Ret dagsorden");
    expect(overviewPage).not.toContain("Andet møde");
    // The meeting's page: the box "Teammøde" among date, time and place - unticked - and nothing from Saga.
    const page = await (await call(`/moder/${plain}`, { cookie })).text();
    expect(page).toContain('<label class="pick"><input type="checkbox" name="kind" value="team"> Teammøde</label><input type="hidden" name="kind_sent" value="1">');
    expect(page).not.toContain('class="kind-ask"');
    expect(page).not.toContain("Bed Saga om forslag til dagsorden");
    expect(page).not.toContain("Tilføj Sagas forslag fra dokumentet");
    expect(await (await call(`/moder/${other}`, { cookie })).text()).not.toContain("Bed Saga om forslag til dagsorden");
    // Asked anyway (an old link, a script): refused, and the AI is not called.
    for (const id of [plain, other]) for (const path of ["forslag", "forslag/dokument"])
      expect((await call(`/moder/${id}/${path}`, { method: "POST", cookie })).headers.get("location")).toBe(`/moder/${id}?forslag=ikketeam#dagsorden`);
    expect(calls).toBe(0);
    expect(await (await call(`/moder/${plain}?forslag=ikketeam`, { cookie })).text()).toContain("Saga foreslår kun punkter til teammøder. Sæt kryd ved Teammøde under Dato, tid og sted, og tryk Gem.");
    expect((await meeting(db, plain))?.agenda).toBe("");

    // Ticked and saved: it is the next team meeting, so her suggestion from the minutes document is on the agenda at once (no AI) and her buttons are there.
    await call(`/moder/${plain}`, { method: "POST", cookie, body: form({ meeting_date: "2026-10-15", start_time: "13:30", place: "", kind: "team", kind_sent: "1" }) });
    expect((await meeting(db, plain))?.kind).toBe("team");
    expect((await meeting(db, plain))?.agenda).toBe("Opfølgning på skiltet");
    expect((await meeting(db, plain))?.agenda_saga).toBe("Opfølgning på skiltet");
    expect(calls).toBe(0);
    const ticked = await (await call(`/moder/${plain}`, { cookie })).text();
    expect(ticked).toContain('<input type="checkbox" name="kind" value="team" checked> Teammøde');
    expect(ticked).toContain("Bed Saga om forslag til dagsorden");
    expect(await (await call("/moder", { cookie })).text()).toContain('<span class="kind-tag team">Teammøde</span>');
    // Saving again with the box ticked does not add her points twice; a form without the box (an old link, a script) leaves the kind alone; unticked, it is not a team meeting.
    await call(`/moder/${plain}`, { method: "POST", cookie, body: form({ meeting_date: "2026-10-15", kind: "team", kind_sent: "1" }) });
    expect((await meeting(db, plain))?.agenda).toBe("Opfølgning på skiltet");
    await call(`/moder/${plain}`, { method: "POST", cookie, body: form({ meeting_date: "2026-10-15", start_time: "14:00" }) });
    expect((await meeting(db, plain))?.kind).toBe("team");
    await call(`/moder/${plain}`, { method: "POST", cookie, body: form({ meeting_date: "2026-10-15", kind_sent: "1" }) });
    expect((await meeting(db, plain))?.kind).toBe("andet");
    expect((await call(`/moder/${plain}/forslag`, { method: "POST", cookie })).headers.get("location")).toBe(`/moder/${plain}?forslag=ikketeam#dagsorden`);
    expect((await meeting(db, plain))?.agenda).toBe("Opfølgning på skiltet");
    expect(calls).toBe(0);
  });

  it("puts Saga's suggestion from the minutes document on the agenda when a team meeting is planned - and nothing for another kind", async () => {
    const { db, call, form, login } = setup(() => "{}");
    await overview(db, ["Opfølgning på skiltet", "Lokaleleje"]);
    const cookie = await login();
    const id = (async (kind: string, date: string) => Number(/\/moder\/(\d+)/.exec((await call("/moder", { method: "POST", cookie, body: form({ meeting_date: date, start_time: "13:30", kind, kind_sent: "1" }) })).headers.get("location") ?? "")?.[1]));
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
    // Her points are made in English with the Danish ones: that is a translation request, not a suggestion - it is told apart and counted on its own.
    let translated = 0;
    const { db, env, services, call, form, login } = setup((system, user) => {
      if (system.startsWith("You translate texts")) { translated++; return JSON.stringify({ texts: (JSON.parse(user) as { texts: string[] }).texts.map(t => `EN: ${t}`) }); }
      calls++; prompt = system + user; return '{"items":["Godkendelse af dagsorden","Julefest: valg af dato","Eventuelt"]}'; }, MORNING);
    await overview(db, ["Lokaleleje"]);
    const cookie = await login();
    const next = await saveMeeting(db, { date: "2026-10-15", time: "13:30", place: "", agenda: "", kind: "team" }, "Jacob Hauge", MORNING);
    const unknown = await saveMeeting(db, { date: "2026-10-12", time: "", place: "", agenda: "" }, "Jacob Hauge", MORNING);
    const claims = new Set<string>();
    const claim = async (key: string, slot: number) => { const id = `${key}:${slot}`; if (claims.has(id)) return false; claims.add(id); return true; };
    const run = (at: number) => scheduledAgendaSuggestion(env, deps(services.fetcher, at), db, claim);

    // Before five in the morning: not yet. Then once - for the next team meeting only, not for the one whose kind is unknown (it is earlier).
    expect(await run(Date.parse("2026-10-08T01:00:00Z"))).toBe(0);
    expect(await run(MORNING)).toBe(3);
    expect(calls).toBe(1);
    expect(prompt).toContain("teammødet 2026-10-15");
    // Requested: "Hun bør prioritere de fem vigtigste.": she is told how many places she has, and she sees the document's points to choose among.
    expect(prompt).toContain("Du har kun plads til 5 punkter, så vælg de 5 vigtigste");
    expect(prompt).toContain("Referatets forslag til næste dagsorden (vælg blandt dem og resten af materialet, ikke alle): Lokaleleje");
    expect((await meeting(db, next))?.agenda.split("\n")).toEqual(["Godkendelse af dagsorden", "Julefest: valg af dato", "Eventuelt"]);
    expect((await meeting(db, unknown))?.agenda).toBe("");
    // Requested: "Saga should come with suggestions in either Danish AND English depending on what language was picked": the English was made with the Danish points, in one request.
    expect(translated).toBe(1);
    expect([...(await translations(db, ["Julefest: valg af dato", "Godkendelse af dagsorden"])).values()].sort()).toEqual(["EN: Godkendelse af dagsorden", "EN: Julefest: valg af dato"]);
    // A member who reads in English gets the meetings and a meeting's page translated, with Saga's points in English; one who reads Danish gets the Danish.
    expect([autoTranslated("/moder"), autoTranslated(`/moder/${next}`), autoTranslated(`/moder/${next}/punkt`), autoTranslated("/moder/ny")]).toEqual([true, true, false, false]);
    const danish = await (await call("/moder", { cookie, now: MORNING })).text();
    expect(danish).toContain("Julefest: valg af dato");
    const english = await translatePage(env, deps(services.fetcher, MORNING), db, danish);
    expect(english).toContain("EN: Julefest: valg af dato");
    expect(english).not.toContain(">Julefest: valg af dato<");
    expect(english).toContain("Saga&#39;s suggestion".replace("&#39;", "'"));
    const afterPage = translated;
    // The same day: nothing more, no AI call - and nothing more to translate.
    expect(await run(MORNING + 3_600_000)).toBe(0);
    expect(calls).toBe(1);
    expect(translated).toBe(afterPage);
    // They are there when you come in on the page - marked as hers - and the overview and the front page show them.
    expect(await (await call("/moder", { cookie, now: MORNING })).text()).toContain('<li>Julefest: valg af dato <span class="saga-mark inline">Sagas forslag</span></li>');

    // The board deletes one with the cross: no AI call - and tomorrow's suggestion may bring it back, with what is new: she makes a fresh one every day.
    const before = calls;
    await call(`/moder/${next}/punkt/slet`, { method: "POST", cookie, now: MORNING, body: form({ text: "Julefest: valg af dato" }) });
    expect(calls).toBe(before);
    expect((await meeting(db, next))?.agenda.split("\n")).toEqual(["Godkendelse af dagsorden", "Eventuelt"]);
    expect((await meeting(db, next))?.agenda_saga).toBe("Godkendelse af dagsorden\nEventuelt");
    const tomorrow = Date.parse("2026-10-09T06:30:00Z");
    expect(await run(tomorrow)).toBe(1);
    expect(calls).toBe(before + 1);
    expect(prompt).toContain("Du har kun plads til 3 punkter, så vælg de 3 vigtigste");
    expect((await meeting(db, next))?.agenda.split("\n")).toEqual(["Godkendelse af dagsorden", "Eventuelt", "Julefest: valg af dato"]);
    // No AI set up, or no team meeting ahead: nothing happens.
    const idle = setup(() => "{}", MORNING);
    await saveMeeting(idle.db, { date: "2026-10-15", time: "", place: "", agenda: "" }, "Jacob Hauge", MORNING);
    expect(await scheduledAgendaSuggestion(idle.env, deps(idle.services.fetcher, MORNING), idle.db, claim)).toBe(0);
    expect(await scheduledAgendaSuggestion({ ...env, AI_API_KEY: "" }, deps(services.fetcher, MORNING + 2 * 86_400_000), db, claim)).toBe(0);
  });

  // Requested: "det er alt for voldsomt med så mange forslag. Hun bør prioritere de fem vigtigste."
  it("keeps Saga to five points at a time - the document's first five, a refusal to ask for more, and a place freed by the cross", async () => {
    let calls = 0, prompt = "";
    const MORNING = Date.parse("2026-10-08T06:30:00Z");
    const eight = Array.from({ length: 8 }, (_, i) => `Punkt ${i + 1}`);
    const { db, env, services, call, form, login } = setup((system, user) => {
      if (system.startsWith("You translate texts")) return JSON.stringify({ texts: (JSON.parse(user) as { texts: string[] }).texts.map(t => `EN: ${t}`) });
      calls++; prompt = system + user; return '{"items":["Ny A","Ny B","Ny C"]}'; }, MORNING);
    await overview(db, eight);
    const cookie = await login();
    const planned = await call("/moder", { method: "POST", cookie, now: MORNING, body: form({ meeting_date: "2026-10-15", start_time: "13:30", kind: "team", kind_sent: "1" }) });
    const id = Number(/\/moder\/(\d+)/.exec(planned.headers.get("location") ?? "")?.[1]);
    // Eight in the document, five on the agenda - and no button for the three left, since she has no room.
    expect((await meeting(db, id))?.agenda.split("\n")).toEqual(eight.slice(0, 5));
    expect((await meeting(db, id))?.agenda_saga?.split("\n")).toHaveLength(5);
    const page = await (await call(`/moder/${id}`, { cookie, now: MORNING })).text();
    expect(page).not.toContain("Tilføj Sagas forslag fra dokumentet");
    // The button and her morning round both stand down: five of hers are there, so no AI call is made.
    expect((await call(`/moder/${id}/forslag`, { method: "POST", cookie, now: MORNING })).headers.get("location")).toBe(`/moder/${id}?forslag=fuld#dagsorden`);
    expect((await call(`/moder/${id}/forslag/dokument`, { method: "POST", cookie, now: MORNING })).headers.get("location")).toBe(`/moder/${id}?forslag=0#dagsorden`);
    expect(await (await call(`/moder/${id}?forslag=fuld`, { cookie, now: MORNING })).text()).toContain("Saga har allerede fem forslag på dagsordenen - flere ad gangen er for mange. Slet et med krydset, så finder hun et nyt.");
    const claim = async () => true;
    expect(await scheduledAgendaSuggestion(env, deps(services.fetcher, MORNING), db, claim)).toBe(0);
    expect(calls).toBe(0);
    // A point of the board's own does not count against her five; one deleted with the cross frees a place - and she is asked for exactly one.
    await call(`/moder/${id}/punkt`, { method: "POST", cookie, now: MORNING, body: form({ text: "Lisbeths punkt" }) });
    expect(await scheduledAgendaSuggestion(env, deps(services.fetcher, MORNING + 1000), db, claim)).toBe(0);
    expect(calls).toBe(0);
    await call(`/moder/${id}/punkt/slet`, { method: "POST", cookie, now: MORNING, body: form({ text: "Punkt 2" }) });
    expect(await scheduledAgendaSuggestion(env, deps(services.fetcher, MORNING + 2000), db, claim)).toBe(1);
    expect(calls).toBe(1);
    expect(prompt).toContain("Du har kun plads til 1 punkt, så vælg de vigtigste");
    expect((await meeting(db, id))?.agenda.split("\n")).toEqual(["Punkt 1", "Punkt 3", "Punkt 4", "Punkt 5", "Lisbeths punkt", "Ny A"]);
    expect((await meeting(db, id))?.agenda_saga?.split("\n")).toEqual(["Punkt 1", "Punkt 3", "Punkt 4", "Punkt 5", "Ny A"]);
  });

  it("falls back on the document's first points when Saga's AI cannot answer - still no more than five", async () => {
    const MORNING = Date.parse("2026-10-08T06:30:00Z");
    const { db, env, services, form, login, call } = setup(() => "ikke json", MORNING);
    await overview(db, Array.from({ length: 8 }, (_, i) => `Punkt ${i + 1}`));
    const cookie = await login();
    // Planned as an ordinary meeting first, ticked as a team meeting later (nothing was seeded), then the morning round with a broken AI.
    const planned = await call("/moder", { method: "POST", cookie, now: MORNING, body: form({ meeting_date: "2026-10-15", kind: "andet", kind_sent: "1" }) });
    const id = Number(/\/moder\/(\d+)/.exec(planned.headers.get("location") ?? "")?.[1]);
    await db.prepare("UPDATE board_meetings SET kind = 'team' WHERE id = ?").bind(id).run();
    expect(await scheduledAgendaSuggestion(env, deps(services.fetcher, MORNING), db, async () => true)).toBe(5);
    expect((await meeting(db, id))?.agenda.split("\n")).toEqual(["Punkt 1", "Punkt 2", "Punkt 3", "Punkt 4", "Punkt 5"]);
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

  // Requested: "Om morgenen for teammødet skal Saga sende en besked til gruppen om, at dagsordenen er klar, og at vi ses klokken xx. Og det ville være fint, hvis hun kan sende et direkte link til dagsordenen."
  it("writes to the group on the morning of a team meeting - the agenda is ready, the time and a direct link - once, and only when it should", async () => {
    const MORNING = Date.parse("2026-10-15T06:30:00Z"); // 08:30 in Copenhagen, the day of the meeting
    const mk = async (extra: Record<string, unknown> = {}, meetingFields: Partial<{ date: string; time: string; agenda: string; kind: "team" | "andet" }> = {}) => {
      const db = testDatabase();
      const services = fakeServices({});
      const env = sagaEnv(db, { COCKPIT_URL: "https://admin.hjerterum.info", ...extra });
      const id = await saveMeeting(db, { date: "2026-10-15", time: "13:30", place: "", agenda: "Julefest: valg af dato\nLokaleleje", kind: "team", ...meetingFields }, "Jacob Hauge", NOW);
      const run = (at = MORNING, fetcher: typeof fetch = services.fetcher) => scheduledAgendaReminder(env, deps(fetcher, at), db, (key, slot) => claimJob(db, key, slot, at));
      return { db, services, env, id, run };
    };
    const { db, services, id, run, env } = await mk();
    // Before eight: not yet.
    expect(await run(Date.parse("2026-10-15T05:30:00Z"))).toBe(false);
    expect(services.telegram("sendMessage")).toHaveLength(0);
    // From eight: one message to the board's group - agenda ready, how many points, the time and place, and the link straight to the agenda. Nothing from the AI.
    expect(await run()).toBe(true);
    const sent = services.telegram("sendMessage");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ chat_id: BOARD });
    const text = String((sent[0]!.body as { text: string }).text);
    expect(text).toBe(`God morgen 🙂 Dagsordenen til dagens teammøde er klar (2 punkter), og vi ses kl. 13:30 - ${DEFAULT_PLACE}.\n\n1. Julefest: valg af dato\n2. Lokaleleje\n\nSe dagsordenen her: https://admin.hjerterum.info/moder/${id}#dagsorden`);
    expect(text).toBe(agendaReadyText(env, (await meeting(db, id))!));
    expect(services.calls.some(c => c.url.includes("chat/completions"))).toBe(false);
    expect((await recentBoardMessages(db, BOARD, 0)).some(m => m.from_assistant && m.text === text)).toBe(true);
    // Once: not again, however often her round runs - and not after the meeting has begun.
    expect(await run(MORNING + 3_600_000)).toBe(false);
    expect(services.telegram("sendMessage")).toHaveLength(1);

    // Only a team meeting, today, with points on the agenda, before it begins (12:00 when it has no time), and when she may write in the group.
    for (const [name, make, at] of [
      ["a meeting that is not a team meeting", { kind: "andet" as const }, MORNING], ["a meeting whose kind is not said", { kind: undefined }, MORNING], ["an empty agenda", { agenda: "" }, MORNING],
      ["another day", { date: "2026-10-16" }, MORNING], ["after it has begun", {}, Date.parse("2026-10-15T11:45:00Z")], ["no time, after twelve", { time: "" }, Date.parse("2026-10-15T10:30:00Z")]] as const) {
      const t = await mk({}, make as never);
      expect(await t.run(at), name).toBe(false);
      expect(t.services.telegram("sendMessage"), name).toHaveLength(0);
    }
    const listening = await mk({ SAGA_BOARD_POSTING: "" });
    expect(await listening.run()).toBe(false);
    expect(listening.services.telegram("sendMessage")).toHaveLength(0);
    // No time on the meeting: "i dag". No address of the admin: no link, but the message still goes.
    const plain = await mk({ COCKPIT_URL: "" }, { time: "" });
    expect(await plain.run()).toBe(true);
    expect(String((plain.services.telegram("sendMessage")[0]!.body as { text: string }).text)).toBe(`God morgen 🙂 Dagsordenen til dagens teammøde er klar (2 punkter), og vi ses i dag - ${DEFAULT_PLACE}.\n\n1. Julefest: valg af dato\n2. Lokaleleje`);
    // Leader and moderator are in it when they are chosen; a long agenda is cut after twelve points.
    const roles = await mk({}, { agenda: Array.from({ length: 14 }, (_, i) => `Punkt ${i + 1}`).join("\n") });
    await roles.db.prepare("UPDATE board_meetings SET leader = 'Frederik Madsen', moderator = 'Lisbeth' WHERE id = ?").bind(roles.id).run();
    expect(await roles.run()).toBe(true);
    const long = String((roles.services.telegram("sendMessage")[0]!.body as { text: string }).text);
    expect(long).toContain("(14 punkter)");
    expect(long).toContain(`.\nMødeleder: Frederik · Ordstyrer: Lisbeth\n\n1. Punkt 1\n`);
    expect(long).toContain("12. Punkt 12\n... og 2 punkter mere\n\nSe dagsordenen her:");
    expect(long).not.toContain("13. Punkt 13");
    // A send that fails is tried again in her next round.
    const flaky = await mk();
    let down = true;
    const fetcher = ((url: string, init?: RequestInit) => down && String(url).endsWith("/sendMessage") ? Promise.reject(new Error("telegram down")) : flaky.services.fetcher(url, init)) as typeof fetch;
    await expect(flaky.run(MORNING, fetcher)).rejects.toThrow("telegram down");
    down = false;
    expect(await flaky.run(MORNING + 60_000, fetcher)).toBe(true);
    expect(flaky.services.telegram("sendMessage")).toHaveLength(1);
  });

  // Requested: "kan vi skrive et bestyrelsesmedlems navn, hvis det er ham, der har oprettet punktet, og bruge samme farvekode som under opgaver?"
  it("names the member who made a point, in the colour the member has under Opgaver - and Saga's points keep her mark", async () => {
    const { db, call, form, login } = setup(() => "{}");
    const cookie = await login();
    for (const [i, name] of ["Jacob Hauge", "Lisbeth", "Gitta"].entries())
      await (await import("../saga/store.js")).saveBoardMessage(db, { chatId: BOARD, messageId: i + 1, author: name, authorId: String(200 + i), text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
    const id = await saveMeeting(db, { date: "2026-10-15", time: "13:30", place: "", agenda: "Et gammelt punkt", kind: "team" }, "Jacob Hauge", NOW);
    const lisbeth = await memberCookie(((await call("/login", { method: "POST", body: (() => { const f = new FormData(); f.append("password", "hjerte-2026"); return f; })() })).headers.get("set-cookie") ?? "").split(";")[0]!, "Lisbeth");
    await call(`/moder/${id}/punkt`, { method: "POST", cookie: lisbeth, body: form({ text: "Julefest: valg af dato" }) });
    await call(`/moder/${id}/punkt`, { method: "POST", cookie, body: form({ text: "Økonomi" }) });
    await (await import("./data.js")).addAgendaPoints(db, id, ["Lokaleleje"], "Saga", NOW, true);
    expect((await meeting(db, id))?.agenda_authors).toBe(JSON.stringify({ "Julefest: valg af dato": "Lisbeth", "Økonomi": "Jacob Hauge" }));
    const page = await (await call(`/moder/${id}`, { cookie })).text();
    const li = (point: string) => page.slice(page.indexOf(`<li data-point="${point}"`), page.indexOf("</li>", page.indexOf(`<li data-point="${point}"`)));
    const colour = (html: string) => /class="who" style="--c:(#[0-9a-f]{6})"/.exec(html)?.[1];
    expect(li("Julefest: valg af dato")).toMatch(/<span class="who" style="--c:#[0-9a-f]{6}">Lisbeth<\/span>/);
    expect(li("Økonomi")).toMatch(/<span class="who" style="--c:#[0-9a-f]{6}">Jacob<\/span>/);
    expect(li("Lokaleleje")).toContain('<span class="saga-mark">Sagas forslag</span>');
    expect(li("Lokaleleje")).not.toContain('class="who"');
    expect(li("Et gammelt punkt")).not.toMatch(/class="who"|saga-mark/);
    // The same colour as the member has under Opgaver.
    const tasks = await (await call("/opgaver", { cookie })).text();
    await db.prepare("INSERT INTO board_minutes (source, source_file_id, file_name, status, meeting_date, draft_markdown, created_at_ms, updated_at_ms) VALUES ('upload', 'f1', 'm.m4a', 'approved', '2026-10-01', ?, 1, 1)")
      .bind("# Referat\n## Opgaver\n- Lisbeth - Skriv forslag - ingen frist aftalt\n- Jacob - Ring til udlejer - ingen frist aftalt").run();
    const withTasks = await (await call("/opgaver", { cookie })).text();
    expect(tasks).not.toContain("Skriv forslag");
    expect(colour(/<li data-who="Lisbeth"[^]*?<\/li>/.exec(withTasks)?.[0] ?? "")).toBe(colour(li("Julefest: valg af dato")));
    expect(colour(/<li data-who="Jacob"[^]*?<\/li>/.exec(withTasks)?.[0] ?? "")).toBe(colour(li("Økonomi")));
    expect(colour(li("Julefest: valg af dato"))).not.toBe(colour(li("Økonomi")));
    // The overview of the meetings shows them too.
    const overview = await (await call("/moder", { cookie })).text();
    expect(overview).toMatch(/<li>Julefest: valg af dato <span class="who" style="--c:#[0-9a-f]{6}">Lisbeth<\/span><\/li>/);
    // Edited: the one who made it stays; a point of Saga's that a member rewrites is the member's.
    await call(`/moder/${id}/punkt/ret`, { method: "POST", cookie, body: form({ old: "Julefest: valg af dato", text: "Julefest: dato og sted" }) });
    await call(`/moder/${id}/punkt/ret`, { method: "POST", cookie: lisbeth, body: form({ old: "Lokaleleje", text: "Lokaleleje i foråret" }) });
    expect((await meeting(db, id))?.agenda_authors).toBe(JSON.stringify({ "Økonomi": "Jacob Hauge", "Julefest: dato og sted": "Lisbeth", "Lokaleleje i foråret": "Lisbeth" }));
    await call(`/moder/${id}/punkt/slet`, { method: "POST", cookie, body: form({ text: "Økonomi" }) });
    expect(JSON.parse((await meeting(db, id))?.agenda_authors ?? "{}")).toEqual({ "Julefest: dato og sted": "Lisbeth", "Lokaleleje i foråret": "Lisbeth" });
  });

  // Requested: "Der skal i øvrigt kunne vælges en Mødeleder og Ordstyrer." and "Noter under boksen »Planlæg et møde« i et infofelt, at Saga sender dagsordenen og en påmindelse om mødet om morgenen på dagen."
  it("lets the board pick a leader and a moderator among the board, and says under the planning box that Saga writes in the morning", async () => {
    const { db, call, form, login } = setup(() => "{}");
    const cookie = await login();
    for (const [i, name] of ["Jacob Hauge", "Lisbeth", "Gitta"].entries())
      await (await import("../saga/store.js")).saveBoardMessage(db, { chatId: BOARD, messageId: i + 1, author: name, authorId: String(200 + i), text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
    const plan = await (await call("/moder", { cookie })).text();
    expect(plan).toContain('<label>Mødeleder<select name="leader"><option value="">Ikke valgt</option><option value="Gitta">Gitta</option><option value="Jacob Hauge">Jacob Hauge</option><option value="Lisbeth">Lisbeth</option></select></label>');
    expect(plan).toContain('<label>Ordstyrer<select name="moderator">');
    // The note under the box.
    expect(plan).toMatch(/<div class="card" id="nyt"><h2>Planlæg et møde<\/h2>[^]*?<\/div>\s*<p class="notice info-note"><strong>Påmindelse om mødet:<\/strong> Om morgenen på mødedagen \(fra kl\. 8\) skriver Saga i gruppen, at dagsordenen er klar, med punkterne, hvornår I ses og et link til dagsordenen\./);
    const made = await call("/moder", { method: "POST", cookie, body: form({ meeting_date: "2026-10-22", start_time: "13:30", kind: "team", kind_sent: "1", leader: "Gitta", moderator: "Lisbeth" }) });
    const id = Number(/\/moder\/(\d+)/.exec(made.headers.get("location") ?? "")?.[1]);
    expect(await db.prepare("SELECT leader, moderator FROM board_meetings WHERE id = ?").bind(id).first()).toEqual({ leader: "Gitta", moderator: "Lisbeth" });
    const page = await (await call(`/moder/${id}`, { cookie })).text();
    expect(page).toContain('<option value="Gitta" selected>Gitta</option>');
    expect(page).toContain('<option value="Lisbeth" selected>Lisbeth</option>');
    expect(page).toContain("Mødeleder: Gitta · Ordstyrer: Lisbeth");
    expect(await (await call("/moder", { cookie })).text()).toContain("Mødeleder: Gitta · Ordstyrer: Lisbeth");
    expect(await (await call("/", { cookie })).text()).toContain("Mødeleder: Gitta · Ordstyrer: Lisbeth");
    // Someone who is not on the board cannot be picked; a form without the fields leaves them; "Ikke valgt" clears them.
    await call(`/moder/${id}`, { method: "POST", cookie, body: form({ meeting_date: "2026-10-22", leader: "Fremmed Person", moderator: "Jacob Hauge" }) });
    expect(await db.prepare("SELECT leader, moderator FROM board_meetings WHERE id = ?").bind(id).first()).toEqual({ leader: null, moderator: "Jacob Hauge" });
    await call(`/moder/${id}`, { method: "POST", cookie, body: form({ meeting_date: "2026-10-22", start_time: "14:00" }) });
    expect(await db.prepare("SELECT leader, moderator FROM board_meetings WHERE id = ?").bind(id).first()).toEqual({ leader: null, moderator: "Jacob Hauge" });
    await call(`/moder/${id}`, { method: "POST", cookie, body: form({ meeting_date: "2026-10-22", leader: "", moderator: "" }) });
    expect(await db.prepare("SELECT leader, moderator FROM board_meetings WHERE id = ?").bind(id).first()).toEqual({ leader: null, moderator: null });
    // A name that has left the group stays chosen until someone changes it.
    await db.prepare("UPDATE board_meetings SET leader = 'Gammel Ven' WHERE id = ?").bind(id).run();
    expect(await (await call(`/moder/${id}`, { cookie })).text()).toContain('<option value="Gammel Ven" selected>Gammel Ven</option>');
    await call(`/moder/${id}`, { method: "POST", cookie, body: form({ meeting_date: "2026-10-22", leader: "Gammel Ven", moderator: "" }) });
    expect((await meeting(db, id))?.leader).toBe("Gammel Ven");
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
    const kind = translateHtml(`<a class="button ghost">Rediger møde</a><button aria-label="Ret punktet: Økonomi" title="Ret punktet">x</button><button type="button" class="ghost">Annullér</button>
<label>Teammøde</label><p class="small">Sæt kryd, hvis det er et teammøde - så foreslår Saga punkter til dagsordenen. Ellers gør hun ikke.</p><p>Saga foreslår kun punkter til teammøder. Sæt kryd ved Teammøde under Dato, tid og sted, og tryk Gem.</p>
<p>Saga laver selv forslag til næste teammøde hver morgen, og de står nederst som punkter. Slet dem, du ikke vil have, med krydset - det koster ingen AI.</p>`);
    expect(kind).toContain('<a class="button ghost">Edit meeting</a><button aria-label="Edit the point: Økonomi" title="Edit the point">x</button><button type="button" class="ghost">Cancel</button>');
    expect(kind).toContain("<label>Team meeting</label>");
    expect(kind).toContain("Tick if it is a team meeting - then Saga suggests points for the agenda. Otherwise she does not.");
    expect(kind).toContain("Saga only suggests points for team meetings. Tick Team meeting under Date, time and place, and press Save.");
    expect(kind).toContain("Saga makes suggestions for the next team meeting herself every morning");
    expect(kind).not.toMatch(/møde|Saga foreslår|Slet dem|Sæt kryd/);
  });
});
