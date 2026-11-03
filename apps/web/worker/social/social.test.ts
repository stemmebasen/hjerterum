import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "../cockpit/handler.js";
import { BOARD, deps, fakeServices, OWNER, personalCookie, sagaEnv, testDatabase, memberCookie } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";
import type { NewsletterEvent } from "../newsletter.js";
import { at, eventPostTimes, mondayOf, nextMonday, pickWeekEvents, planDue, weekKey } from "./plan.js";
import { runSocialJob, socialPosts } from "./social.js";
import { loginUrl } from "./meta.js";
import { instagramName, parsePrQuotes } from "../../pr-material.js";

// Requested (the chair, 3 Nov 2026): "Vi skal lave et PR-cockpit i admin, som kun formanden har adgang til i begyndelsen. Så vi skal have kontakt
// til vores sociale medier. ... 1 Videredele opslag som undervisere laver og tagger os i. 2 Dele 7-10 begivenheder pr uge direkte på fb, bare med
// et lille opslag. 3 ugens events på SoMe".

const ORIGIN = "https://admin.hjerterum.example";
// Thursday 5 November 2026, 10.00 in Copenhagen: the day next week (46, from Monday 9 November) is planned.
const NOW = Date.parse("2026-11-05T09:00:00Z");
const GRAPH = "https://graph.facebook.com/v25.0";

const event = (key: string, title: string, iso: string, extra: Partial<NewsletterEvent> = {}): NewsletterEvent => ({
  key, title, startsMs: Date.parse(iso), endsMs: null, host: "Kasper", category: null, imageUrl: `https://img.example/${key}.jpg`, link: `https://www.hjerterum.info/events/${key}`,
  description: "", mornings: false, ...extra });

describe("an Instagram name in the PR material", () => {
  it("is kept as the bare username, whatever way it is written", () => {
    for (const written of ["@Anna.Yoga", "anna.yoga", "https://www.instagram.com/anna.yoga/", "instagram.com/anna.yoga?hl=da"]) expect(instagramName(written)).toBe("anna.yoga");
    expect(instagramName("Anna Yoga")).toBeNull();
    expect(parsePrQuotes({ instagram: "@Anna.Yoga" }).instagram).toBe("anna.yoga");
    expect(parsePrQuotes({ facilitator: "Ro" })).toMatchObject({ facilitator: "Ro", instagram: "" });
  });
});

describe("the week's plan", () => {
  it("knows the weeks and Thursday from 10.00", () => {
    expect(mondayOf(NOW)).toBe("2026-11-02");
    expect(nextMonday(NOW)).toBe("2026-11-09");
    expect(weekKey("2026-11-09")).toBe("2026-W46");
    expect(weekKey("2026-12-28")).toBe("2026-W53");
    expect(planDue(NOW)).toBe(true);
    expect(planDue(NOW - 2 * 3_600_000)).toBe(false);
    expect(planDue(Date.parse("2026-11-03T12:00:00Z"))).toBe(false);
    // Danish time on both sides of the change from summer time.
    expect(new Date(at("2026-10-24", 10)).toISOString()).toBe("2026-10-24T08:00:00.000Z");
    expect(new Date(at("2026-10-26", 10)).toISOString()).toBe("2026-10-26T09:00:00.000Z");
  });

  it("picks at most ten, one per title, wished and workshops before the morning programme", () => {
    const events = [
      ...Array.from({ length: 11 }, (_, i) => event(`mw:e${i}`, `Workshop ${i}`, `2026-11-${String(9 + (i % 7)).padStart(2, "0")}T18:00:00Z`)),
      event("mw:yoga1", "Yoga | Hjerterum", "2026-11-10T08:00:00Z"), event("mw:yoga2", "Yoga | Hjerterum", "2026-11-12T08:00:00Z"),
      event("mw:m1", "Hjerterum Mornings", "2026-11-11T07:00:00Z", { mornings: true }),
      event("mw:wish", "Lydhealing", "2026-11-14T18:00:00Z", { imageUrl: null, host: null, mornings: true })
    ];
    const chosen = pickWeekEvents(events, new Set(["mw:wish"]));
    expect(chosen).toHaveLength(10);
    expect(chosen.map(e => e.key)).toContain("mw:wish");
    expect(chosen.map(e => e.key)).not.toContain("mw:m1");
    expect(chosen.filter(e => e.title.startsWith("Yoga")).length).toBeLessThanOrEqual(1);
    expect([...chosen].sort((a, b) => a.startsMs - b.startsMs)).toEqual(chosen);
    // A quiet week: all of it.
    expect(pickWeekEvents(events.slice(0, 4), new Set())).toHaveLength(4);
  });

  it("posts each event the day before at 15.00, 16.00 or 17.00, three a day at most, never after it begins", () => {
    const chosen = [event("a", "A", "2026-11-10T18:00:00Z"), event("b", "B", "2026-11-10T19:00:00Z"), event("c", "C", "2026-11-10T20:00:00Z"), event("d", "D", "2026-11-09T07:30:00Z")];
    const times = eventPostTimes(chosen, NOW);
    expect(times.map(t => new Date(t).toISOString())).toEqual(["2026-11-09T14:00:00.000Z", "2026-11-09T15:00:00.000Z", "2026-11-09T16:00:00.000Z", "2026-11-08T14:00:00.000Z"]);
    expect(new Set(times).size).toBe(times.length);
    times.forEach((t, i) => expect(t).toBeLessThan(chosen[i]!.startsMs));
  });
});

describe("the PR cockpit", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function setup(extra: Record<string, string> = {}) {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices({ ai: system => system.includes("Ugens events")
      ? JSON.stringify({ uge: "En uge med dans, stilhed og healing.", events: { E1: "Kasper guider os gennem en aften med indre ro. Mandag kl. 19.00." } })
      : "Tak til Kasper for at dele sin workshop." });
    const graph: Array<{ method: string; path: string; params: Record<string, string> }> = [];
    let tags = { facebook: [] as unknown[], instagram: [] as unknown[] };
    let media = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith("https://www.hjerterum.info") || url.startsWith("https://api.membershipworks.com")) return new Response("[]", { status: 404 });
      if (!url.startsWith(GRAPH)) return services.fetcher(input, init);
      const method = init?.method ?? "GET";
      const [path, query] = url.slice(GRAPH.length).split("?");
      const params = Object.fromEntries(new URLSearchParams(method === "GET" ? query : String(init?.body ?? "")));
      graph.push({ method, path: path!, params });
      const json = (data: unknown) => new Response(JSON.stringify(data));
      if (path === "/oauth/access_token") return json({ access_token: params.code ? "short" : "long-user" });
      if (path === "/me/accounts") return json({ data: [{ id: "999", name: "Noget andet", access_token: "other" }, { id: "755", name: "Hjerterum", access_token: "page-token", instagram_business_account: { id: "17841", username: "hjerterum_aarhus" } }] });
      if (path === "/755/tagged") return json({ data: tags.facebook });
      if (path === "/17841/tags") return json({ data: tags.instagram });
      if (path === "/ig-1") return json({ id: "ig-1", media_type: "IMAGE", media_url: "https://cdn.example/fresh.jpg", username: "gitta.dans", caption: "Dans", timestamp: "2026-11-05T08:00:00+0000" });
      if (path === "/755/feed" && method === "POST") return json({ id: `755_${graph.filter(c => c.path === "/755/feed").length}` });
      if (path === "/17841/media" && method === "POST") return json({ id: `c${++media}` });
      if (path === "/17841/media_publish") return json({ id: `m${media}` });
      if (/^\/c\d+$/.test(path!)) return json({ status_code: "FINISHED" });
      return new Response(JSON.stringify({ error: { message: "unexpected" } }), { status: 400 });
    };
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026", MAIL_ENCRYPTION_KEY: "a-long-enough-test-key", ...extra } as never);
    const call = (path: string, init: RequestInit & { cookie?: string; now?: number } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
      ...init, redirect: "manual", headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(fetcher, init.now ?? NOW));
    const form = (fields: Record<string, string | string[]>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) f.append(k, x); return f; };
    const session = ((await call("/login", { method: "POST", body: form({ password: "hjerte-2026" }) })).headers.get("set-cookie") ?? "").split(";")[0]!;
    for (const [i, [name, tid]] of ([["Jacob Hauge", OWNER], ["Lisbeth", "201"]] as const).entries())
      await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: tid, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
    const cookie = await personalCookie("Jacob Hauge", NOW);
    const run = (now: number) => runSocialJob(env as never, deps(fetcher, now));
    return { db, env, call, form, session, cookie, graph, services, run, setTags: (t: typeof tags) => { tags = t; } };
  }

  it("is the chair's alone, and says what is missing before Meta is set up", async () => {
    const { call, session, cookie } = await setup();
    const lisbeth = await memberCookie(session, "Lisbeth");
    expect((await call("/pr", { cookie: lisbeth })).status).toBe(403);
    expect(await (await call("/posthus", { cookie: lisbeth })).text()).not.toContain('href="/pr"');
    expect(await (await call("/posthus", { cookie })).text()).toContain('href="/pr"');
    const page = await call("/pr", { cookie });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("META_APP_ID");
  });

  it("connects, passes on what Hjerterum is tagged in once, and plans, approves and posts the week", async () => {
    const { db, call, form, cookie, graph, services, run, setTags } = await setup({ META_APP_ID: "app-1", META_APP_SECRET: "app-secret" });
    // Facebook Login, with a state only this browser knows.
    const start = await call("/pr/forbind", { cookie });
    const location = new URL(start.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://www.facebook.com/v25.0/dialog/oauth");
    expect(location.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/pr/forbind/svar`);
    expect(location.searchParams.get("scope")).toContain("pages_manage_posts");
    const state = location.searchParams.get("state")!;
    const stateCookie = `hr_social_state=${state}`;
    expect(start.headers.get("set-cookie")).toContain(stateCookie);
    expect((await call(`/pr/forbind/svar?code=abc&state=wrong`, { cookie: `${cookie}; ${stateCookie}` })).headers.get("location")).toBe("/pr?fejl=login");
    expect((await call(`/pr/forbind/svar?code=abc&state=${state}`, { cookie: `${cookie}; ${stateCookie}` })).headers.get("location")).toBe("/pr?besked=forbundet");
    const account = await db.prepare("SELECT page_id, page_name, page_token_sealed, ig_username FROM social_account").first<Record<string, string>>();
    expect(account).toMatchObject({ page_id: "755", page_name: "Hjerterum", ig_username: "hjerterum_aarhus" });
    expect(account!.page_token_sealed).not.toContain("page-token");
    expect((await (await call("/pr", { cookie })).text())).toContain("@hjerterum_aarhus");

    // 1. Tagged on Facebook and on Instagram: drafts with Saga's words, and the chair told once.
    setTags({
      facebook: [{ id: "fb-1", message: "Workshop på lørdag i Hjerterum", permalink_url: "https://www.facebook.com/kasper/posts/1", from: { name: "Kasper Holm" }, created_time: "2026-11-05T08:00:00+0000" }],
      instagram: [{ id: "ig-1", media_type: "IMAGE", media_url: "https://cdn.example/old.jpg", username: "gitta.dans", caption: "Dans", permalink: "https://instagram.com/p/1", timestamp: "2026-11-05T08:00:00+0000" },
        { id: "ig-2", media_type: "VIDEO", media_url: "https://cdn.example/v.mp4", username: "x", caption: "", timestamp: "2026-11-05T08:00:00+0000" }]
    });
    await run(NOW + 60_000);
    let shares = await socialPosts(db, "kind = 'share'");
    expect(shares).toHaveLength(3);
    expect(shares.find(p => p.source.id === "fb-1")).toMatchObject({ status: "draft", channels: ["facebook"], text: "Tak til Kasper for at dele sin workshop.", link: "https://www.facebook.com/kasper/posts/1" });
    // "simultant på begge medier, når som helst det er muligt": a photo goes to both from the start.
    expect(shares.find(p => p.source.id === "ig-1")).toMatchObject({ channels: ["facebook", "instagram"] });
    expect(shares.find(p => p.source.id === "ig-1")!.source.instagramText).toContain("Foto og tekst: @gitta.dans");
    // A video cannot go up again on Instagram: it is offered as a link on Facebook.
    expect(shares.find(p => p.source.id === "ig-2")).toMatchObject({ channels: ["facebook"] });
    expect(services.telegram("sendMessage").filter(c => JSON.stringify(c.body).includes("tagget Hjerterum"))).toHaveLength(1);
    // Looked for again: nothing twice.
    await run(NOW + 31 * 60_000);
    expect(await socialPosts(db, "kind = 'share'")).toHaveLength(3);
    expect(graph.filter(c => c.method === "POST")).toHaveLength(0);

    // The chair passes two of them on; the third is skipped.
    const fb = shares.find(p => p.source.id === "fb-1")!, ig = shares.find(p => p.source.id === "ig-1")!, video = shares.find(p => p.source.id === "ig-2")!;
    await call(`/pr/opslag/${fb.id}`, { method: "POST", cookie, body: form({ do: "godkend", text: "Tak, Kasper!", channel: "facebook", kanaler: "1" }) });
    await call(`/pr/opslag/${ig.id}`, { method: "POST", cookie, body: form({ do: "godkend", text: "Tak, Gitta.", instagram_text: "Tak, Gitta.\n\nFoto og tekst: @gitta.dans", channel: "instagram", kanaler: "1" }) });
    await call(`/pr/opslag/${video.id}`, { method: "POST", cookie, body: form({ do: "spring" }) });
    await run(NOW + 2 * 60_000);
    await run(NOW + 3 * 60_000);
    expect(graph.filter(c => c.path === "/755/feed")).toEqual([{ method: "POST", path: "/755/feed", params: { message: "Tak, Kasper!", link: "https://www.facebook.com/kasper/posts/1", access_token: "page-token" } }]);
    // On Instagram from the picture as it is now, with the chair's words.
    expect(graph.find(c => c.path === "/17841/media" && c.method === "POST")!.params).toMatchObject({ image_url: "https://cdn.example/fresh.jpg", caption: "Tak, Gitta.\n\nFoto og tekst: @gitta.dans", collaborators: '["gitta.dans"]' });
    expect(graph.filter(c => c.path === "/17841/media_publish")).toHaveLength(1);
    shares = await socialPosts(db, "kind = 'share'");
    expect(shares.map(p => p.status).sort()).toEqual(["published", "published", "skipped"]);
    expect((await call(`/pr/opslag/${fb.id}`, { method: "POST", cookie, body: form({ do: "godkend", text: "Igen" }) })).headers.get("location")).toBe("/pr/tagget?fejl=sendt");

    // 2 and 3. Next week: twelve events in the house (one a partner's), planned on Thursday from 10.00.
    const insert = (id: string, title: string, iso: string, extra: { location?: string; image?: string | null } = {}) =>
      db.prepare("INSERT INTO house_events (id, title, starts_at_ms, host, image_url, location, description, content_hash, updated_at_ms) VALUES (?, ?, ?, 'Kasper', ?, ?, 'En aften med ro.', 'x', 0)")
        .bind(id, title, Date.parse(iso), extra.image === undefined ? `https://d1tif55lvfk8gc.cloudfront.net/${id}.jpg` : extra.image, extra.location ?? null).run();
    // Kasper has given his Instagram name with his PR material: he is invited as collaborator on "Ugens events".
    await db.prepare(`INSERT INTO pr_material (clerk_user_id, quotes_json, consent_at_ms, updated_at_ms) VALUES ('user_k', '{"instagram":"kasper.yoga"}', 1, 0)`).run();
    await db.prepare(`INSERT INTO public_profiles (clerk_user_id, public_id, draft_json, updated_at_ms) VALUES ('user_k', 'k', '{"name":"Kasper"}', 0)`).run();
    for (let i = 0; i < 11; i++) await insert(`e${i}`, `Workshop ${i}`, `2026-11-${String(9 + (i % 7)).padStart(2, "0")}T${String(17 + (i % 3)).padStart(2, "0")}:00:00Z`);
    await insert("partner", "Hos Hjerteland", "2026-11-11T18:00:00Z", { location: "Hjerteland" });
    await insert("this-week", "I aften", "2026-11-05T18:00:00Z");
    await run(NOW + 61 * 60_000);
    const week = await socialPosts(db, "week = '2026-W46'", [], "CASE kind WHEN 'week' THEN 0 ELSE 1 END, publish_at_ms");
    expect(week.filter(p => p.kind === "week")).toHaveLength(1);
    // Every event of the week gets its post - "alle events deles mindst én gang".
    expect(week.filter(p => p.kind === "event")).toHaveLength(11);
    expect(week.every(p => p.status === "draft")).toBe(true);
    const weekly = week[0]!;
    expect(weekly.channels).toEqual(["facebook", "instagram"]);
    expect(weekly.text).toContain("Ugens events i Hjerterum · uge 46");
    expect(weekly.text).toContain("En uge med dans, stilhed og healing.");
    expect(weekly.text).not.toContain("Hjerteland");
    expect(weekly.source.instagramText).toContain("hjerterum.info/events (link i bio)");
    expect(new Date(weekly.publish_at_ms!).toISOString()).toBe("2026-11-09T14:30:00.000Z");
    expect(week[1]!.text).toBe("Kasper guider os gennem en aften med indre ro. Mandag kl. 19.00.");
    expect(services.telegram("sendMessage").filter(c => JSON.stringify(c.body).includes("uge 46"))).toHaveLength(1);
    // Planned once: Saga's next round does not plan it again.
    await run(NOW + 125 * 60_000);
    expect(await socialPosts(db, "week = '2026-W46'")).toHaveLength(12);

    // The chair moves one, approves the week, and the posts go out at their times - each once.
    const first = week[1]!;
    await call(`/pr/opslag/${first.id}`, { method: "POST", cookie, body: form({ do: "gem", text: "Rettet af formanden.", at: "2026-11-08T12:15" }) });
    expect((await call("/pr/uge/godkend", { method: "POST", cookie, body: form({ uge: "2026-11-09" }) })).headers.get("location")).toBe("/pr/uge?uge=2026-11-09&besked=uge-godkendt");
    expect((await socialPosts(db, "week = '2026-W46' AND status = 'approved'"))).toHaveLength(12);
    const before = graph.filter(c => c.path === "/755/feed").length;
    await run(Date.parse("2026-11-08T11:20:00Z"));
    const posted = graph.filter(c => c.path === "/755/feed").slice(before);
    expect(posted.map(c => c.params.message)).toContain("Rettet af formanden.");
    await run(Date.parse("2026-11-09T14:35:00Z"));
    await run(Date.parse("2026-11-09T14:40:00Z"));
    const weekOut = graph.filter(c => c.path === "/755/feed" && c.params.message?.startsWith("Ugens events"));
    expect(weekOut).toHaveLength(1);
    expect(weekOut[0]!.params.link).toBe("https://www.hjerterum.info/events");
    // Instagram: a carousel of the events' pictures.
    const carousel = graph.find(c => c.path === "/17841/media" && c.params.media_type === "CAROUSEL")!;
    expect(carousel.params.children!.split(",")).toHaveLength(10);
    expect(carousel.params.caption).toContain("hjerterum.info/events (link i bio)");
    expect(carousel.params.collaborators).toBe('["kasper.yoga"]');
    // A round at each post's time (the cron runs every five minutes): everything goes out, once.
    for (const due of (await socialPosts(db, "week = '2026-W46' AND status = 'approved'")).map(p => p.publish_at_ms!)) await run(due + 60_000);
    await run(Date.parse("2026-11-16T09:00:00Z"));
    const final = await socialPosts(db, "week = '2026-W46'");
    expect(final.filter(p => p.status === "published")).toHaveLength(12);
    expect(graph.filter(c => c.path === "/755/feed").length).toBe(1 + 12);
  });

  it("does not post an event late, and uses a Facebook Login for Business configuration when there is one", async () => {
    expect(new URL(loginUrl({ META_APP_ID: "a", META_LOGIN_CONFIG_ID: "cfg-7" }, "https://x/svar", "s")).searchParams.get("config_id")).toBe("cfg-7");
    const { db, call, cookie, form, graph, run } = await setup({ META_APP_ID: "app-1", META_APP_SECRET: "app-secret" });
    const start = new URL((await call("/pr/forbind", { cookie })).headers.get("location")!);
    await call(`/pr/forbind/svar?code=abc&state=${start.searchParams.get("state")}`, { cookie: `${cookie}; hr_social_state=${start.searchParams.get("state")}` });
    await db.prepare("INSERT INTO house_events (id, title, starts_at_ms, host, image_url, description, content_hash, updated_at_ms) VALUES ('m', 'Mandagsdans', ?, 'Kasper', NULL, '', 'x', 0)")
      .bind(Date.parse("2026-11-09T18:00:00Z")).run();
    await call("/pr/uge/planlaeg", { method: "POST", cookie, body: form({ uge: "2026-11-09" }) });
    const [weekly, single] = await socialPosts(db, "week = '2026-W46'", [], "CASE kind WHEN 'week' THEN 0 ELSE 1 END");
    // No picture: "Ugens events" only on Facebook.
    expect(weekly!.channels).toEqual(["facebook"]);
    await call("/pr/uge/godkend", { method: "POST", cookie, body: form({ uge: "2026-11-09" }) });
    // The round that should have sent it comes after the event has begun.
    await run(Date.parse("2026-11-09T19:00:00Z"));
    expect((await socialPosts(db, `id = ${single!.id}`))[0]).toMatchObject({ status: "skipped" });
    expect(graph.filter(c => c.path === "/755/feed" && !c.params.message?.startsWith("Ugens events"))).toHaveLength(0);
  });
});
