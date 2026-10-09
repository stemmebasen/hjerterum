import { describe, expect, it } from "vitest";
import { latestBoardNow, scheduledBoardNow, writeBoardNow } from "./boardNow.js";
import { saveMeeting } from "./data.js";
import { homePage } from "./home.js";
import { claimJob, insertMail, markOwnerDone, queueMinutes, saveBoardMessage, updateMinutes } from "../saga/store.js";
import { BOARD, deps, fakeServices, sagaEnv, testDatabase } from "../saga/test-support.js";

// Requested: "\"Bestyrelsen lige nu\" virker ikke. Her skal Saga en gang i timen lave et resume og overblik over hvad der
// rører sig netop nu med basis i Telegram, vigtige mails og fra mødet (hvis det er mindre end 48 timer siden)" -
// "Man kan så klikke videre og få et mere detaljeret blik i Status".
const NOW = Date.parse("2026-10-09T10:00:00Z"); // Friday 12:00 in Copenhagen
const HOUR = 3_600_000;

describe("Bestyrelsen lige nu", () => {
  it("rewrites a text from before the short format at the next hour", async () => {
    const db = testDatabase();
    await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Lisbeth", authorId: "201", text: "GF 14. okt.", sentAtMs: NOW - 2 * HOUR, fromAssistant: false });
    await db.prepare("INSERT INTO board_now (text, newest_source_ms, created_at_ms) VALUES (?, ?, ?)").bind("- Thomas Emil: Jacob skal sende en sidste besked.\n- GF 14. okt.", NOW, NOW - HOUR).run();
    const ai = fakeServices({ ai: () => "Roligt: GF 14. okt. forberedes." });
    expect(await writeBoardNow(sagaEnv(db), deps(ai.fetcher, NOW), db)).toBe(true);
    expect((await latestBoardNow(db))?.text).toBe("Roligt: GF 14. okt. forberedes.");
    expect(await writeBoardNow(sagaEnv(db), deps(ai.fetcher, NOW + HOUR), db)).toBe(false);
  });

  it("says what is done is done, and keeps it under fifty words", async () => {
    const db = testDatabase();
    await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Lisbeth", authorId: "201", text: "Hvad med Thomas Emil?", sentAtMs: NOW - HOUR, fromAssistant: false });
    await markOwnerDone(db, "k1", "Svar Thomas Emil om sagen", NOW - 30 * 60_000);
    let input = "", system = "";
    const ai = fakeServices({ ai: (s, user) => { system = s; input = user; return `- ${Array.from({ length: 80 }, (_, i) => `ord${i}`).join(" ")}`; } });
    await writeBoardNow(sagaEnv(db), deps(ai.fetcher, NOW), db);
    expect(system).toContain("Højst 45 ord");
    expect(system).toContain("i entréen: varmt, venligt og let");
    expect(system).toContain("Det, der står under KLARET, er klaret");
    expect(input).toContain("KLARET");
    expect(input).toContain("Svar Thomas Emil om sagen");
    const text = (await latestBoardNow(db))!.text;
    expect(text.split(" ").length).toBe(51);
    expect(text.startsWith("ord0")).toBe(true);
  });

  it("sums up the group, team@ and a meeting within 48 hours - once a day on weekdays, only when something is new", async () => {
    const db = testDatabase();
    await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Gitta", authorId: "202", text: "Skal vi rykke julefesten?", sentAtMs: NOW - 2 * HOUR, fromAssistant: false });
    await saveBoardMessage(db, { chatId: BOARD, messageId: 2, author: "Douglas", authorId: "203", text: "Gammel besked", sentAtMs: NOW - 5 * 24 * HOUR, fromAssistant: false });
    await insertMail(db, { ref: "m1", sender: "Udlejer", subject: "Varsel om husleje", receivedAtMs: NOW - HOUR, preview: "Huslejen stiger.", nowMs: NOW });
    const minutes = (await queueMinutes(db, { source: "upload", fileId: "f", fileName: "m.m4a", mimeType: null, meetingDate: "2026-10-08", nowMs: NOW - 20 * HOUR }))!;
    await updateMinutes(db, minutes, { status: "drafted", draft: "# Referat\n## Beslutninger\n- GF 14. okt. forberedes" }, NOW - 18 * HOUR);
    await saveMeeting(db, { date: "2026-09-17", time: "", place: "", agenda: "Gammelt møde" }, "Jacob", NOW - 15 * 24 * HOUR);
    let input = "", calls = 0;
    const ai = fakeServices({ ai: (_system, user) => { input = user; calls++; return "Gitta vil rykke julefesten, udlejeren varsler huslejestigning, og GF 14. okt. forberedes efter mødet i går."; } });
    expect(await writeBoardNow(sagaEnv(db), deps(ai.fetcher, NOW), db)).toBe(true);
    expect(input).toContain("Gitta: Skal vi rykke julefesten?");
    expect(input).not.toContain("Gammel besked");
    expect(input).toContain("Varsel om husleje");
    expect(input).toContain("GF 14. okt. forberedes");
    expect(input).not.toContain("Gammelt møde");
    expect((await latestBoardNow(db))?.text).toBe("Gitta vil rykke julefesten, udlejeren varsler huslejestigning, og GF 14. okt. forberedes efter mødet i går.");
    // Nothing new: no new call.
    expect(await writeBoardNow(sagaEnv(db), deps(ai.fetcher, NOW + HOUR), db)).toBe(false);
    expect(calls).toBe(1);
    // A Saturday: nothing.
    await saveBoardMessage(db, { chatId: BOARD, messageId: 3, author: "Lisbeth", authorId: "201", text: "Ny", sentAtMs: NOW + 23 * HOUR, fromAssistant: false });
    const saturday = NOW + 24 * HOUR;
    await scheduledBoardNow(sagaEnv(db), deps(ai.fetcher, saturday), db, (key, slot) => claimJob(db, key, slot, saturday));
    expect(calls).toBe(1);
    // An answer without points is never saved.
    const broken = fakeServices({ ai: () => "```json {" });
    await saveBoardMessage(db, { chatId: BOARD, messageId: 4, author: "Lisbeth", authorId: "201", text: "Nyere", sentAtMs: NOW + 2 * HOUR, fromAssistant: false });
    expect(await writeBoardNow(sagaEnv(db), deps(broken.fetcher, NOW + 3 * HOUR), db)).toBe(false);
    expect((await latestBoardNow(db))?.text).toContain("Gitta vil rykke julefesten");
  });

  // Requested: "Bestyrelsen lige nu skal være max en gang om dagen".
  it("writes 'lige nu' every weekday morning from seven, once, even when something new comes in later that day", async () => {
    const db = testDatabase();
    const morning = Date.parse("2026-10-08T06:00:00Z"); // 08:00 on a Thursday in Copenhagen
    await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Gitta", authorId: "202", text: "Første", sentAtMs: morning - HOUR, fromAssistant: false });
    let calls = 0;
    const ai = fakeServices({ ai: () => { calls++; return "Gitta har skrevet."; } });
    const claimed = new Set<string>();
    const claim = async (key: string, slot: number) => { const k = `${key}:${slot}`; if (claimed.has(k)) return false; claimed.add(k); return true; };
    const run = (at: number) => scheduledBoardNow(sagaEnv(db), deps(ai.fetcher, at), db, claim);
    await run(morning);
    expect(calls).toBe(1);
    await saveBoardMessage(db, { chatId: BOARD, messageId: 2, author: "Lisbeth", authorId: "201", text: "Ny", sentAtMs: morning + 2 * HOUR, fromAssistant: false });
    await run(morning + 3 * HOUR);
    await run(morning + 9 * HOUR);
    expect(calls).toBe(1);
    // The next morning, from seven - not before (06:59), and not at the weekend.
    await run(Date.parse("2026-10-09T04:59:00Z"));
    expect(calls).toBe(1);
    await run(Date.parse("2026-10-09T05:00:00Z"));
    expect(calls).toBe(2);
    await saveBoardMessage(db, { chatId: BOARD, messageId: 3, author: "Douglas", authorId: "203", text: "Weekend", sentAtMs: Date.parse("2026-10-10T05:30:00Z"), fromAssistant: false });
    await run(Date.parse("2026-10-10T06:00:00Z"));
    expect(calls).toBe(2);
  });

  it("shows the points on the front page, with a way on to Status", () => {
    const page = homePage("", { who: "Jacob", isChair: true, today: "2026-10-02", toSign: [], tasks: [], todos: [], forMe: [], next: null, found: [], summary: null, at: null,
      events: [], eventsMonth: 0, progress: { working: 0, waiting: 0 }, latest: null, boardNow: { text: "Udlejeren varsler huslejestigning.", at: NOW },
      picture: { summary: "", temperature: { level: "god", why: "Gammel" }, topics: [{ title: "Thomas Emil-håndtering", status: "afventer", who: [], waitsOnJacob: true, note: "" }], document: {} as never, forJacob: [] } } as never);
    expect(page).toContain("Udlejeren varsler huslejestigning.");
    expect(page).toContain('<p class="now">Udlejeren varsler huslejestigning.</p>');
    // The six-hour picture stays on Status: no stale "venter på dig" here.
    expect(page).not.toContain("Thomas Emil-håndtering");
    expect(page).toContain('href="/status">Mere i Status →');
  });
});
