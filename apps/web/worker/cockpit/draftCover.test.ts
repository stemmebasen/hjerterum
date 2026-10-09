import { describe, expect, it } from "vitest";
import { discardDraft, eventDraft, removeDraftCover, saveDraftCover } from "./eventDesk.js";
import { testDatabase } from "../saga/test-support.js";

// Requested: a Facebook cover (1920 × 1005 px) on the draft that follows the event; the draft can be deleted with a cross.
const header = (w: number, h: number) => { const b = new Uint8Array(24); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]); new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h); return b; };
const png = (w: number, h: number) => new File([header(w, h)], "omslag.png", { type: "image/png" });
const bucket = () => { const objects = new Map<string, ArrayBuffer>(); return { objects, put: async (k: string, v: ArrayBuffer) => { objects.set(k, v); }, get: async () => null, delete: async (k: string) => { objects.delete(k); } }; };

describe("a draft's cover", () => {
  const setup = async () => {
    const db = testDatabase();
    await db.prepare("INSERT INTO cockpit_event_drafts (request, data, created_by, created_at_ms, updated_at_ms) VALUES ('x', '{}', 'Jacob', 1, 1)").run();
    return { db, b: bucket(), row: (await eventDraft(db, 1))! };
  };
  it("is kept only at exactly 1920 × 1005 px", async () => {
    const { db, b, row } = await setup();
    expect(await saveDraftCover(db, b, row, png(1200, 628), 2)).toMatch(/1920 × 1005/);
    expect(b.objects.size).toBe(0);
    expect(await saveDraftCover(db, b, row, png(1920, 1005), 2)).toBeNull();
    expect(b.objects.size).toBe(1);
    expect((await eventDraft(db, 1))?.cover_key).toMatch(/^drafts\/1\//);
  });
  it("is removed again, and with the draft", async () => {
    const { db, b, row } = await setup();
    await saveDraftCover(db, b, row, png(1920, 1005), 2);
    await removeDraftCover(db, b, (await eventDraft(db, 1))!, 3);
    expect(b.objects.size).toBe(0);
    await discardDraft(db, 1, 4);
    expect((await eventDraft(db, 1))?.status).toBe("discarded");
  });
});
