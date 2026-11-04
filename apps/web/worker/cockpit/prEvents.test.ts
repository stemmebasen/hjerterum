import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { BOARD, deps, fakeServices, OWNER, personalCookie, sagaEnv, testDatabase } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";
import { connectSocial, socialPosts } from "../social/social.js";

// Requested (the chair, 3 Nov 2026): "en eventoversigt over alle kommende events, med en PR-status i højre side samt nogle actionknapper".
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-11-05T09:00:00Z");

describe("PR og SoMe → Events", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows each coming event's PR status, and its buttons move it on", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices({ ai: () => "{}" });
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key", META_APP_ID: "a", META_APP_SECRET: "b" } as never);
    await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Jacob Hauge", authorId: OWNER, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "t", igUserId: null, igUsername: null }, "Jacob Hauge", NOW);
    const add = (id: string, title: string, days: number) => db.prepare(`INSERT INTO house_events (id, title, starts_at_ms, host, content_hash, updated_at_ms) VALUES (?, ?, ?, 'Kasper', 'x', 0)`).bind(id, title, NOW + days * 86_400_000).run();
    const hex = "0123456789abcdef01234567";
    await add(`SF${hex}`, "Lydhealing", 5);   // next week
    await add("SFb", "Dans", 20);             // in three weeks
    const call = (path: string, init: RequestInit = {}) => handleCockpitRequest(new Request(ORIGIN + path, { ...init, redirect: "manual",
      headers: { cookie: cookieValue, ...(init.method === "POST" ? { origin: ORIGIN } : {}) } }), env, deps(services.fetcher, NOW));
    const cookieValue = await personalCookie("Jacob Hauge", NOW);
    const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };

    let page = await (await call("/pr/events")).text();
    expect(page).toContain("Kommende events (2)");
    expect(page.match(/Intet opslag/g)).toHaveLength(2);
    expect(page.match(/Ingen Facebook-begivenhed/g)).toHaveLength(2);
    expect(page).toContain(`href="/plakater/${hex}?fra=%2Fpr%2Fevents"`);
    // "Lav opslag" for the week three weeks ahead.
    const later = "2026-11-23";
    expect((await call("/pr/events/opslag", { method: "POST", body: form({ uge: later }) })).headers.get("location")).toBe("/pr/events?besked=planlagt");
    const [post] = await socialPosts(db, "kind = 'event' AND json_extract(source, '$.key') = 'mw:SFb'");
    expect(post).toMatchObject({ status: "draft", week: "2026-W48" });
    // Approved from the list, and back to the list.
    expect((await call(`/pr/opslag/${post!.id}`, { method: "POST", body: form({ do: "godkend", tilbage: "events" }) })).headers.get("location")).toBe("/pr/events?besked=godkendt");
    // The Facebook event ticked from here, and back here.
    expect((await call("/arrangementer/facebook", { method: "POST", body: form({ event: "mw:SFb", done: "1", tilbage: "pr-events" }) })).headers.get("location")).toBe("/pr/events?besked=fb");
    page = await (await call("/pr/events")).text();
    expect(page).toContain("Opslag godkendt");
    expect(page).toContain("Facebook-begivenhed ✓");
    expect(page).toContain("1 mangler noget.");
    // A week outside the six weeks is not planned from here.
    expect((await call("/pr/events/opslag", { method: "POST", body: form({ uge: "2027-03-01" }) })).headers.get("location")).toBe("/pr/events");
  });
});
