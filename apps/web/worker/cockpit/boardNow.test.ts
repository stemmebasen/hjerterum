import { describe, expect, it } from "vitest";
import { latestBoardNow, scheduledBoardNow, writeBoardNow } from "./boardNow.js";
import { saveMeeting } from "./data.js";
import { homePage } from "./home.js";
import { claimJob, insertMail, queueMinutes, saveBoardMessage, updateMinutes } from "../saga/store.js";
import { BOARD, deps, fakeServices, sagaEnv, testDatabase } from "../saga/test-support.js";

// Requested: "\"Bestyrelsen lige nu\" virker ikke. Her skal Saga en gang i timen lave et resume og overblik over hvad der
// rører sig netop nu med basis i Telegram, vigtige mails og fra mødet (hvis det er mindre end 48 timer siden)" -
// "Man kan så klikke videre og få et mere detaljeret blik i Status".
const NOW = Date.parse("2026-10-02T10:00:00Z"); // Friday 12:00 in Copenhagen
const HOUR = 3_600_000;

describe("Bestyrelsen lige nu", () => {
  it("sums up the group, team@ and a meeting within 48 hours - hourly on weekdays, only when something is new", async () => {
    const db = testDatabase();
    await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Gitta", authorId: "202", text: "Skal vi rykke julefesten?", sentAtMs: NOW - 2 * HOUR, fromAssistant: false });
    await saveBoardMessage(db, { chatId: BOARD, messageId: 2, author: "Douglas", authorId: "203", text: "Gammel besked", sentAtMs: NOW - 5 * 24 * HOUR, fromAssistant: false });
    await insertMail(db, { ref: "m1", sender: "Udlejer", subject: "Varsel om husleje", receivedAtMs: NOW - HOUR, preview: "Huslejen stiger.", nowMs: NOW });
    const minutes = (await queueMinutes(db, { source: "upload", fileId: "f", fileName: "m.m4a", mimeType: null, meetingDate: "2026-10-01", nowMs: NOW - 20 * HOUR }))!;
    await updateMinutes(db, minutes, { status: "drafted", draft: "# Referat\n## Beslutninger\n- GF 14. okt. forberedes" }, NOW - 18 * HOUR);
    await saveMeeting(db, { date: "2026-09-17", time: "", place: "", agenda: "Gammelt møde" }, "Jacob", NOW - 15 * 24 * HOUR);
    let input = "", calls = 0;
    const ai = fakeServices({ ai: (_system, user) => { input = user; calls++; return "- Gitta spørger, om julefesten skal rykkes.\n- Udlejeren varsler huslejestigning.\n- GF 14. okt. forberedes efter mødet 1. okt."; } });
    expect(await writeBoardNow(sagaEnv(db), deps(ai.fetcher, NOW), db)).toBe(true);
    expect(input).toContain("Gitta: Skal vi rykke julefesten?");
    expect(input).not.toContain("Gammel besked");
    expect(input).toContain("Varsel om husleje");
    expect(input).toContain("GF 14. okt. forberedes");
    expect(input).not.toContain("Gammelt møde");
    expect((await latestBoardNow(db))?.points).toHaveLength(3);
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
    expect((await latestBoardNow(db))?.points[0]).toBe("Gitta spørger, om julefesten skal rykkes.");
  });

  it("shows the points on the front page, with a way on to Status", () => {
    const page = homePage("", { who: "Jacob", isChair: true, today: "2026-10-02", toSign: [], tasks: [], todos: [], forChair: [], next: null, found: [], picture: null, summary: null, at: null,
      events: [], eventsMonth: 0, progress: { working: 0, waiting: 0 }, latest: null, boardNow: { points: ["Udlejeren varsler huslejestigning."], at: NOW } } as never);
    expect(page).toContain("Udlejeren varsler huslejestigning.");
    expect(page).toContain("opdateret");
    expect(page).toContain('href="/status">Mere i Status →');
  });
});
