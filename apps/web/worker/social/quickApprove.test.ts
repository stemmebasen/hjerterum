import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "../cockpit/handler.js";
import { BOARD, deps, fakeServices, OWNER, personalCookie, sagaEnv, testDatabase } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";
import { askVideos, chooseVideoTemplate, connectSocial, notifyVideos, socialPost } from "./social.js";
import { quickLink, quickPath, quickPost } from "./quickLink.js";
import { templatesFor } from "./videoTemplates.js";

// Requested (the chair, 5 Nov 2026): "Glem musikken for nu. Men lav gerne delen med videoskabelon. Det skal fungere sådan at jeg kan klikke på sagas link
// i telegram og på et øjeblik godkende".
const ORIGIN = "https://admin.hjerterum.example";
const VIDEO = "https://www.hjerterum.info/api/social-reels/event-1-abcdef123456.mp4";
const NOW = Date.parse("2026-11-05T09:00:00Z");
const HEX = "0123456789abcdef01234567";

async function setup() {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
  const db = testDatabase();
  const services = fakeServices();
  const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key" } as never);
  await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "page-token", igUserId: "17841", igUsername: "hjerterum_aarhus" }, "Jacob Hauge", 0);
  await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Jacob Hauge", authorId: OWNER, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
  const add = async (key: string, title: string, at: number, source: Record<string, unknown>) => {
    await db.prepare(`INSERT INTO social_posts (kind, source_key, week, channels, text, link, images, source, publish_at_ms, status, created_at_ms, updated_at_ms)
      VALUES ('event', ?, '2026-W46', '["facebook","instagram"]', ?, 'https://www.hjerterum.info/events/a', '["https://d1tif55lvfk8gc.cloudfront.net/a.jpg"]', ?, ?, 'draft', 0, 0)`)
      .bind(`event:2026-W46:${key}`, `Kom til ${title.toLowerCase()}.`, JSON.stringify({ key, title, startsMs: at + 2 * 86_400_000, host: "Kasper", instagramText: `Kom til ${title.toLowerCase()}.\n\nlink i bio`, ...source }), at).run();
    return Number((await db.prepare("SELECT max(id) AS id FROM social_posts").first<{ id: number }>())!.id);
  };
  const dans = await add(`mw:SF${HEX}`, "Dans", NOW + 86_400_000, { video: VIDEO, videoTemplate: 1, videoAtMs: NOW - 86_400_000 });
  const yoga = await add("mw:SFb", "Yoga", NOW + 2 * 86_400_000, {});
  const at = (ms: number) => (path: string, init: RequestInit = {}) => handleCockpitRequest(new Request(ORIGIN + path, { ...init, headers: init.method === "POST" ? { origin: ORIGIN } : {} }), env, deps(services.fetcher, ms));
  return { db, env, services, dans, yoga, call: at(NOW), at };
}

const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };

describe("Saga's link to approve a post", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is signed for one post and three days", async () => {
    const { env } = await setup();
    const path = (await quickPath(env, 7, NOW))!;
    expect(await quickPost(env, path, NOW)).toBe(7);
    expect(await quickPost(env, path, NOW + 3 * 86_400_000 + 1)).toBeNull();
    expect(await quickPost(env, path.replace("/ok/7/", "/ok/8/"), NOW)).toBeNull();
    expect(await quickPost({ SAGA_TELEGRAM_BOT_TOKEN: "another" }, path, NOW)).toBeNull();
    expect(await quickLink(env, 7, NOW)).toMatch(/^https:\/\/admin\.hjerterum\.info\/ok\/7\/\d{13}\.[A-Za-z0-9_-]{43}$/);
  });

  it("tells the chair once when a video is ready, with a link per post", async () => {
    const { db, env, services } = await setup();
    expect(await notifyVideos(env, deps(services.fetcher, NOW), db)).toBe(1);
    const [sent] = services.telegram("sendMessage").map(c => c.body as { chat_id: string; text: string; parse_mode?: string });
    expect(sent).toMatchObject({ chat_id: OWNER, parse_mode: "HTML" });
    expect(sent!.text).toContain("Saga har lavet en video til Instagram");
    expect(sent!.text).toMatch(/▶ <a href="https:\/\/admin\.hjerterum\.info\/ok\/\d+\/\d{13}\.[A-Za-z0-9_-]{43}">Dans<\/a>/);
    // Once.
    expect(await notifyVideos(env, deps(services.fetcher, NOW + 600_000), db)).toBe(0);
    expect(services.telegram("sendMessage")).toHaveLength(1);
    // Untouched for Saga's re-timing.
    expect(await db.prepare("SELECT updated_at_ms = created_at_ms AS same FROM social_posts WHERE json_extract(source, '$.video') IS NOT NULL").first()).toEqual({ same: 1 });
  });

  it("shows the post without a login, and approves it with one press - as the chair; then on to the next proposal", async () => {
    const { db, env, dans, yoga, call } = await setup();
    const path = (await quickPath(env, dans, NOW))!;
    const shown = await call(path);
    // Reported (the chair, 10 Nov 2026): "Jeg kan ikke gå ind og godkende video forslag" - with "no-referrer" the browser sent the press with
    // "Origin: null", and admin refused it. "same-origin" lets the browser name admin as the sender (and still never hands the link to another site).
    expect(shown.headers.get("referrer-policy")).toBe("same-origin");
    const page = await shown.text();
    expect(page).toContain("<h1>Dans</h1>");
    expect(page).toContain(`<video class="q-media" src="${VIDEO}"`);
    expect(page).toContain("Skabelon 1: Organisk");
    expect(page).toContain('value="godkend"');
    // "hvornår en skabelon sidste gang er brugt, og til hvilket event"
    expect(page).toContain('<option value="3">3. Plakat · ikke brugt endnu</option>');
    expect(page).toMatch(/<option value="1" selected>1\. Organisk · sidst \d+\. \w+\.?: Dans<\/option>/);
    expect(page).toMatch(new RegExp(`href="/ok/${yoga}/\\d{13}\\.[A-Za-z0-9_-]{43}">Næste forslag`));
    // Opening it (or Telegram's preview) changes nothing.
    expect((await socialPost(db, dans))!.status).toBe("draft");
    const done = await call(path, { method: "POST", body: form({ handling: "godkend" }) });
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe(`${path}?besked=godkendt`);
    expect(await socialPost(db, dans)).toMatchObject({ status: "approved", approved_by: "Jacob Hauge" });
    expect(await db.prepare("SELECT member, detail FROM chair_audit ORDER BY id DESC").first()).toEqual({ member: "Jacob Hauge", detail: `Godkendte opslaget "Dans" via Sagas link` });
    const after = await (await call(`${path}?besked=godkendt`)).text();
    expect(after).toContain("Godkendt ✓");
    expect(after).toContain("Fortryd godkendelsen");
    // A wrong or old link opens nothing.
    expect((await call(path.replace(/\.[^.]+$/, ".AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"))).status).toBe(410);
    // A form from another site is refused.
    expect((await handleCockpitRequest(new Request(ORIGIN + path, { method: "POST", body: form({ handling: "spring" }), headers: { origin: "https://evil.example" } }), env, deps(fetch, NOW))).status).toBe(403);
    expect((await socialPost(db, dans))!.status).toBe("approved");
  });

  it("makes the video again in another template, and skips a post", async () => {
    const { db, env, dans, yoga, call, at } = await setup();
    const path = (await quickPath(env, dans, NOW))!;
    await call(path, { method: "POST", body: form({ handling: "godkend" }) });
    // Another template: the post is a proposal again, without its video, for the video job (video-events.yml).
    const asked = await call(path, { method: "POST", body: form({ handling: "skabelon", skabelon: "3" }) });
    expect(asked.headers.get("location")).toBe(`${path}?besked=skabelon`);
    const post = (await socialPost(db, dans))!;
    expect(post).toMatchObject({ status: "draft", approved_by: null });
    expect(post.source).toMatchObject({ videoTemplate: 3 });
    expect(post.source.video).toBeUndefined();
    // Not a template the post can have ("Citat" needs the teacher's sentence), and not too close to the event.
    expect(await chooseVideoTemplate(db, dans, 8, NOW)).toBe("template");
    expect(await chooseVideoTemplate(db, dans, 2, NOW + 2 * 86_400_000)).toBe("late");
    expect((await at(NOW + 2 * 86_400_000)(path, { method: "POST", body: form({ handling: "skabelon", skabelon: "2" }) })).headers.get("location")).toBe(`${path}?fejl=tid`);
    expect(templatesFor({ images: [], source: {} })).toEqual([2]);
    expect(templatesFor({ images: ["a.jpg"], source: { quote: "Mod", portrait: "p.jpg" } })).toEqual([1, 2, 3, 4, 5, 7, 8, 10]);
    const yogaPath = (await quickPath(env, yoga, NOW))!;
    await call(yogaPath, { method: "POST", body: form({ handling: "spring" }) });
    expect((await socialPost(db, yoga))!.status).toBe("skipped");
  });

  // Requested (the chair, 5 Nov 2026): "Er det muligt at få flere stills og video designs på kommando" - "Begge dele".
  it("makes more videos on command, in the templates least used, and lets the chair pick one", async () => {
    const { db, env, services, dans, call } = await setup();
    // Template 3 was used lately for another event: it comes last.
    await db.prepare("UPDATE social_posts SET source = json_set(source, '$.video', 'v', '$.videoTemplate', 3, '$.videoAtMs', ?) WHERE id <> ?").bind(NOW - 3_600_000, dans).run();
    const path = (await quickPath(env, dans, NOW))!;
    expect((await call(path, { method: "POST", body: form({ handling: "flere" }) })).headers.get("location")).toBe(`${path}?besked=flere`);
    expect((await socialPost(db, dans))!.source.videoAsk).toEqual({ atMs: NOW, templates: [2, 4, 5] });
    expect(await askVideos(db, dans, NOW)).toBe("busy");
    expect(await (await call(path)).text()).toContain("Saga laver 3 nye videoer (Organisk uden foto, Stribe, Polaroid)");
    // The video job lays them beside the post's own (video/jobs.mjs) ...
    for (const [t, v] of [[2, "https://www.hjerterum.info/api/social-reels/b.mp4"], [4, "https://www.hjerterum.info/api/social-reels/c.mp4"]] as const)
      await db.prepare(`UPDATE social_posts SET source = json_remove(json_set(source, '$.videoChoices', json(json_insert(coalesce(json_extract(source, '$.videoChoices'), '[]'), '$[#]', json(?)))), '$.videoAsk') WHERE id = ?`)
        .bind(JSON.stringify({ template: t, video: v, atMs: NOW + 600_000 }), dans).run();
    // ... and Saga tells the chair once.
    await notifyVideos(env, deps(services.fetcher, NOW + 600_000), db);
    const told = services.telegram("sendMessage").map(c => (c.body as { text: string }).text).filter(t => t.startsWith("De nye videoer er klar"));
    expect(told).toHaveLength(1);
    expect(told[0]).toContain(">Dans</a>");
    await notifyVideos(env, deps(services.fetcher, NOW + 1_200_000), db);
    expect(services.telegram("sendMessage").map(c => (c.body as { text: string }).text).filter(t => t.startsWith("De nye videoer er klar"))).toHaveLength(1);
    const page = await (await call(path)).text();
    expect(page).toContain("Andre videoer at vælge imellem");
    expect(page).toContain('<video src="https://www.hjerterum.info/api/social-reels/c.mp4"');
    await call(path, { method: "POST", body: form({ handling: "godkend" }) });
    expect((await call(path, { method: "POST", body: form({ handling: "vaelg", valg: "1" }) })).headers.get("location")).toBe(`${path}?besked=valgt`);
    expect(await socialPost(db, dans)).toMatchObject({ status: "draft", source: { video: "https://www.hjerterum.info/api/social-reels/c.mp4", videoTemplate: 4 } });
    // Not the same templates again.
    expect(await askVideos(db, dans, NOW)).toBe("ok");
    expect((await socialPost(db, dans))!.source.videoAsk!.templates).toEqual([1, 5, 7]);
  });

  // Requested (the chair, 5 Nov 2026): "Er det muligt at bruge disse skabeloner, med lidt bevægelse? Gerne i starten ... ryste, zoom eller slør ind".
  it("makes the chair's design a video with a marked start, to choose among the post's videos", async () => {
    const { db, env, dans, call } = await setup();
    await db.prepare(`INSERT INTO house_events (id, title, starts_at_ms, host, image_url, content_hash, updated_at_ms) VALUES (?, 'Dans', ?, 'Kasper', 'https://d1tif55lvfk8gc.cloudfront.net/a.jpg', 'x', 0)`)
      .bind(`SF${HEX}`, NOW + 3 * 86_400_000).run();
    const stored: string[] = [];
    const media = { put: async (k: string) => { stored.push(k); return {}; }, get: async () => null, delete: async () => undefined };
    const studioEnv = { ...env, EVENT_MEDIA: media } as never;
    const cookie = await personalCookie("Jacob Hauge", NOW);
    const post = (path: string, body: BodyInit) => handleCockpitRequest(new Request(ORIGIN + path, { method: "POST", body, headers: { cookie, origin: ORIGIN, "content-type": "image/jpeg" } }), studioEnv, deps(fetch, NOW));
    const jpg = new Uint8Array(4000); jpg.set([0xff, 0xd8, 0xff, 0xe0]);
    expect((await post(`/plakater/${HEX}/bevaegelse?effekt=dans`, jpg)).status).toBe(400);
    expect((await post(`/plakater/${HEX}/bevaegelse?effekt=ryst`, jpg)).status).toBe(200);
    expect(stored).toHaveLength(1);
    const asked = (await socialPost(db, dans))!.source.stillAsk!;
    expect(asked).toMatchObject({ atMs: NOW, effect: "ryst", image: expect.stringMatching(/^https:\/\/www\.hjerterum\.info\/api\/social-designs\/[0-9a-f]{32}\.jpg$/) });
    expect((await post(`/plakater/${HEX}/bevaegelse?effekt=zoom`, jpg)).status).toBe(422);
    const path = (await quickPath(env, dans, NOW))!;
    expect(await (await call(path)).text()).toContain("Saga laver dit design som video (Ryst)");
    // The video job lays it among the choices (video/jobs.mjs, composition "Still").
    await db.prepare(`UPDATE social_posts SET source = json_remove(json_set(source, '$.videoChoices', json(json_insert(coalesce(json_extract(source, '$.videoChoices'), '[]'), '$[#]', json(?)))), '$.stillAsk') WHERE id = ?`)
      .bind(JSON.stringify({ template: 0, effect: "ryst", video: "https://www.hjerterum.info/api/social-reels/design-1.mp4", atMs: NOW }), dans).run();
    expect(await (await call(path)).text()).toContain("Dit design · Ryst");
  });

  it("is chosen in the studio too", async () => {
    const { db, env, dans, call } = await setup();
    await db.prepare(`INSERT INTO house_events (id, title, starts_at_ms, host, image_url, content_hash, updated_at_ms) VALUES (?, 'Dans', ?, 'Kasper', 'https://d1tif55lvfk8gc.cloudfront.net/a.jpg', 'x', 0)`)
      .bind(`SF${HEX}`, NOW + 3 * 86_400_000).run();
    const cookie = await personalCookie("Jacob Hauge", NOW);
    const studio = (path: string, init: RequestInit = {}) => handleCockpitRequest(new Request(ORIGIN + path, { ...init, headers: { cookie, ...(init.method === "POST" ? { origin: ORIGIN, "content-type": "application/json" } : {}) } }), env, deps(fetch, NOW));
    const data = await (await studio(`/plakater/${HEX}/data`)).json() as { post: { videoTemplate: number; videoTemplates: Array<{ no: number; name: string; used: string }>; videoRemake: boolean } };
    expect(data.post).toMatchObject({ videoTemplate: 1, videoRemake: true });
    expect(data.post.videoTemplates.map(t => t.no)).toEqual([1, 2, 3, 4, 5, 7]);
    expect(data.post.videoTemplates[0]).toMatchObject({ used: expect.stringMatching(/^sidst 4\. nov\.: Dans$/) });
    expect(data.post.videoTemplates[1]).toMatchObject({ used: "ikke brugt endnu" });
    expect((await studio(`/plakater/${HEX}/video`, { method: "POST", body: JSON.stringify({ template: 5 }) })).status).toBe(200);
    expect((await socialPost(db, dans))!.source).toMatchObject({ videoTemplate: 5 });
    expect((await studio(`/plakater/${HEX}/video`, { method: "POST", body: JSON.stringify({ template: 9 }) })).status).toBe(422);
    void call;
  });
});
