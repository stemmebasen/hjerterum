import { afterEach, describe, expect, it, vi } from "vitest";
import { deps, fakeServices, sagaEnv, testDatabase } from "../saga/test-support.js";
import { connectSocial, scanTags, socialPosts } from "./social.js";
import { prPlanData } from "../cockpit/prPlan.js";
import { prPage } from "../cockpit/prPage.js";

// Requested (the chair, 3 Nov 2026): "Hvordan ved jeg, at disse ikke allerede er delt, dem, hun foreslår?" - "'Allerede delt' - eller bedre: 'Delt d. *dato*'".
const GRAPH = "https://graph.facebook.com/v25.0";
const NOW = Date.parse("2026-11-03T20:00:00Z");

describe("a tagged post Hjerterum has already shared", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is shown 'Delt d. <dato>', and is not news for the chair", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices({ ai: () => "Tak for at dele." });
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key" } as never);
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "t", igUserId: "17841", igUsername: "hjerterum_aarhus" }, "Jacob Hauge", NOW);
    const json = (data: unknown) => new Response(JSON.stringify(data));
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (!url.startsWith(GRAPH)) return services.fetcher(input, init);
      const path = url.slice(GRAPH.length).split("?")[0];
      if (path === "/755/tagged") return json({ data: [
        { id: "111_222", message: "Workshop", permalink_url: "https://www.facebook.com/kasper/posts/222", from: { name: "Kasper" }, created_time: "2026-11-01T10:00:00+0000" },
        { id: "111_333", message: "Dans", permalink_url: "https://www.facebook.com/kasper/posts/333", from: { name: "Kasper" }, created_time: "2026-11-02T10:00:00+0000" }] });
      // Gitta shared the first by hand the day after.
      if (path === "/755/posts") return json({ data: [{ created_time: "2026-11-02T08:00:00+0000", message: "Skønne Kasper", attachments: { data: [{ target: { id: "111_222" } }] } }] });
      if (path === "/17841/tags") return json({ data: [{ id: "ig-1", media_type: "IMAGE", media_url: "https://cdn.example/x.jpg", username: "gitta.dans", caption: "Dans", timestamp: "2026-11-01T09:00:00+0000" }] });
      if (path === "/17841/media") return json({ data: [{ caption: "Skøn aften. Foto og tekst: @gitta.dans", timestamp: "2026-11-02T18:00:00+0000" }] });
      return json({ data: [] });
    };
    expect(await scanTags(env as never, deps(fetcher, NOW), db)).toBe(3);
    const shares = await socialPosts(db, "kind = 'share'");
    expect(shares.find(p => p.source.id === "111_222")!.source.sharedAt).toBe(Date.parse("2026-11-02T08:00:00Z"));
    expect(shares.find(p => p.source.id === "111_333")!.source.sharedAt).toBeNull();
    expect(shares.find(p => p.source.id === "ig-1")!.source.sharedAt).toBe(Date.parse("2026-11-02T18:00:00Z"));
    // The chair is told of the one that is new, and only that one waits for him.
    expect(services.telegram("sendMessage").map(c => (c.body as { text: string }).text)).toEqual([expect.stringContaining("Ét nyt opslag har tagget Hjerterum")]);
    expect((await prPlanData(db, { ready: true, account: null, nowMs: NOW })).todo.map(t => t.text)).toContain("Ét opslag, Hjerterum er tagget i, venter på dig.");
    const html = prPage("", "Jacob Hauge", { ready: true, account: null, shares, weeks: [], week: { monday: "2026-11-09", key: "2026-W46", posts: [] }, recent: [], aiReady: true,
      plan: { todo: [], next: [], campaign: { now: null, next: { months: [1], title: "x", about: "x" } } }, insight: [], nowMs: NOW, notice: "", error: "" });
    expect(html).toContain("Delt d. 2. nov.");
    expect(html).toContain("Hjerterum har allerede delt det d. 2. nov.");
  });
});
