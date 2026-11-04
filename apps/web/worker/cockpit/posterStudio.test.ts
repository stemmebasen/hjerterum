import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { BOARD, deps, fakeServices, OWNER, personalCookie, sagaEnv, testDatabase, memberCookie } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";
import type { EventMediaBucket } from "../event-files.js";
import appWorker from "../index.js";
import site from "../config-entry.js";

// Requested (the chair, 3 Nov 2026): "de designskabeloner, vi har lavet til eventoprettelse, skal kun bruges i cockpittet, så man - eller det vil sige mig
// til at begynde med - kan bruge dem" and "Det er vigtigt, at jeg i cockpittet kan bruge alt det materiale, der er lagt op i forbindelse med eventet, og
// også har en sektion med alt fra den pågældende underviser."

const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-11-05T09:00:00Z");
const HEX = "0123456789abcdef01234567";
const PR_PHOTO = "11111111-2222-3333-4444-555555555555", PORTRAIT = "99999999-8888-7777-6666-555555555555";

function bucket() {
  const objects = new Map<string, Uint8Array<ArrayBuffer>>();
  const media = {
    async put(key: string, value: ArrayBuffer | ReadableStream | Uint8Array) { objects.set(key, value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value as Uint8Array)); return {}; },
    async get(key: string) { const v = objects.get(key); return v ? { body: new Blob([v]).stream(), size: v.byteLength, arrayBuffer: async () => v.buffer } : null; },
    async delete(key: string) { objects.delete(key); }
  };
  return { media: media as unknown as EventMediaBucket, objects };
}

/** A real 1920 × 1005 png header, so the design passes the size check. */
function png(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(64));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

describe("Plakater og opslag in admin", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function setup() {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices();
    const { media, objects } = bucket();
    const assets = { fetch: async () => new Response('<!doctype html><div id="root"></div><script type="module" src="/assets/index-abc.js"></script>', { headers: { "content-type": "text/html" } }) };
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026", EVENT_MEDIA: media, ASSETS: assets } as never);
    const call = (path: string, init: RequestInit & { cookie?: string } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
      ...init, redirect: "manual", headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, NOW));
    const form = new FormData(); form.append("password", "hjerte-2026");
    const session = ((await call("/login", { method: "POST", body: form })).headers.get("set-cookie") ?? "").split(";")[0]!;
    for (const [i, [name, tid]] of ([["Jacob Hauge", OWNER], ["Lisbeth", "201"]] as const).entries())
      await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: tid, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
    // Kasper's event in the house: a cover, a picture and a pdf among its files, and his own poster - and an older event of his with its photo.
    const booking = async (title: string, startsMs: number) => Number((await db.prepare(`INSERT INTO room_bookings (clerk_user_id, teacher_name, teacher_email, title, description, starts_at_ms, ends_at_ms, review_status, status, created_at_ms, updated_at_ms)
      VALUES ('user_kasper', 'Kasper Holm', 'k@example.dk', ?, 'En aften med ro.', ?, ?, 'approved', 'scheduled', 0, 0)`).bind(title, startsMs, startsMs + 7_200_000).run()).meta?.last_row_id);
    const id = await booking("Dhyana Yoga", NOW + 3 * 86_400_000);
    const older = await booking("Yoga i september", NOW - 60 * 86_400_000);
    const file = (bookingId: number, kind: string, name: string, type: string) => db.prepare(`INSERT INTO room_booking_files (room_booking_id, kind, r2_key, filename, content_type, size_bytes, uploaded_by, created_at_ms)
      VALUES (?, ?, ?, ?, ?, 10, 'user_kasper', 0)`).bind(bookingId, kind, `events/${bookingId}/${name}`, name, type).run();
    await file(id, "cover", "cover.jpg", "image/jpeg");
    await file(id, "file", "salen.png", "image/png");
    await file(id, "file", "program.pdf", "application/pdf");
    await file(older, "cover", "sept.jpg", "image/jpeg");
    await db.prepare(`INSERT INTO room_booking_posters (room_booking_id, r2_key, content_type, width, height, size_bytes, saga_note, uploaded_by, created_at_ms) VALUES (?, 'posters/x.jpg', 'image/jpeg', 1080, 1350, 10, NULL, 'user_kasper', 0)`).bind(id).run();
    await db.prepare(`INSERT INTO pr_material (clerk_user_id, quotes_json, consent_at_ms, updated_at_ms) VALUES ('user_kasper', ?, ?, 0)`)
      .bind(JSON.stringify({ facilitator: "Jeg guider med ro.", offering: "Yoga for alle.", participant: "Det gav mig ro.", participantName: "Mette" }), NOW - 86_400_000).run();
    await db.prepare(`INSERT INTO pr_photos (id, clerk_user_id, content_type, width, height, created_at_ms) VALUES (?, 'user_kasper', 'image/jpeg', 1600, 1600, 0)`).bind(PR_PHOTO).run();
    await db.prepare(`INSERT INTO public_profiles (clerk_user_id, public_id, draft_json, updated_at_ms) VALUES ('user_kasper', 'kasper', ?, 0)`).bind(JSON.stringify({ name: "Kasper Holm", photoUrl: `/api/profile-photos/${PORTRAIT}.jpg` })).run();
    // An event in the membership system's calendar, led by the same Kasper.
    await db.prepare(`INSERT INTO house_events (id, title, starts_at_ms, host, image_url, description, content_hash, updated_at_ms) VALUES (?, 'Lydhealing', ?, 'Kasper Holm', 'https://d1tif55lvfk8gc.cloudfront.net/lyd.jpg', '<p>Gongs og ro.</p>', 'x', 0)`)
      .bind(`SF${HEX}`, NOW + 5 * 86_400_000).run();
    objects.set(`pr/${PR_PHOTO}`, new Uint8Array(new ArrayBuffer(3)).map((_, i) => i + 1));
    return { db, call, session, id, older, objects, cookie: await personalCookie("Jacob Hauge", NOW) };
  }

  it("is the chair's alone", async () => {
    const { call, session, id } = await setup();
    const lisbeth = await memberCookie(session, "Lisbeth");
    for (const path of ["/plakater", `/plakater/h${id}`, `/plakater/h${id}/data`, `/plakater/billede/pr/${PR_PHOTO}`]) expect((await call(path, { cookie: lisbeth })).status).toBe(403);
    expect(await (await call("/arrangementer", { cookie: lisbeth })).text()).not.toContain('href="/plakater"');
  });

  it("lists the coming events and opens the studio behind the chair's login", async () => {
    const { call, cookie, id } = await setup();
    const list = await (await call("/plakater", { cookie })).text();
    expect(list).toContain(`href="/plakater/h${id}"`);
    expect(list).toContain(`href="/plakater/${HEX}"`);
    expect(list).not.toContain("Yoga i september");
    const shell = await call(`/plakater/h${id}`, { cookie });
    expect(await shell.text()).toContain('src="/assets/index-abc.js"');
    expect(shell.headers.get("content-security-policy")).toContain("script-src 'self'");
  });

  it("gathers everything from the event and from its teacher, served from admin's own address", async () => {
    const { call, cookie, id, older } = await setup();
    const data = await (await call(`/plakater/h${id}/data`, { cookie })).json() as Record<string, any>;
    expect(data.event).toMatchObject({ title: "Dhyana Yoga", host: "Kasper Holm", bookingId: id, design: null, lines: ["En aften med ro."] });
    expect(data.eventPictures.map((p: { label: string }) => p.label)).toEqual(["Eventets foto", "salen.png", "Underviserens eget opslag"]);
    expect(data.eventPictures.every((p: { url: string }) => p.url.startsWith("/plakater/billede/"))).toBe(true);
    expect(data.files).toEqual([{ url: expect.stringMatching(/^\/arrangementer\/fil\/\d+$/), label: "program.pdf" }]);
    expect(data.teacher).toMatchObject({ name: "Kasper Holm", consent: "given", quotes: { facilitator: "Jeg guider med ro.", participantName: "Mette" } });
    expect(data.teacher.pictures.map((p: { url: string }) => p.url)).toEqual([`/plakater/billede/pr/${PR_PHOTO}`, `/plakater/billede/profil/${PORTRAIT}`, expect.stringMatching(/^\/plakater\/billede\/fil\/\d+$/)]);
    expect(data.teacher.events.map((e: { title: string }) => e.title)).toEqual(["Yoga i september"]);
    void older;
    // The calendar's event: its photo through admin, and the same teacher found by name.
    const mw = await (await call(`/plakater/${HEX}/data`, { cookie })).json() as Record<string, any>;
    expect(mw.event).toMatchObject({ title: "Lydhealing", bookingId: null, lines: ["Gongs og ro."] });
    expect(mw.eventPictures[0].url).toBe(`/plakater/billede/ekstern?src=${encodeURIComponent("https://d1tif55lvfk8gc.cloudfront.net/lyd.jpg")}`);
    // Here both of Kasper's own events are "other events" of his.
    expect(mw.teacher.pictures).toHaveLength(4);
    expect(mw.teacher.events.map((e: { title: string }) => e.title)).toEqual(["Dhyana Yoga", "Yoga i september"]);
    // A picture comes from the bucket, with its type.
    const picture = await call(`/plakater/billede/pr/${PR_PHOTO}`, { cookie });
    expect(picture.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await picture.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect((await call("/plakater/billede/pr/22222222-2222-3333-4444-555555555555", { cookie })).status).toBe(404);
    expect((await call(`/plakater/h99999/data`, { cookie })).status).toBe(404);
  });

  it("keeps a design on the website, and takes it off again - in the chair's log", async () => {
    const { db, call, cookie, id, objects } = await setup();
    const saved = await call(`/plakater/h${id}/design`, { method: "POST", cookie, body: png(1920, 1005) });
    expect(saved.status).toBe(200);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM room_booking_designs WHERE room_booking_id = ?").bind(id).first<{ n: number }>()).toEqual({ n: 1 });
    expect([...objects.keys()].some(k => k.includes("design"))).toBe(true);
    expect((await call(`/plakater/h${id}/data`, { cookie }).then(r => r.json()) as { event: { design: string } }).event.design).toMatch(new RegExp(`^/plakater/billede/design/${id}\\?v=`));
    expect((await call(`/plakater/h${id}/design`, { method: "POST", cookie, body: png(1080, 1350) })).status).toBe(422);
    expect((await call(`/plakater/${HEX}/design`, { method: "POST", cookie, body: png(1920, 1005) })).status).toBe(400);
    await call(`/plakater/h${id}/design?fjern=1`, { method: "POST", cookie });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM room_booking_designs").first<{ n: number }>()).toEqual({ n: 0 });
    const log = (await db.prepare("SELECT power, detail FROM chair_audit ORDER BY id").all<{ power: string; detail: string }>()).results;
    expect(log).toEqual([{ power: "posters.design", detail: 'Satte et design på "Dhyana Yoga" på hjemmesiden' }, { power: "posters.design", detail: 'Fjernede designet fra "Dhyana Yoga" på hjemmesiden' }]);
  });

  it("no longer lets the organiser set a design from the member area", async () => {
    const db = testDatabase();
    const env = { DB: db, ASSETS: { fetch: async () => new Response("app") } } as never;
    for (const [path, method] of [["/api/room-bookings/1/design", "PUT"], ["/api/room-bookings/1/design", "DELETE"], ["/api/room-bookings/1/poster-variant", "PUT"]] as const) {
      const response = await (appWorker as unknown as { fetch(r: Request, e: unknown): Promise<Response> }).fetch(new Request(`https://medlem.hjerterum.example${path}`, { method }), env);
      expect(response.status).toBe(410);
    }
  });

  it("gives the studio its built files and logo on admin's address - and nothing else of the website", async () => {
    const served: string[] = [];
    const env = { DB: testDatabase(), ASSETS: { fetch: async (r: Request) => { served.push(new URL(r.url).pathname); return new Response("file"); } } } as never;
    for (const path of ["/assets/index-abc.js", "/brand/hjerterum-stempel.png"]) expect(await (await site.fetch(new Request(`https://admin.hjerterum.example${path}`), env)).text()).toBe("file");
    expect(served).toEqual(["/assets/index-abc.js", "/brand/hjerterum-stempel.png"]);
    // Everything else on admin's address is admin's own.
    expect((await site.fetch(new Request("https://admin.hjerterum.example/media/hjerterum-deling.jpg"), env)).status).not.toBe(200);
    expect(served).toHaveLength(2);
  });
});
