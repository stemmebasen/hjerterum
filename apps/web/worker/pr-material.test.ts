import { beforeEach, describe, expect, it, vi } from "vitest";
import type { D1Database } from "./db.js";
import { testDatabase } from "./saga/test-support.js";
import { ownPrMaterial, ownPrPhotos, prPhoto } from "./pr-material.js";
import { readyForPr } from "../pr-material.js";
import { prMaterialCard, prMaterialForTeacher, prReadyNames } from "./cockpit/prMaterial.js";

vi.mock("./auth.js", () => ({ authenticateBearer: async (request: Request) => {
  const userId = request.headers.get("authorization");
  if (!userId) throw new Error("unauthorized");
  return { userId };
} }));
vi.mock("./admin-auth.js", () => ({ clerkPrimaryEmail: async () => "external@example.test" }));

// Requested (Gitta, via the chair): at least three photos, her consent text, three one-line quotes - a strong encouragement, not a requirement.
let db: D1Database;
const store = new Map<string, ArrayBuffer>();
const bucket = { put: async (key: string, value: ArrayBuffer) => { store.set(key, value); }, get: async (key: string) => store.has(key) ? { body: new Blob([store.get(key)!]).stream() } : null, delete: async (key: string) => { store.delete(key); } };
const env = () => ({ DB: db, CLERK_SECRET_KEY: "test", EVENT_MEDIA: bucket });
const png = (w: number, h: number) => { const b = new Uint8Array(33); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]); const v = new DataView(b.buffer); v.setUint32(16, w); v.setUint32(20, h); return b; };
const material = (body?: unknown, user = "owner") => ownPrMaterial(new Request("https://x.test/api/members/me/pr-material", { method: body ? "PUT" : "GET", headers: { authorization: user }, ...(body ? { body: JSON.stringify(body) } : {}) }), env());
const upload = (bytes: Uint8Array, user = "owner") => { const f = new FormData(); f.set("photo", new File([bytes as Uint8Array<ArrayBuffer>], "billede.png", { type: "image/png" })); return ownPrPhotos(new Request("https://x.test/api/members/me/pr-material/photos", { method: "POST", headers: { authorization: user }, body: f }), env(), null); };
beforeEach(async () => {
  db = testDatabase(); store.clear();
  await db.prepare(`INSERT INTO members (clerk_user_id, stripe_customer_id, tier, interval, status, full_name, email, created_at_ms, updated_at_ms)
    VALUES ('owner', 'c1', 'standard', 'month', 'active', 'Anna Andersen', 'anna@example.test', 1, 1)`).run();
});

describe("a teacher's PR material", () => {
  it("keeps photos, quotes and consent - and stops showing the photos when consent is withdrawn", async () => {
    expect(await (await material()).json()).toEqual({ photos: [], quotes: { facilitator: "", offering: "", participant: "", participantName: "" }, consentAt: null, withdrawnAt: null });
    expect((await upload(png(800, 1200))).status).toBe(422);
    for (let i = 0; i < 3; i++) expect((await upload(png(1080, 1350))).status).toBe(201);
    const quotes = { facilitator: "Anna holder rummet med stor ro.", offering: "Du går hjem med mere ro i kroppen.", participant: "Det bedste, jeg har gjort for mig selv i år.", participantName: "Mette" };
    let m = await (await material({ quotes, consent: true })).json() as { photos: Array<{ id: string; url: string }>; quotes: unknown; consentAt: number | null };
    expect(m.quotes).toEqual(quotes);
    expect(m.photos).toHaveLength(3);
    expect(readyForPr({ photos: m.photos.map(p => ({ ...p, width: 1080, height: 1350 })), consentAt: m.consentAt })).toBe(true);
    expect((await prPhoto(m.photos[0]!.id, env())).status).toBe(200);
    // Another member cannot delete her photo.
    await ownPrPhotos(new Request(`https://x.test/api/members/me/pr-material/photos/${m.photos[0]!.id}`, { method: "DELETE", headers: { authorization: "someone" } }), env(), m.photos[0]!.id);
    expect((await prPhoto(m.photos[0]!.id, env())).status).toBe(200);
    m = await (await material({ consent: false })).json() as typeof m;
    expect(m.consentAt).toBeNull();
    expect((await prPhoto(m.photos[0]!.id, env())).status).toBe(404);
    // Her own delete takes it from R2 too.
    await ownPrPhotos(new Request(`https://x.test/api/members/me/pr-material/photos/${m.photos[0]!.id}`, { method: "DELETE", headers: { authorization: "owner" } }), env(), m.photos[0]!.id);
    expect(store.size).toBe(2);
  });

  it("refuses what is not a photo, and long quotes", async () => {
    expect((await upload(new TextEncoder().encode("hello"))).status).toBe(415);
    expect((await material({ quotes: { facilitator: "x".repeat(201) } })).status).toBe(400);
  });

  // Requested (Gitta): "at events, bliver connected til underviseren ... og at deres billed/pr materiale ligger på den."
  it("shows the board the teacher's material on their page in admin - photos and quotes only with consent - and marks them PR ✓", async () => {
    for (let i = 0; i < 3; i++) await upload(png(1200, 1500));
    await material({ quotes: { facilitator: "Anna holder rummet med stor ro.", participant: "Det bedste i år.", participantName: "Mette" } });
    let card = prMaterialCard(await prMaterialForTeacher(db, "anna andersen"));
    expect(card).toContain("Har ikke givet samtykke endnu (3 billeder delt) - vi må ikke bruge materialet.");
    expect(card).not.toContain("<img");
    expect(await prReadyNames(db)).toEqual(new Set());
    await material({ consent: true });
    card = prMaterialCard(await prMaterialForTeacher(db, "Anna Andersen"));
    expect(card).toContain("✓ Klar til PR");
    expect(card.match(/<img /g)).toHaveLength(3);
    expect(card).toContain("<q>Anna holder rummet med stor ro.</q>");
    expect(card).toContain("<q>Det bedste i år.</q> <span class=\"small muted\">- Mette</span>");
    expect(await prReadyNames(db)).toEqual(new Set(["anna andersen"]));
    expect(prMaterialCard(await prMaterialForTeacher(db, "Ukendt Person"))).toContain("Har ikke delt PR-materiale endnu.");
  });
});
