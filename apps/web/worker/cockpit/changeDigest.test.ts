import { describe, expect, it } from "vitest";
import { changesSince, scheduledChangeDigest } from "./changeDigest.js";
import { deps, fakeServices, OWNER, sagaEnv, testDatabase } from "../saga/test-support.js";

// Asked (the chair, 26 Nov 2026): "Can Saga tell Douglas and I when a bunch of changes has been made on Telegram?"
const FIVE_PM = Date.parse("2026-11-26T16:00:00Z"); // 17.00 in Copenhagen
const LINES = ["2026-11-26 Tidligere events i kalenderen", "2026-11-26 Nye minimumspriser for ikke-medlemmer", "2026-11-25 Planlæggeren: tider tegnes om", "2026-11-10 Gammelt"];

describe("Saga's word on what is new", () => {
  it("tells only what has not been told: above the last one, or without a mark today's and yesterday's", () => {
    expect(changesSince(LINES, null, FIVE_PM)).toEqual(LINES.slice(0, 3));
    expect(changesSince(LINES, LINES[2]!, FIVE_PM)).toEqual(LINES.slice(0, 2));
    expect(changesSince(LINES, LINES[0]!, FIVE_PM)).toEqual([]);
    expect(changesSince(LINES, "2026-11-25 Something that has rolled off", FIVE_PM)).toEqual(LINES.slice(0, 2));
  });

  it("writes to the chair in Danish and to Douglas in English, once a day at 17, and never the same twice", async () => {
    const db = testDatabase();
    await db.prepare("INSERT INTO cockpit_login_links (token_hash, member, telegram_id, created_at_ms, expires_at_ms, code_hash, role) VALUES ('x', 'Douglas Crawford', '202', 1, 2, 'y', NULL)").run();
    const services = fakeServices({ ai: system => system.includes("på dansk") ? "Nyt i dag på Hjerterums sider:\n• Tidligere events kan ses i kalenderen" : "New today on Hjerterum's pages:\n• Past events can be seen in the calendar" });
    const env = sagaEnv(db);
    const claimed = new Set<string>();
    const claim = async (key: string, slot: number) => { const k = `${key}:${slot}`; if (claimed.has(k)) return false; claimed.add(k); return true; };
    // Not at another hour.
    expect(await scheduledChangeDigest(env, deps(services.fetcher, FIVE_PM - 3_600_000), db, claim, LINES)).toBe(0);
    expect(await scheduledChangeDigest(env, deps(services.fetcher, FIVE_PM), db, claim, LINES)).toBe(2);
    const sent = services.telegram("sendMessage").map(c => c.body as { chat_id: string; text: string });
    expect(sent.find(b => String(b.chat_id) === OWNER)!.text).toContain("Tidligere events kan ses");
    expect(sent.find(b => String(b.chat_id) === "202")!.text).toContain("Past events can be seen");
    // The next day, with nothing new: nothing.
    expect(await scheduledChangeDigest(env, deps(services.fetcher, FIVE_PM + 86_400_000), db, claim, LINES)).toBe(0);
    // And with one new change: only that one is asked about.
    const asked: string[] = [];
    const later = fakeServices({ ai: (_s, user) => { asked.push(user); return "Nyt:\n• Én ting"; } });
    expect(await scheduledChangeDigest(env, deps(later.fetcher, FIVE_PM + 2 * 86_400_000), db, claim, ["2026-11-28 Én ny ting", ...LINES])).toBe(2);
    expect(asked.every(text => text === "2026-11-28 Én ny ting")).toBe(true);
  });
});
