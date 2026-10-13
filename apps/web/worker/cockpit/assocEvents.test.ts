import { describe, expect, it } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { saveMeeting } from "./data.js";
import { saveBoardMessage, saveOverview } from "../saga/store.js";
import { BOARD, deps, fakeServices, memberCookie, sagaEnv, testDatabase } from "../saga/test-support.js";

// Requested: "Når foreningen har arrangementer som teammøder og generalforsamlinger, skal det nævnes på forsiden af admin. Vi har for eksempel
// generalforsamling i morgen. Det bør nævnes på forsiden med en flot gradient guldbaggrund." And: "'Hvad bevæger sig' må også gerne inkludere
// aftaler og vigtige pejlemærker fra Telegram" - and the footer "should change accordingly".
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-10-13T10:00:00Z"); // Tuesday
const DAY = 86_400_000;

async function setup() {
  const db = testDatabase();
  await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Jacob Hauge", authorId: "200", text: "Hej", sentAtMs: NOW - DAY, fromAssistant: false });
  const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
  const services = fakeServices({});
  const ask = (path: string, init: RequestInit = {}) => handleCockpitRequest(new Request(ORIGIN + path, init), env, deps(services.fetcher, NOW));
  const session = ((await ask("/login", { method: "POST", headers: { origin: ORIGIN }, body: (() => { const f = new FormData(); f.append("password", "hjerte-2026"); return f; })() })).headers.get("set-cookie") ?? "").split(";")[0]!;
  return { db, ask, cookie: await memberCookie(session, "Jacob Hauge") };
}

describe("the association's own gatherings on the admin's front page", () => {
  it("shows the general assembly tomorrow in the golden card - and a team meeting only in its regular box, with Jeg kommer", async () => {
    const { db, ask, cookie } = await setup();
    await db.prepare("INSERT INTO house_events (id, title, starts_at_ms, ends_at_ms, location, content_hash, updated_at_ms) VALUES ('gf', 'Generalforsamling i Hjerterum', ?, ?, 'Hjerterum', 'h', ?)")
      .bind(Date.parse("2026-10-14T17:30:00Z"), Date.parse("2026-10-14T19:00:00Z"), NOW).run();
    await saveMeeting(db, { date: "2026-10-16", time: "17:00", place: "Salen", agenda: "1. Økonomi", kind: "team" }, "Jacob Hauge", NOW);
    await saveMeeting(db, { date: "2026-11-20", time: "17:00", place: "", agenda: "", kind: "team" }, "Jacob Hauge", NOW);
    const home = await (await ask("/", { headers: { cookie } })).text();
    expect(home).toContain('<section class="assoc-card" aria-label="Foreningens arrangementer">');
    expect(home).toContain('<span class="assoc-when">I morgen</span><strong>Generalforsamling i Hjerterum</strong>');
    expect(home).toContain("Onsdag 14. oktober kl. 19.30 · Hjerterum");
    // Reported: "You have now put in a gold frame for our team meeting. What I meant was the generalforsamling."
    expect(home).not.toContain("<strong>Teammøde</strong>");
    expect(home.split('class="assoc"').length - 1).toBe(1);
    expect(home).toContain('<h2>Næste teammøde</h2>');
    expect(home).toMatch(/<div class="rsvp-line"><form method="post" action="\/kommer"><input type="hidden" name="key" value="moede:\d+"><button class="rsvp-plain" aria-pressed="false">Jeg kommer<\/button><\/form>/);
    expect(home).not.toContain("20. november kl.");
    expect(home.indexOf("assoc-card")).toBeLessThan(home.indexOf('class="tiles'));
    // The footer follows what is built; in the tests, the day set by hand.
    expect(home).toMatch(/Hjerterum admin v\d+\.\d+\.\d+ · \d+\. okt\. 2026/);
  });

  it("puts the agreements and milestones from the Telegram group under Hvad bevæger sig", async () => {
    const { db, ask, cookie } = await setup();
    const picture = { summary: "Roligt.", temperature: null, document: { latestMeeting: "", missingMinutes: [], dates: [], figures: [], decisions: [], openThreads: [], proposals: [], tasks: [], nextAgenda: [] },
      topics: [{ title: "Rabat til Hjerteland", status: "besluttet", who: ["Gitta"], waitsOnJacob: false, note: "Aftalt 20 % for medlemmer fra 1. november" },
        { title: "Nyt nøglesystem", status: "på vej", who: [], waitsOnJacob: false, note: "Leveres fredag" }], forJacob: [], forMembers: [] };
    await saveOverview(db, "Roligt.", NOW - 3_600_000, { data: JSON.stringify(picture), docHash: "x" });
    const page = await (await ask("/opgaver", { headers: { cookie } })).text();
    expect(page).toContain("<h2>Hvad bevæger sig</h2>");
    expect(page).toContain('<h3 class="moves-h">Fra Telegram-gruppen: aftaler og pejlemærker</h3>');
    expect(page).toContain('<span class="tstatus s-besluttet">Aftalt</span><span><strong>Rabat til Hjerteland</strong> <span class="tnote">Aftalt 20 % for medlemmer fra 1. november</span><span class="when">· Gitta</span>');
    expect(page).toContain('<span class="tstatus s-på-vej">På vej</span>');
  });

  // Requested: "Kan du indsætte en lille knap? 'Jeg kommer' til vores fælles møder, inklusive generalforsamling."
  it("lets each member say 'Jeg kommer' - and take it back - and shows who is coming", async () => {
    const { db, ask, cookie } = await setup();
    await db.prepare("INSERT INTO house_events (id, title, starts_at_ms, ends_at_ms, location, content_hash, updated_at_ms) VALUES ('gf1', 'Generalforsamling i Hjerterum', ?, NULL, 'Hjerterum', 'h', ?)")
      .bind(Date.parse("2026-10-14T17:30:00Z"), NOW).run();
    const form = (key: string) => { const f = new FormData(); f.append("key", key); return f; };
    let home = await (await ask("/", { headers: { cookie } })).text();
    expect(home).toContain('<input type="hidden" name="key" value="hus:gf1">\n<button class="" aria-pressed="false">Jeg kommer</button>');
    const said = await ask("/kommer", { method: "POST", headers: { origin: ORIGIN, cookie }, body: form("hus:gf1") });
    expect(said.headers.get("location")).toBe("/");
    home = await (await ask("/", { headers: { cookie } })).text();
    expect(home).toContain('<button class="is-coming" aria-pressed="true">✓ Du kommer</button>');
    expect(home).toContain('<span class="assoc-who">Kommer: Jacob (1)</span>');
    await ask("/kommer", { method: "POST", headers: { origin: ORIGIN, cookie }, body: form("hus:gf1") });
    home = await (await ask("/", { headers: { cookie } })).text();
    expect(home).not.toContain("Kommer: Jacob");
    // Only the association's own gatherings can be answered.
    await ask("/kommer", { method: "POST", headers: { origin: ORIGIN, cookie }, body: form("x'; DROP") });
    expect((await db.prepare("SELECT COUNT(*) AS n FROM assoc_rsvp").first<{ n: number }>())?.n).toBe(0);
    // Requested: "Der skal så stå deltagere diskret til højre for Rediger møde-knappen".
    const meetingId = await saveMeeting(db, { date: "2026-10-15", time: "13:30", place: "Hjerterum", agenda: "", kind: "team" }, "Jacob Hauge", NOW);
    let meetings = await (await ask("/moder", { headers: { cookie } })).text();
    expect(meetings).toContain(`Rediger møde</a><span class="small muted">Ingen har meldt sig endnu</span>`);
    await ask("/kommer", { method: "POST", headers: { origin: ORIGIN, cookie }, body: form(`moede:${meetingId}`) });
    meetings = await (await ask("/moder", { headers: { cookie } })).text();
    expect(meetings).toContain(`Rediger møde</a><span class="small muted">Deltagere: Jacob (1)</span>`);
  });
});
