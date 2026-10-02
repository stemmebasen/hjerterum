import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../config-entry.js";
import { handleCockpitRequest } from "../cockpit/handler.js";
import { deps, sagaEnv, testDatabase } from "../saga/test-support.js";
import type { D1Database } from "../db.js";

// Partnerplanen, udviklingsregel 8: "Test hele brugerflowet fra partner → event → medlem → rabat → ekstern
// tilmelding." Første konkrete mål: én ekstern partner siger ja til medlemsrabat, og partnerens første events
// kommer automatisk ind i Hjerterums kalender.

vi.mock("../auth.js", () => ({ authenticateBearer: async (request: Request) => {
  const userId = request.headers.get("authorization");
  if (!userId) throw new Error("unauthorized");
  return { userId };
} }));

const ORIGIN = "https://admin.hjerterum.example";
const SITE = "https://hjerterum.example";
const NOW = Date.parse("2026-10-01T10:00:00Z");
const FEED = "https://yogahuset.example/kalender.ics";
const CALENDAR = ["BEGIN:VCALENDAR", "VERSION:2.0",
  "BEGIN:VEVENT", "UID:yin-15", "SUMMARY:Yin yoga workshop", "DTSTART;TZID=Europe/Copenhagen:20261015T190000", "DTEND;TZID=Europe/Copenhagen:20261015T210000",
  "DESCRIPTION:To timer med ro og åndedræt.\\nPris: 250 kr.", "URL:https://yogahuset.example/yin-15", "END:VEVENT",
  "BEGIN:VEVENT", "UID:lyd-20", "SUMMARY:Lydbad", "DTSTART;TZID=Europe/Copenhagen:20261020T190000", "END:VEVENT",
  "BEGIN:VEVENT", "UID:hold", "SUMMARY:Ugentligt hold", "DTSTART;TZID=Europe/Copenhagen:20261005T170000", "RRULE:FREQ=WEEKLY", "END:VEVENT",
  "END:VCALENDAR"].join("\r\n");

let db: D1Database;
const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
const fetcher: typeof fetch = async input => String(input) === FEED ? new Response(CALENDAR, { headers: { "content-type": "text/calendar" } }) : new Response("", { status: 404 });
const cockpit = (path: string, init: RequestInit & { cookie?: string } = {}) => handleCockpitRequest(new Request(ORIGIN + path, { ...init,
  headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" }), deps(fetcher, NOW));
const site = (path: string, user?: string) => worker.fetch(new Request(SITE + path, { headers: user ? { authorization: user } : {} }),
  { DB: db, CLERK_JWT_ISSUER: "https://clerk.example", CLERK_SECRET_KEY: "test", ASSETS: { fetch: async () => new Response("spa") } });
async function member(user: string, tier: string) {
  await db.prepare(`INSERT INTO members (clerk_user_id, stripe_customer_id, tier, interval, status, full_name, email, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, 'month', 'active', 'Medlem', ?, 1, 1)`).bind(user, `cus-${user}`, tier, `${user}@example.test`).run();
}

describe("Partnerplanen, fase 1: partner → event → medlem → rabat → ekstern tilmelding", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); db = testDatabase(); });
  afterEach(() => vi.useRealTimers());

  it("takes one yes in the cockpit and does the rest by itself", async () => {
    await member("member-1", "standard");
    await member("support-1", "support");
    const session = ((await cockpit("/login", { method: "POST", body: form({ password: "hjerte-2026" }) })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const cookie = `${session}; hjerterum_cockpit_who=Lisbeth`;
    expect(await (await cockpit("/arrangementer", { cookie })).text()).toContain("/arrangementer/partnere");

    // 1. The partner says yes: 20 % for Hjerterum's members, a code, and their calendar address.
    const invalid = await cockpit("/arrangementer/partnere", { method: "POST", cookie, body: form({ name: "Yogahuset", discount_kind: "percent", discount_value: "120", redemption: "x" }) });
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).toContain("Rabatten skal være et helt antal procent mellem 1 og 90.");
    const created = await cockpit("/arrangementer/partnere", { method: "POST", cookie, body: form({ name: "Yogahuset", website: "yogahuset.example", discount_kind: "percent",
      discount_value: "20", redemption: "Brug koden HJERTERUM20 ved tilmelding.", feed_url: "webcal://yogahuset.example/kalender.ics", contact_name: "Anna", agreed_on: "2026-09-30" }) });
    expect(created.status).toBe(303);
    const page = created.headers.get("location")!;
    expect(page).toMatch(/^\/arrangementer\/partnere\/\d+\?besked=hentet$/);

    // 2. Saga fetched the partner's events at once; the weekly class is named, not shown.
    const detail = await (await cockpit(page, { cookie })).text();
    expect(detail).toContain("Saga har hentet partnerens kalender.");
    expect(detail).toContain("2 kommende events (iCal) · 1 gentagen serie vises ikke endnu");
    expect(detail).toContain("250 kr. → medlemmer 200 kr.");

    // 3. The public calendar shows the partner event, the normal price and the member price - not the code.
    const publicEvents = await (await site("/api/events/partners")).json() as Array<Record<string, unknown>>;
    expect(publicEvents.map(e => [e.title, e.partnerName, e.price, e.memberPrice, e.discount])).toEqual([
      ["Yin yoga workshop", "Yogahuset", "250 kr.", "200 kr.", "20 % rabat for Hjerterum-medlemmer"],
      ["Lydbad", "Yogahuset", null, null, "20 % rabat for Hjerterum-medlemmer"]]);
    expect(JSON.stringify(publicEvents)).not.toContain("HJERTERUM20");

    // 4. A member sees how to get the discount; without member benefits or a login, no one does.
    expect((await site("/api/members/partner-events")).status).toBe(401);
    expect((await site("/api/members/partner-events", "support-1")).status).toBe(403);
    const memberEvents = await (await site("/api/members/partner-events", "member-1")).json() as Array<Record<string, unknown>>;
    expect(memberEvents[0]).toMatchObject({ title: "Yin yoga workshop", memberPrice: "200 kr.", redemption: "Brug koden HJERTERUM20 ved tilmelding." });

    // 5. Signup and payment happen at the partner: the click goes there and is counted.
    const go = await site(String(memberEvents[0]!.link));
    expect(go.status).toBe(302);
    expect(go.headers.get("location")).toBe("https://yogahuset.example/yin-15");
    expect((await site(String(publicEvents[1]!.link))).headers.get("location")).toBe("https://yogahuset.example/");
    expect((await site("/api/events/partners/999/go")).status).toBe(404);

    // 6. Fase 2's numbers are on the partner's page and the overview.
    expect(await (await cockpit(page.split("?")[0]!, { cookie })).text()).toContain("2 klik videre · 1 fra medlemmer · 1 medlemsvisninger");
    expect(await (await cockpit("/arrangementer/partnere", { cookie })).text()).toMatch(/<b>1<\/b><span>aktive partnere<\/span><\/div><div><b>2<\/b><span>kommende partner-events/);

    // The board can keep one event out, pause the partner, or end it - without touching the partner's calendar.
    const lydbad = Number(publicEvents[1]!.id);
    expect((await cockpit(page.split("?")[0]!, { method: "POST", cookie, body: form({ action: "hide", event: String(lydbad) }) })).headers.get("location")).toContain("besked=skjult");
    expect((await (await site("/api/events/partners")).json() as unknown[]).length).toBe(1);
    await cockpit(page.split("?")[0]!, { method: "POST", cookie, body: form({ action: "pause" }) });
    expect(await (await site("/api/events/partners")).json()).toEqual([]);
    await cockpit(page.split("?")[0]!, { method: "POST", cookie, body: form({ action: "activate" }) });
    expect((await (await site("/api/events/partners")).json() as unknown[]).length).toBe(1);
  });

  it("asks who you are before a change, and keeps the agreement editable", async () => {
    const session = ((await cockpit("/login", { method: "POST", body: form({ password: "hjerte-2026" }) })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const anonymous = await cockpit("/arrangementer/partnere", { method: "POST", cookie: session, body: form({ name: "X", discount_value: "10", redemption: "x" }) });
    expect(anonymous.headers.get("location")).toBe("/hvem");
    const cookie = `${session}; hjerterum_cockpit_who=Gitta`;
    const created = await cockpit("/arrangementer/partnere", { method: "POST", cookie, body: form({ name: "Dansehuset", discount_kind: "amount", discount_value: "50", redemption: "Vis medlemskab" }) });
    const page = created.headers.get("location")!.split("?")[0]!;
    expect(created.headers.get("location")).toContain("besked=oprettet");
    expect(await (await cockpit(page, { cookie })).text()).toContain("Ingen kalenderadresse endnu");
    const saved = await cockpit(page, { method: "POST", cookie, body: form({ name: "Dansehuset", discount_kind: "amount", discount_value: "75", redemption: "Vis medlemskab",
      feed_url: FEED }) });
    expect(saved.headers.get("location")).toContain("besked=gemt-hentet");
    const text = await (await cockpit(page, { cookie })).text();
    expect(text).toContain("75 kr. rabat for Hjerterums medlemmer");
    expect(text).toContain("250 kr. → medlemmer 175 kr.");
    expect((await cockpit("/arrangementer/partnere/4242", { cookie })).status).toBe(404);
  });
});
