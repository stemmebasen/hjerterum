import { longWhen, withEventDate } from "./plan.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "../cockpit/handler.js";
import { BOARD, deps, fakeServices, OWNER, personalCookie, sagaEnv, testDatabase } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";
import { setSiteLive } from "../public-site.js";
import { connectSocial, socialPost } from "./social.js";
import { proposeWords, withSignUp, WRITER_MODEL } from "./writer.js";

// Requested (the chair, 5 Nov 2026): "Jeg vil gerne have en mulighed for, at AI kan komme med et forslag til delingsteksten. Det skal være en meget moderne
// sprogmodel, der skriver på en moderne måde, som passer til de forskellige medier, til hjerterums stil og gerne på nye spændende og kærlige måder - ikke kliche".
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-11-05T09:00:00Z");
const HEX = "0123456789abcdef01234567";
const WORDS = { facebook: "Gongen fylder rummet, og du må bare ligge. Kasper spiller lørdag d. 7. november kl. 13.00.", instagram: "Du må gerne komme træt.\n\nKasper spiller gongs lørdag d. 7. november kl. 13.00.\n\n#aarhus #lydhealing" };

async function setup(ai: (system: string, user: string) => string = () => JSON.stringify(WORDS)) {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
  const db = testDatabase();
  await setSiteLive(db, true, "test", 0);
  const services = fakeServices({ ai });
  const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key" } as never);
  await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "t", igUserId: "17841", igUsername: "hjerterum_aarhus" }, "Jacob Hauge", 0);
  await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Jacob Hauge", authorId: OWNER, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
  await db.prepare(`INSERT INTO house_events (id, title, starts_at_ms, host, image_url, content_hash, updated_at_ms, description, category) VALUES (?, 'Lydhealing', ?, 'Kasper Holm', 'https://d1tif55lvfk8gc.cloudfront.net/a.jpg', 'x', 0, '<p>Gongs og syngeskåle. Medbring et tæppe.</p>', 'Lyd')`)
    .bind(`SF${HEX}`, NOW + 2 * 86_400_000).run();
  await db.prepare(`INSERT INTO social_posts (kind, source_key, week, channels, text, link, images, source, publish_at_ms, status, created_at_ms, updated_at_ms)
    VALUES ('event', 'event:2026-W45:mw:SF${HEX}', '2026-W45', '["facebook","instagram"]', 'Lydhealing med Kasper - lørdag kl. 13.00.', 'https://www.hjerterum.info/events/a', '["https://d1tif55lvfk8gc.cloudfront.net/a.jpg"]', ?, ?, 'draft', 0, 0)`)
    .bind(JSON.stringify({ key: `mw:SF${HEX}`, title: "Lydhealing", startsMs: NOW + 2 * 86_400_000, host: "Kasper Holm", instagramText: "Lydhealing med Kasper.\n\nLæs mere og tilmeld dig via linket i bio." }), NOW + 86_400_000).run();
  const cookie = await personalCookie("Jacob Hauge", NOW);
  const call = (path: string, init: RequestInit = {}) => handleCockpitRequest(new Request(ORIGIN + path, { ...init, headers: { cookie, ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.headers as Record<string, string> ?? {}) } }), env, deps(services.fetcher, NOW));
  const models = () => services.calls.filter(c => c.url.endsWith("/chat/completions")).map(c => (c.body as { model: string }).model);
  return { db, env, services, call, models };
}

describe("Saga's proposal for a post's words", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is written by the writer model from the event's own description, each medium in its form, and changes nothing until the chair saves", async () => {
    let seen = { system: "", user: "" };
    const { db, env, services, models } = await setup((system, user) => { seen = { system, user }; return `Her er den:\n${JSON.stringify(WORDS)}`; });
    const post = (await socialPost(db, 1))!;
    const words = await proposeWords(env, deps(services.fetcher, NOW), db, post, "mere legende");
    expect(models()).toEqual([WRITER_MODEL]);
    expect(seen.system).toContain("Undgå klicheer");
    expect(seen.user).toContain("Gongs og syngeskåle. Medbring et tæppe.");
    expect(seen.user).toContain("Kategori: Lyd.");
    expect(seen.user).toContain('"underviser":"Kasper"');
    expect(seen.user).toContain("lørdag d. 7. november kl. 10.00");
    expect(seen.user).toContain("Formandens ønske til denne version: mere legende");
    expect(seen.user).toContain("Lydhealing med Kasper - lørdag kl. 13.00.");
    expect(words).toEqual({ text: WORDS.facebook,
      instagramText: "Du må gerne komme træt.\n\nKasper spiller gongs lørdag d. 7. november kl. 13.00.\n\nLæs mere og tilmeld dig via linket i bio.\n\n#aarhus #lydhealing" });
    expect((await socialPost(db, 1))!.text).toBe(post.text);
  });

  it("falls back to the usual model when the writer's does not answer, and says so when none does", async () => {
    const { db, env, services, models } = await setup();
    const fetcher: typeof fetch = async (input, init) => String(input).endsWith("/chat/completions") && JSON.parse(String(init?.body)).model === WRITER_MODEL
      ? new Response(JSON.stringify({ error: "no such model" }), { status: 404 }) : services.fetcher(input, init);
    expect((await proposeWords(env, deps(fetcher, NOW), db, (await socialPost(db, 1))!))?.text).toBe(WORDS.facebook);
    expect(models()).toEqual([env.AI_MODEL]);
    const none = await setup(() => "ingen json");
    expect(await proposeWords(none.env, deps(none.services.fetcher, NOW), none.db, (await socialPost(none.db, 1))!)).toBeNull();
  });

  it("is asked for from Ugens opslag and the studio", async () => {
    const { call } = await setup();
    const page = await (await call("/pr/uge?uge=2026-11-02")).text();
    expect(page).toContain('data-forslag="1"');
    expect(page).toContain('name="instagram_text"');
    const form = new FormData(); form.append("onske", "kortere");
    const fromPr = await call("/pr/opslag/1/forslag", { method: "POST", body: form, headers: { accept: "application/json" } });
    expect(await fromPr.json()).toMatchObject({ text: WORDS.facebook });
    const fromStudio = await call(`/plakater/${HEX}/tekst`, { method: "POST", body: JSON.stringify({ wish: "" }), headers: { "content-type": "application/json" } });
    expect(await fromStudio.json()).toMatchObject({ text: WORDS.facebook, instagramText: expect.stringContaining("via linket i bio.") });
  });

  it("puts where to sign up above the hashtags", () => {
    expect(withSignUp("Kom.\n\n#aarhus #yoga")).toBe("Kom.\n\nLæs mere og tilmeld dig via linket i bio.\n\n#aarhus #yoga");
    expect(withSignUp("Kom.")).toBe("Kom.\n\nLæs mere og tilmeld dig via linket i bio.");
  });
});

describe("the event's day in the words", () => {
  // Reported (the chair, 6 Nov 2026): "Det er en fejl, at der bare står lørdag klokken 10:30, da det først er lørdagen efter."
  const SAT = Date.parse("2026-11-21T09:30:00Z");
  it("puts the date beside the event's weekday, once", () => {
    expect(withEventDate("Lørdag kl. 10.30 guider Mette dig i kurset.", SAT)).toBe("Lørdag d. 21. november kl. 10.30 guider Mette dig i kurset.");
    expect(withEventDate("Kom på lørdag, når Mette guider.", SAT)).toBe("Kom på lørdag d. 21. november, når Mette guider.");
    expect(withEventDate("Lørdag d. 21. november kl. 10.30 guider Mette.", SAT)).toBe("Lørdag d. 21. november kl. 10.30 guider Mette.");
    expect(withEventDate("Lørdag 21/11 kl. 10.30.", SAT)).toBe("Lørdag 21/11 kl. 10.30.");
    // Another day, or none: as it was.
    expect(withEventDate("Om en uge tegner vi sammen.", SAT)).toBe("Om en uge tegner vi sammen.");
    expect(withEventDate("Søndag hviler vi.", SAT)).toBe("Søndag hviler vi.");
    expect(longWhen(SAT)).toBe("lørdag d. 21. november kl. 10.30");
  });
});
