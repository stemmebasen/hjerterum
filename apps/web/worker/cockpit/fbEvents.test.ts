import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { BOARD, deps, fakeServices, OWNER, personalCookie, sagaEnv, testDatabase } from "../saga/test-support.js";
import { claimJob, saveBoardMessage } from "../saga/store.js";
import { facebookEvents, scheduledFacebookReminder } from "./fbEvents.js";
import { prPlanData } from "./prPlan.js";

// Requested (the chair, 3 Nov 2026): the website promises every event on Hjerterum's Facebook page; Meta does not let the system make them - "Lisbeth opretter
// dem", the cockpit reminds her, and "Hele bestyrelsen" may see and tick the list.
const ORIGIN = "https://admin.hjerterum.example";
const MONDAY = Date.parse("2026-11-09T08:30:00Z"); // 9.30 in Copenhagen

describe("Facebook-begivenheder", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function setup() {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices();
    const env = sagaEnv(db);
    for (const [i, [name, tid]] of ([["Jacob Hauge", OWNER], ["Lisbeth Nielsen", "201"], ["Douglas", "202"], ["Frederik", "203"]] as const).entries())
      await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: tid, text: "Hej", sentAtMs: MONDAY - 86_400_000, fromAssistant: false });
    const event = (id: string, title: string, days: number, location: string | null = null) => db.prepare(`INSERT INTO house_events (id, title, starts_at_ms, host, location, content_hash, updated_at_ms) VALUES (?, ?, ?, 'Kasper', ?, 'x', 0)`)
      .bind(id, title, MONDAY + days * 86_400_000, location).run();
    await event("SFa", "Lydhealing", 2);
    await event("SFb", "Dans", 10);
    await event("SFc", "Retreat", 30);
    await event("SFd", "Hos Hjerteland", 3, "Hjerteland");
    await db.prepare(`INSERT INTO room_bookings (clerk_user_id, teacher_name, teacher_email, title, starts_at_ms, ends_at_ms, review_status, status, created_at_ms, updated_at_ms)
      VALUES ('u1', 'Anna', 'a@x.dk', 'Yoga med Anna', ?, ?, 'approved', 'scheduled', 0, 0)`).bind(MONDAY + 5 * 86_400_000, MONDAY + 5 * 86_400_000 + 3_600_000).run();
    const call = (path: string, cookie: string, init: RequestInit = {}) => handleCockpitRequest(new Request(ORIGIN + path, { ...init, redirect: "manual",
      headers: { cookie, ...(init.method === "POST" ? { origin: ORIGIN } : {}) } }), env, deps(services.fetcher, MONDAY));
    return { db, env, services, call };
  }

  it("lists the coming events for the whole board, and each can be ticked with its link", async () => {
    const { db, call } = await setup();
    const douglas = await personalCookie("Douglas", MONDAY);
    const page = await (await call("/arrangementer/facebook", douglas)).text();
    expect(page).toContain("Mangler (4)");
    for (const title of ["Lydhealing", "Dans", "Retreat", "Yoga med Anna"]) expect(page).toContain(title);
    expect(page).not.toContain("Hos Hjerteland");
    expect(await (await call("/arrangementer", douglas)).text()).toContain('href="/arrangementer/facebook"');
    const lisbeth = await personalCookie("Lisbeth Nielsen", MONDAY);
    const form = new FormData(); form.append("event", "mw:SFa"); form.append("done", "1"); form.append("link", "https://www.facebook.com/events/123");
    expect((await call("/arrangementer/facebook", lisbeth, { method: "POST", body: form })).headers.get("location")).toBe("/arrangementer/facebook?besked=oprettet");
    const ticked = (await facebookEvents(db, MONDAY)).find(e => e.key === "mw:SFa")!;
    expect(ticked.done).toMatchObject({ by: "Lisbeth Nielsen", link: "https://www.facebook.com/events/123" });
    expect(await (await call("/arrangementer/facebook", lisbeth)).text()).toContain("Mangler (3)");
    // Something that is not one of the coming events is not ticked.
    const bad = new FormData(); bad.append("event", "mw:SFnope"); bad.append("done", "1");
    await call("/arrangementer/facebook", lisbeth, { method: "POST", body: bad });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM facebook_events").first<{ n: number }>()).toEqual({ n: 1 });
  });

  it("reminds Lisbeth and Frederik on Monday and Thursday from 9, once a day, of what is missing in the next three weeks - and is in the chair's plan", async () => {
    const { db, env, services } = await setup();
    const remind = (now: number) => scheduledFacebookReminder(env, deps(services.fetcher, now), db, (key, slot) => claimJob(db, key, slot, now));
    expect(await remind(MONDAY - 2 * 3_600_000)).toBe(false); // 7.30
    expect(await remind(MONDAY)).toBe(true);
    expect(await remind(MONDAY + 3_600_000)).toBe(false);
    expect(await remind(MONDAY + 86_400_000)).toBe(false); // Tuesday
    // "Lisbeth og Frederik står for at oprette events" - both are told.
    const sent = services.telegram("sendMessage");
    expect(sent.map(c => (c.body as { chat_id: string }).chat_id).sort()).toEqual(["201", "203"]);
    expect(String((sent.find(c => (c.body as { chat_id: string }).chat_id === "203")!.body as { text: string }).text)).toContain("Hej Frederik.");
    const text = String((sent[0]!.body as { text: string }).text);
    expect(text).toContain("Hej Lisbeth. 3 events de næste tre uger mangler en begivenhed");
    expect(text).toContain("Lydhealing");
    expect(text).not.toContain("Retreat");
    expect(text).toContain("/arrangementer/facebook");
    const plan = await prPlanData(db, { ready: true, account: null, nowMs: MONDAY });
    expect(plan.todo.map(t => t.text)).toContain("3 events de næste to uger mangler en begivenhed på Facebook. Lisbeth og Frederik opretter dem; Saga minder dem om det.");
    // All made: Thursday is quiet.
    for (const key of ["mw:SFa", "mw:SFb", "hr:1"]) await db.prepare("INSERT INTO facebook_events (event_key, title, starts_at_ms, done_by, done_at_ms) VALUES (?, 'x', 0, 'Lisbeth', 0)").bind(key).run();
    expect(await remind(MONDAY + 3 * 86_400_000)).toBe(false);
  });
});
