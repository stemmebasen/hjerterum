import { describe, expect, it } from "vitest";
import { testDatabase } from "./saga/test-support.js";
import type { EventMediaBucket } from "./event-files.js";
import { parseVerdict, posterForDownload, posterInfo, posterSizeProblem, postersByBooking, removePoster, setPosterVariant, storePoster, type SagaVerdict } from "./event-posters.js";
import type { SagaDeps, SagaEnv } from "./saga/env.js";

// Requested: "Når man opretter event skal man også kunne vælge en af skabelonerne eller alternativt uploade sit eget. Uploader man
// sit eget skal Saga tjekke om der er nødvendigt info på, om dimensionerne er rigtige og om kvaliteten er høj nok".

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (w: number, h: number) => { const b = new Uint8Array(24); b.set(PNG); b.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8); new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h); return b.buffer; };

function fakeBucket() {
  const objects = new Map<string, ArrayBuffer>();
  const bucket: EventMediaBucket = {
    async put(key, value) { objects.set(key, value); },
    async get(key) { const v = objects.get(key); return v ? { body: new Response(v).body!, httpMetadata: {} } : null; },
    async delete(key) { objects.delete(key); }
  };
  return { bucket, objects };
}

async function booking(db: ReturnType<typeof testDatabase>, review = "approved") {
  const r = await db.prepare(`INSERT INTO room_bookings (clerk_user_id, teacher_name, teacher_email, title, starts_at_ms, ends_at_ms, fee_minor, ticket_price_minor, payout_clerk_user_id, created_at_ms, updated_at_ms, review_status)
    VALUES ('user_owner', 'T', 't@example.com', 'Source Breathwork', ?, ?, 0, 0, 'user_owner', 1, 1, ?)`).bind(Date.UTC(2026, 10, 4, 18), Date.UTC(2026, 10, 4, 20, 15), review).run();
  return Number(r.meta?.last_row_id);
}

const env = {} as SagaEnv;
const deps: SagaDeps = { fetcher: fetch, now: () => 1_000 };
const event = (id: number) => ({ id, title: "Source Breathwork", starts_at_ms: Date.UTC(2026, 10, 4, 18), ends_at_ms: Date.UTC(2026, 10, 4, 20, 15) });
const saga = (verdict: SagaVerdict | Error) => async () => { if (verdict instanceof Error) throw verdict; return verdict; };

describe("the poster's measurements", () => {
  it("takes post, square and story shapes at 1080 px or more, and says what is wrong otherwise", () => {
    expect(posterSizeProblem(1080, 1350)).toBeNull();
    expect(posterSizeProblem(2160, 2700)).toBeNull();
    expect(posterSizeProblem(1080, 1080)).toBeNull();
    expect(posterSizeProblem(1080, 1920)).toBeNull();
    expect(posterSizeProblem(800, 1000)).toContain("mindst 1080 px bredt");
    expect(posterSizeProblem(1920, 1005)).toContain("formatet til opslag, kvadrat eller story");
  });
});

describe("Saga's verdict", () => {
  it("is the model's two answers, never a friendly sentence that says otherwise", () => {
    expect(parseVerdict('{"info_ok":true,"quality_ok":true,"missing":[],"wrong":"","reason":"Fint."}')).toEqual({ ok: true, reason: "Fint." });
    expect(parseVerdict('Her: {"info_ok":true,"quality_ok":false,"missing":[],"reason":"Billedet er sløret."}')).toEqual({ ok: false, reason: "Billedet er sløret." });
    expect(parseVerdict('{"info_ok":true,"quality_ok":true,"missing":["tid"],"reason":"Ser godt ud."}')).toEqual({ ok: false, reason: "Der mangler tid på opslaget. Ser godt ud." });
    expect(parseVerdict("Det ser fint ud!")).toBeNull();
  });
});

describe("keeping the organiser's own poster", () => {
  it("refuses wrong measurements before Saga is asked, and keeps a poster only when she says yes", async () => {
    const db = testDatabase(), { bucket, objects } = fakeBucket();
    const id = await booking(db);
    let asked = 0;
    const wrong = await storePoster(env, deps, db, bucket, { booking: event(id), userId: "user_owner", name: "plakat.png", bytes: png(1920, 1005) }, async () => { asked++; return { ok: true, reason: "" }; });
    expect(wrong).toMatchObject({ ok: false, error: "poster_size" });
    expect(asked).toBe(0);
    const no = await storePoster(env, deps, db, bucket, { booking: event(id), userId: "user_owner", name: "plakat.png", bytes: png(1080, 1350) }, saga({ ok: false, reason: "Datoen mangler." }));
    expect(no).toEqual({ ok: false, error: "poster_rejected", reason: "Datoen mangler." });
    expect(objects.size).toBe(0);
    const yes = await storePoster(env, deps, db, bucket, { booking: event(id), userId: "user_owner", name: "plakat.png", bytes: png(1080, 1350) }, saga({ ok: true, reason: "Fint opslag." }));
    expect(yes).toMatchObject({ ok: true, poster: { url: `/api/room-bookings/${id}/poster`, width: 1080, height: 1350 } });
    expect(objects.size).toBe(1);
    expect(await posterInfo(db, id)).toMatchObject({ variant: "eget", poster: { width: 1080, height: 1350, note: "Fint opslag." } });
  });

  it("keeps nothing when Saga cannot look", async () => {
    const db = testDatabase(), { bucket, objects } = fakeBucket();
    const id = await booking(db);
    const down = await storePoster(env, deps, db, bucket, { booking: event(id), userId: "user_owner", name: "plakat.png", bytes: png(1080, 1350) }, saga(new Error("ai_request_failed")));
    expect(down).toMatchObject({ ok: false, error: "saga_unavailable" });
    expect(objects.size).toBe(0);
    expect((await posterInfo(db, id)).poster).toBeNull();
  });

  it("replaces an earlier poster, removes it again, and shows it publicly only once the event is approved", async () => {
    const db = testDatabase(), { bucket, objects } = fakeBucket();
    const id = await booking(db, "pending");
    await storePoster(env, deps, db, bucket, { booking: event(id), userId: "user_owner", name: "a.png", bytes: png(1080, 1350) }, saga({ ok: true, reason: "a" }));
    await storePoster(env, deps, db, bucket, { booking: event(id), userId: "user_owner", name: "b.png", bytes: png(1080, 1920) }, saga({ ok: true, reason: "b" }));
    expect(objects.size).toBe(1);
    expect((await posterForDownload(db, id))?.public).toBe(false);
    await db.prepare("UPDATE room_bookings SET review_status = 'approved' WHERE id = ?").bind(id).run();
    expect((await posterForDownload(db, id))?.public).toBe(true);
    expect((await postersByBooking(db, [id])).get(id)).toMatchObject({ variant: "eget", poster: { height: 1920 } });
    expect(await removePoster(db, bucket, id, 2)).toBe(true);
    expect(objects.size).toBe(0);
    expect(await posterInfo(db, id)).toEqual({ variant: null, poster: null });
  });

  it("remembers a chosen design, and none means the system chooses", async () => {
    const db = testDatabase();
    const id = await booking(db);
    expect((await posterInfo(db, id)).variant).toBeNull();
    await setPosterVariant(db, id, "organisk", 5);
    expect((await posterInfo(db, id)).variant).toBe("organisk");
    await setPosterVariant(db, id, null, 6);
    expect((await posterInfo(db, id)).variant).toBeNull();
  });
});
