import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { BOARD, deps, fakeServices, OWNER, personalCookie, sagaEnv, testDatabase } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";
import { connectSocial, socialPosts } from "../social/social.js";

// Requested (the chair, 11 Nov 2026): "gør det meget nemmere at slette events fra kalenderen ... Lige nu bliver jeg sendt frem og tilbage helt vilkårligt"
// and "Jeg har trykket 'spring over' flere gange, men de er stadig i kalenderen. De skal bare kunne slettes ganske simpelt."
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-11-11T09:00:00Z");
const AT = Date.parse("2026-11-13T17:00:00Z");

describe("deleting a post in the PR calendar", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function setup() {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices({ ai: () => "{}" });
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key" } as never);
    await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Jacob Hauge", authorId: OWNER, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "t", igUserId: "17841", igUsername: "hjerterum_aarhus" }, "Jacob Hauge", NOW);
    const insert = (key: string, status: string, source: Record<string, unknown>) => db.prepare(`INSERT INTO social_posts (kind, source_key, week, channels, text, images, source, publish_at_ms, status, created_at_ms, updated_at_ms)
      VALUES ('event', ?, '2026-W46', '["facebook"]', 'Tekst', '[]', ?, ?, ?, 0, 0)`).bind(key, JSON.stringify(source), AT, status).run();
    await insert("free:a", "draft", { free: true, title: "Konkurrence" });
    await insert("event:2026-W46:mw:SFa", "approved", { key: "mw:SFa", title: "Lydbad", startsMs: AT + 10 * 86_400_000, shouts: 2 });
    await insert("event:2026-W46:mw:SFa:2", "draft", { key: "mw:SFa", title: "Lydbad", startsMs: AT + 10 * 86_400_000, shout: 2 });
    await insert("free:b", "published", { free: true, title: "Hilsen" });
    const cookie = await personalCookie("Jacob Hauge", NOW);
    const call = (path: string, init: RequestInit = {}) => handleCockpitRequest(new Request(ORIGIN + path, { ...init, headers: { cookie, ...(init.method === "POST" ? { origin: ORIGIN } : {}) } }), env, deps(services.fetcher, NOW));
    const del = (id: number) => { const f = new FormData(); f.append("id", String(id)); f.append("start", "2026-11-09"); f.append("dag", "2026-11-13"); return call("/pr/kalender/slet", { method: "POST", body: f }); };
    return { db, call, del };
  }
  const byKey = async (db: ReturnType<typeof testDatabase>) => Object.fromEntries((await socialPosts(db, "1 = 1", [], "id")).map(p => [p.source_key, p.status]));

  it("has a delete button on each post not yet out, and none on what has gone out", async () => {
    const { db, call } = await setup();
    const page = await (await call("/pr/kalender?start=2026-11-09")).text();
    const ids = (await socialPosts(db, "1 = 1", [], "id")).map(p => p.id);
    expect(page.match(/action="\/pr\/kalender\/slet"/g)).toHaveLength(3);
    expect(page).toContain(`name="id" value="${ids[0]}"`);
    expect(page).not.toContain(`<input type="hidden" name="id" value="${ids[3]}"><input type="hidden" name="start"`);
    expect(page).toContain("Slette »Konkurrence« fra kalenderen?");
  });

  it("deletes the chair's own post, sets one of Saga's aside alone, and goes back to the same day", async () => {
    const { db, call, del } = await setup();
    const [own, first] = await socialPosts(db, "1 = 1", [], "id");
    const gone = await del(own!.id);
    expect(gone.headers.get("location")).toBe("/pr/kalender?start=2026-11-09&besked=slettet#dag-2026-11-13");
    expect(await byKey(db)).toEqual({ "event:2026-W46:mw:SFa": "approved", "event:2026-W46:mw:SFa:2": "draft", "free:b": "published" });
    await del(first!.id);
    // Only this one: the event's reminder stays.
    expect(await byKey(db)).toEqual({ "event:2026-W46:mw:SFa": "skipped", "event:2026-W46:mw:SFa:2": "draft", "free:b": "published" });
    const page = await (await call("/pr/kalender?start=2026-11-09&besked=slettet")).text();
    expect(page).toContain("Opslaget er slettet fra kalenderen.");
    expect(page.match(/action="\/pr\/kalender\/slet"/g)).toHaveLength(1);
  });

  it("never deletes what has gone out", async () => {
    const { db, del } = await setup();
    const [, , , sent] = await socialPosts(db, "1 = 1", [], "id");
    expect((await del(sent!.id)).headers.get("location")).toContain("fejl=sendt");
    expect((await byKey(db))["free:b"]).toBe("published");
  });

  it("deletes the chair's own post from its card in Ugens opslag", async () => {
    const { db, call } = await setup();
    const [own] = await socialPosts(db, "1 = 1", [], "id");
    expect(await (await call("/pr/uge?uge=2026-11-09")).text()).toContain("Slet opslaget");
    const f = new FormData(); f.append("do", "slet");
    await call(`/pr/opslag/${own!.id}`, { method: "POST", body: f });
    expect((await byKey(db))["free:a"]).toBeUndefined();
  });
});
