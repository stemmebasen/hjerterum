import { describe, expect, it } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { classifyDecisions, decisionKey, decisionKinds, scheduledDecisionKinds, withKinds } from "./decisionKinds.js";
import { allDecisions, minutesAgreements, minutesDecisions, type ApprovedMinutes } from "./data.js";
import { parseMinutes } from "./minutesDoc.js";
import { translateHtml } from "./i18n.js";
import { strictSection } from "../saga/markdown.js";
import { saveBoardMessage } from "../saga/store.js";
import { BOARD, deps, fakeServices, sagaEnv, testDatabase, memberCookies } from "../saga/test-support.js";
import type { D1Database } from "../db.js";

// Requested: "Vi skal også differentiere mellem beslutninger og uformelle aftaler, som for eksempel: De tre ansatte (Lisbeth, Gitta, Frederik) holder møde om opgavefordeling"
// - after: "bare fordi referatet ikke er godkendt, betyder det jo ikke, at vi ikke har truffet gyldige beslutninger. Så det skal vi være meget opmærksomme på."
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-10-07T10:00:00Z");
const MEETING = "De tre ansatte (Lisbeth, Gitta, Frederik) holder møde om opgavefordeling";
const DONATION = "Minimumsdonation for ikke-medlemmer sættes til 50 kr.";
const REPORT = "Frederik sender årsrapporten til Jørgen Arvid";
const SECTION_AGREEMENT = "Gitta og Lisbeth ses torsdag om kalenderen";
const MINUTES = `# Referat - bestyrelsesmøde 1. oktober 2026
## Punkter
### 4. Aftaler med undervisere
- Drøftelse: priser
- Beslutning: Ingen beslutning
## Beslutninger
- ${DONATION}
- ${MEETING}
- ${REPORT}
## Aftaler
- ${SECTION_AGREEMENT}
## Opgaver
- Frederik - Send årsrapporten - ingen frist aftalt`;

async function board(): Promise<D1Database> {
  const db = testDatabase();
  for (const [i, name] of ["Jacob Hauge", "Lisbeth", "Gitta"].entries())
    await saveBoardMessage(db, { chatId: BOARD, messageId: i + 1, author: name, authorId: String(200 + i), text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
  await db.prepare("INSERT INTO board_minutes (source, source_file_id, file_name, status, meeting_date, draft_markdown, created_at_ms, updated_at_ms) VALUES ('upload', 'f1', 'm.m4a', 'approved', '2026-10-01', ?, 1, 1)").bind(MINUTES).run();
  return db;
}

/** Saga as the fake AI: the meeting is an agreement, the donation a decision - and she says nothing about the report. */
const sorter = (calls: string[]) => (system: string, user: string) => {
  if (!system.includes("sorterer punkter")) return "Svar.";
  calls.push(user);
  const number = (text: string) => Number(new RegExp(`^(\\d+)\\. ${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m").exec(user)?.[1]);
  return JSON.stringify({ items: [{ n: number(MEETING), kind: "aftale" }, { n: number(DONATION), kind: "beslutning" }] });
};

function client(db: D1Database, ai: (system: string, user: string) => string) {
  const services = fakeServices({ ai });
  const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
  const call = (path: string, init: RequestInit & { cookie?: string; at?: number } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
    ...init, headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, init.at ?? NOW));
  const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
  const login = async () => {
    const session = ((await call("/login", { method: "POST", body: form({ password: "hjerte-2026" }) })).headers.get("set-cookie") ?? "").split(";")[0]!;
    return Object.assign(await memberCookies(session), { session });
  };
  const ask = (cookie: string, question: string) => handleCockpitRequest(new Request(ORIGIN + "/saga", { method: "POST", headers: { origin: ORIGIN, cookie, "content-type": "application/json" }, body: JSON.stringify({ question }) }), env, deps(services.fetcher, NOW));
  return { call, form, login, ask, env, services };
}

const table = (page: string, id: string) => { const at = page.indexOf(`<table id="${id}"`); return at < 0 ? "" : page.slice(at, page.indexOf("</table>", at)); };

describe("decisions and informal agreements", () => {
  it("sorts the points of the minutes: what Saga calls an agreement stands apart, a decision keeps the laurel, and what she leaves out stays a decision", async () => {
    const db = await board();
    const asked: string[] = [];
    const { call, login } = client(db, sorter(asked));
    const as = await login();

    const page = await (await call("/beslutninger", { cookie: as("Lisbeth") })).text();
    const decisions = table(page, "list"), agreements = table(page, "agreements");
    // Saga was asked once, with the points of "Beslutninger" - not the one that already stands under "Aftaler", and with the example for what an agreement is.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain(MEETING);
    expect(asked[0]).not.toContain(SECTION_AGREEMENT);
    // The informal agreements: a card of their own, no laurel, the section's own and Saga's - and who sorted it.
    expect(page).toContain('<div class="card" id="aftaler"><h2>Aftaler og anbefalinger');
    expect(agreements).toContain(MEETING);
    expect(agreements).toContain(SECTION_AGREEMENT);
    expect(agreements).not.toContain('class="laurel"');
    expect(agreements.match(/class="handshake"/g)).toHaveLength(2);
    expect(agreements).toContain("Sorteret af Saga");
    expect(agreements.match(/Sorteret af/g)).toHaveLength(1);
    // The decisions keep the laurel - also the one Saga did not answer for (a point is a decision unless it is clearly an agreement) - and the minutes may be unapproved.
    expect(decisions).toContain(DONATION);
    expect(decisions).toContain(REPORT);
    expect(decisions).not.toContain(MEETING);
    expect(decisions.match(/<svg class="laurel"/g)).toHaveLength(2);
    expect(decisions).toContain("Referatet: 0 af 3 har godkendt");
    expect(await db.prepare("SELECT kind, decided_by FROM cockpit_decision_kinds WHERE key = ?").bind(decisionKey(MEETING)).first()).toEqual({ kind: "aftale", decided_by: "Saga" });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM cockpit_decision_kinds").first()).toEqual({ n: 2 });
    // Each row can be moved by a board member.
    expect(decisions).toContain('<input type="hidden" name="kind" value="aftale"><button class="linkbtn">Ikke en beslutning</button>');
    expect(agreements).toContain('<input type="hidden" name="kind" value="beslutning"><button class="linkbtn">Gør til beslutning</button>');

    // Not asked again within ten minutes - and what was sorted stays sorted.
    await call("/beslutninger", { cookie: as("Lisbeth") });
    expect(asked).toHaveLength(1);
  });

  it("lets a board member move a point, which stays moved - Saga never sorts over it - and lists only the decisions on the front page and for Saga", async () => {
    const db = await board();
    let knowledge = "";
    const asked: string[] = [];
    const { call, form, login, ask } = client(db, (system, user) => { if (system.includes("sorterer punkter")) return sorter(asked)(system, user); knowledge = system; return "Svar."; });
    const as = await login();
    await call("/beslutninger", { cookie: as("Lisbeth") });

    // Moved to the agreements - and the front page and Saga stop calling it a decision.
    const moved = await call("/beslutninger/art", { method: "POST", cookie: as("Gitta"), body: form({ text: REPORT, kind: "aftale" }) });
    expect(moved.headers.get("location")).toBe("/beslutninger?besked=aftale#aftaler");
    const page = await (await call("/beslutninger?besked=aftale", { cookie: as("Lisbeth") })).text();
    expect(page).toContain("Flyttet til aftaler og anbefalinger.");
    expect(table(page, "agreements")).toContain(REPORT);
    expect(table(page, "agreements")).toContain("Sorteret af Gitta");
    expect(table(page, "list")).not.toContain(REPORT);
    const front = await (await call("/", { cookie: as("Lisbeth") })).text();
    expect(front).toContain(DONATION);
    expect(front).not.toContain(MEETING);
    expect(front).not.toContain(REPORT);
    // Saga's list of decisions has the donation and the meeting under the agreements, not under the decisions - and the report is an agreement now too.
    expect((await ask(as("Lisbeth"), "Hvad har vi besluttet?")).status).toBe(200);
    const decisionsPart = knowledge.slice(knowledge.indexOf("BESLUTNINGER (nyeste først"), knowledge.indexOf("UFORMELLE AFTALER OG ANBEFALINGER ("));
    const agreementsPart = knowledge.slice(knowledge.indexOf("UFORMELLE AFTALER OG ANBEFALINGER ("), knowledge.indexOf("MØDER OG DAGSORDENER"));
    expect(decisionsPart).toContain(DONATION);
    expect(decisionsPart).not.toContain(MEETING);
    expect(decisionsPart).not.toContain(REPORT);
    expect(agreementsPart).toContain(MEETING);
    expect(agreementsPart).toContain(REPORT);
    expect(agreementsPart).toContain(SECTION_AGREEMENT);
    expect(agreementsPart).not.toContain(DONATION);

    // And back: a board member moves it to the decisions; Saga's own sorting never overwrites a member's.
    const back = await call("/beslutninger/art", { method: "POST", cookie: as("Lisbeth"), body: form({ text: MEETING, kind: "beslutning" }) });
    expect(back.headers.get("location")).toBe("/beslutninger?besked=beslutning#list");
    expect(table(await (await call("/beslutninger", { cookie: as("Gitta") })).text(), "list")).toContain(MEETING);
    const services = fakeServices({ ai: () => JSON.stringify({ items: [{ n: 1, kind: "aftale" }] }) });
    expect(await classifyDecisions(sagaEnv(db), deps(services.fetcher, NOW), db, [MEETING])).toBe(0);
    expect((await decisionKinds(db)).get(decisionKey(MEETING))).toEqual({ kind: "beslutning", by: "Lisbeth" });
    // Not logged in: nothing moves.
    expect((await call("/beslutninger/art", { method: "POST", cookie: as.session, body: form({ text: DONATION, kind: "aftale" }) })).headers.get("location")).toBe("/hvem");
    expect((await decisionKinds(db)).get(decisionKey(DONATION))?.kind).toBe("beslutning");
  });

  it("keeps a point a decision when Saga cannot be read, and sorts what is new in her round - once an hour", async () => {
    const db = await board();
    const env = sagaEnv(db);
    const broken = fakeServices({ ai: () => "Det ved jeg ikke." });
    await expect(classifyDecisions(env, deps(broken.fetcher, NOW), db, [MEETING])).rejects.toThrow("decision_kinds_unreadable");
    expect((await decisionKinds(db)).size).toBe(0);
    const merged = withKinds(allDecisions([{ id: 1, source: "upload", meeting_date: "2026-10-01", draft_markdown: MINUTES, drive_document_url: null, created_at_ms: 1, updated_at_ms: 1 }], null), await decisionKinds(db));
    expect(merged.find(d => d.text === MEETING)?.kind).toBe("beslutning");
    expect(merged.find(d => d.text === SECTION_AGREEMENT)?.kind).toBe("aftale");
    // A word that is neither kind, a number that is not in the list: ignored.
    const odd = fakeServices({ ai: () => JSON.stringify({ items: [{ n: 1, kind: "måske" }, { n: 9, kind: "aftale" }, { n: 2, kind: "aftale" }] }) });
    expect(await classifyDecisions(env, deps(odd.fetcher, NOW), db, [DONATION, MEETING])).toBe(1);
    expect((await decisionKinds(db)).get(decisionKey(MEETING))?.kind).toBe("aftale");
    expect((await decisionKinds(db)).has(decisionKey(DONATION))).toBe(false);

    // Saga's round: sorts the rest, once an hour.
    const claims = new Set<string>();
    const claim = async (key: string, slot: number) => { const id = `${key}:${slot}`; if (claims.has(id)) return false; claims.add(id); return true; };
    const asked: string[] = [];
    const round = fakeServices({ ai: sorter(asked) });
    await scheduledDecisionKinds(env, deps(round.fetcher, NOW), db, claim);
    await scheduledDecisionKinds(env, deps(round.fetcher, NOW), db, claim);
    expect(asked).toHaveLength(1);
    expect((await decisionKinds(db)).get(decisionKey(DONATION))?.kind).toBe("beslutning");
  });

  it("reads the section Aftaler of the minutes, never a point whose title says so, and shows it apart on the minutes", async () => {
    expect(strictSection(MINUTES, /^aftaler$/i)).toBe(`- ${SECTION_AGREEMENT}`);
    expect(strictSection("# Referat\n## Punkter\n### 4. Aftaler med undervisere\n- Drøftelse: priser", /^aftaler$/i)).toBe("");
    const minutes = { id: 1, source: "upload", meeting_date: "2026-10-01", draft_markdown: MINUTES, drive_document_url: null, created_at_ms: 1, updated_at_ms: 1 } as ApprovedMinutes;
    expect(minutesDecisions(minutes).map(d => d.text)).toEqual([DONATION, MEETING, REPORT]);
    expect(minutesAgreements(minutes).map(d => d.text)).toEqual([SECTION_AGREEMENT]);
    expect(parseMinutes(MINUTES)?.agreements).toEqual([SECTION_AGREEMENT]);
    expect(parseMinutes(MINUTES.replace(/## Aftaler\n- .*\n/, "## Aftaler\n- Ingen aftaler\n"))?.agreements).toEqual([]);

    const db = await board();
    const { call, login } = client(db, () => "Svar.");
    const as = await login();
    const doc = await (await call("/referat/1", { cookie: as("Lisbeth") })).text();
    expect(doc).toContain("<h2>Aftaler</h2>");
    expect(doc).toContain("Uformelt aftalt eller anbefalet - ikke afgjort som beslutning i bestyrelsen.");
    expect(doc.indexOf("<h2>Beslutninger</h2>")).toBeLessThan(doc.indexOf("<h2>Aftaler</h2>"));
  });

  it("has the new texts in English", () => {
    const en = translateHtml(`<h2>Aftaler og anbefalinger <span class="pill">2</span></h2><p>Uformelle aftaler mellem enkelte personer, anbefalinger og forslag - ikke afgjort som beslutninger i bestyrelsen. Er en af dem i virkeligheden en beslutning, så tryk <em>Gør til beslutning</em>.</p>
<th>Aftale eller anbefaling</th><button>Ikke en beslutning</button><div class="small muted">Sorteret af Saga</div><p>Saga sorterer beslutninger, aftaler og anbefalinger - genindlæs siden om lidt.</p><p>Flyttet til aftaler og anbefalinger.</p>`);
    expect(en).toContain("<h2>Agreements and recommendations <span");
    expect(en).toContain("Informal agreements between a few people, recommendations and proposals - not settled as decisions of the board. If one of them is really a decision, press <em>Make it a decision</em>.");
    expect(en).toContain("<th>Agreement or recommendation</th><button>Not a decision</button>");
    expect(en).toContain("Sorted by Saga");
    expect(en).toContain("Saga is sorting decisions, agreements and recommendations - reload the page in a moment.");
    expect(en).toContain("Moved to agreements and recommendations.");
    expect(en).not.toMatch(/anbefaling|aftaler|beslutning/i);
  });

  // Requested: "lige nu står en linje som 'Der anbefales op til fire suppleanter på generalforsamlingen.' sådan beslutning med laurbær"
  it("tells Saga that a recommendation is not a decision, and sorts again what she first left as a decision (migration 0049) - never what a member moved", async () => {
    const db = await board();
    // The first round: Saga's decisions, an agreement of hers, and one a member moved.
    const row = (text: string, kind: string, by: string) => db.prepare("INSERT INTO cockpit_decision_kinds (key, kind, decided_by, at_ms) VALUES (?, ?, ?, 1)").bind(decisionKey(text), kind, by).run();
    const RECOMMENDED = "Der anbefales op til fire suppleanter på generalforsamlingen.";
    await row(RECOMMENDED, "beslutning", "Saga"); await row(DONATION, "beslutning", "Saga"); await row(MEETING, "aftale", "Saga"); await row(REPORT, "beslutning", "Lisbeth");
    const migration = Object.values(import.meta.glob("../../migrations/0049_*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>)[0]!;
    await db.prepare(migration.replace(/^--.*$/gm, "").trim()).run();
    const kinds = await decisionKinds(db);
    expect([...kinds].map(([k, v]) => `${v.kind}:${v.by}:${k.slice(0, 12)}`).sort()).toEqual([`aftale:Saga:${decisionKey(MEETING).slice(0, 12)}`, `beslutning:Lisbeth:${decisionKey(REPORT).slice(0, 12)}`]);

    // The instruction: by what the point says; the recommendation is the example of what is not a decision, and neither mistake is allowed.
    let system = "", user = "";
    const services = fakeServices({ ai: (s, u) => { system = s; user = u; return JSON.stringify({ items: [{ n: 1, kind: "aftale" }, { n: 2, kind: "beslutning" }] }); } });
    expect(await classifyDecisions(sagaEnv(db), deps(services.fetcher, NOW), db, [RECOMMENDED, DONATION])).toBe(2);
    expect(system).toContain("Der anbefales op til fire suppleanter på generalforsamlingen");
    expect(system).toContain("en anbefaling er ikke afgjort");
    expect(system).toContain("begge fejl er forkerte");
    expect(user).toBe(`1. ${RECOMMENDED}\n2. ${DONATION}`);
    expect((await decisionKinds(db)).get(decisionKey(RECOMMENDED))).toEqual({ kind: "aftale", by: "Saga" });
    expect((await decisionKinds(db)).get(decisionKey(DONATION))).toEqual({ kind: "beslutning", by: "Saga" });
  });
});
