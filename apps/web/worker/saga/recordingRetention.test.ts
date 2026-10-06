import { describe, expect, it } from "vitest";
import { scheduledRecordingCleanup } from "./recordingRetention.js";
import { claimJob, queueMinutes, updateMinutes } from "./store.js";
import { deps, fakeServices, sagaEnv, testDatabase } from "./test-support.js";

// Requested: delete the audio once the minutes are made - "Bare der hvor man også uploader lyd" - "Det er fint - så længe referatet er lavet".
const DAY = 86_400_000;
const NOW = Date.parse("2026-10-06T12:00:00Z");

describe("the audio of a meeting is deleted once the minutes are made", () => {
  it("deletes uploaded and recorded audio 14 days after the minutes are up, keeps the minutes, and never touches a recording without minutes or anything else", async () => {
    const db = testDatabase();
    const kept = new Set(["cockpit/a.webm", "cockpit/b.webm", "cockpit/c.webm", "cockpit/d.webm", "cockpit/e.webm", "cockpit/f.webm", "holistisk-org/site/photo.jpg"]);
    const removed: string[] = [];
    const bucket = { put: async () => ({}), get: async () => null, delete: async (key: string) => { kept.delete(key); removed.push(key); } };
    const env = sagaEnv(db, { BOARD_RECORDINGS: bucket as never });
    const row = async (source: "upload" | "drive", fileId: string, status: string, ageDays: number, fields: { transcript?: string; draft?: string } = { transcript: "Mødet: vi talte om budgettet.", draft: "# Referat" }) => {
      const id = (await queueMinutes(db, { source, fileId, fileName: `${fileId}`, mimeType: "audio/webm", meetingDate: "2026-09-01", nowMs: NOW - ageDays * DAY }))!;
      await updateMinutes(db, id, { status, ...fields }, NOW - ageDays * DAY);
      return id;
    };
    const old = await row("upload", "cockpit/a.webm", "approved", 20);
    await row("upload", "cockpit/b.webm", "approved", 5);
    // Never deleted, however old: the minutes were not made (failed, rejected, still waiting) - the audio is the only copy of the meeting.
    await row("upload", "cockpit/c.webm", "failed", 400, {});
    await row("upload", "cockpit/d.webm", "rejected", 400);
    await row("upload", "cockpit/e.webm", "drafted", 400);
    // Marked as made, but with nothing written: kept.
    await row("upload", "cockpit/f.webm", "approved", 400, { transcript: "x", draft: "  " });
    await row("drive", "drive-file-1", "approved", 100);
    const claim = (key: string, slot: number) => claimJob(db, key, slot, NOW);

    expect(await scheduledRecordingCleanup(env, deps(fakeServices().fetcher, NOW), db, claim)).toBe(1);
    expect(removed).toEqual(["cockpit/a.webm"]);
    // The minutes and the transcript stay; the row says the audio is gone.
    expect(await db.prepare("SELECT transcript, draft_markdown, audio_deleted_at_ms FROM board_minutes WHERE id = ?").bind(old).first())
      .toEqual({ transcript: "Mødet: vi talte om budgettet.", draft_markdown: "# Referat", audio_deleted_at_ms: NOW });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM board_minutes WHERE audio_deleted_at_ms IS NOT NULL").first<{ n: number }>().then(r => r?.n)).toBe(1);
    // Once a day: another round the same day does nothing; ten days later the next one is due.
    expect(await scheduledRecordingCleanup(env, deps(fakeServices().fetcher, NOW), db, claim)).toBe(0);
    const later = NOW + 10 * DAY;
    expect(await scheduledRecordingCleanup(env, deps(fakeServices().fetcher, later), db, (key, slot) => claimJob(db, key, slot, later))).toBe(1);
    expect(removed.sort()).toEqual(["cockpit/a.webm", "cockpit/b.webm"]);
    // A year on, what has no minutes is still there - and so is everything else in the bucket.
    const muchLater = NOW + 365 * DAY;
    expect(await scheduledRecordingCleanup(env, deps(fakeServices().fetcher, muchLater), db, (key, slot) => claimJob(db, key, slot, muchLater))).toBe(0);
    expect([...kept].sort()).toEqual(["cockpit/c.webm", "cockpit/d.webm", "cockpit/e.webm", "cockpit/f.webm", "holistisk-org/site/photo.jpg"]);
  });

  it("does nothing, and loses nothing, when the bucket cannot delete or a delete fails", async () => {
    const db = testDatabase();
    const id = (await queueMinutes(db, { source: "upload", fileId: "cockpit/x.webm", fileName: "x", mimeType: null, meetingDate: null, nowMs: NOW - 30 * DAY }))!;
    await updateMinutes(db, id, { status: "approved" }, NOW - 30 * DAY);
    const claim = (key: string, slot: number) => claimJob(db, key, slot, NOW);
    expect(await scheduledRecordingCleanup(sagaEnv(db, { BOARD_RECORDINGS: { put: async () => ({}), get: async () => null } as never }), deps(fakeServices().fetcher, NOW), db, claim)).toBe(0);
    const broken = { put: async () => ({}), get: async () => null, delete: async () => { throw new Error("r2_down"); } };
    expect(await scheduledRecordingCleanup(sagaEnv(db, { BOARD_RECORDINGS: broken as never }), deps(fakeServices().fetcher, NOW + DAY), db, (key, slot) => claimJob(db, key, slot, NOW + DAY))).toBe(0);
    expect(await db.prepare("SELECT audio_deleted_at_ms FROM board_minutes WHERE id = ?").bind(id).first<{ audio_deleted_at_ms: number | null }>().then(r => r?.audio_deleted_at_ms)).toBeNull();
  });
});
