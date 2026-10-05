import { describe, expect, it } from "vitest";
import { testDatabase } from "./saga/test-support.js";
import {
  checkUpload, coverIsPublic, fileForDownload, filesByBooking, isConfirmedAttendee, removeEventFile, safeFilename, sniff, storeEventFile,
  COVER_MAX_BYTES, FILE_MAX_BYTES, MAX_OTHER_FILES, type EventMediaBucket
} from "./event-files.js";

// Requested: upload a cover photo and other files on an event; the photo is public once approved, the other files are for
// the organiser and the registered. The rules follow the booking form (a photo up to 8 MB).

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = new TextEncoder().encode("%PDF-1.7\n");
const ZIP = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);
const EXE = new TextEncoder().encode("MZ\u0090\u0000\u0003\u0000");

function fakeBucket() {
  const objects = new Map<string, ArrayBuffer>();
  const bucket: EventMediaBucket = {
    async put(key, value) { objects.set(key, value); },
    async get(key) { const v = objects.get(key); return v ? { body: new Response(v).body!, httpMetadata: {} } : null; },
    async delete(key) { objects.delete(key); }
  };
  return { bucket, objects };
}
const buffer = (bytes: Uint8Array, size = bytes.length) => { const out = new Uint8Array(size); out.set(bytes); return out.buffer; };

describe("what a file is", () => {
  it("is told by its first bytes", () => {
    expect(sniff(JPEG)).toBe("jpeg");
    expect(sniff(PNG)).toBe("png");
    expect(sniff(PDF)).toBe("pdf");
    expect(sniff(ZIP)).toBe("zip");
    expect(sniff(new TextEncoder().encode("Program for dagen\n"))).toBe("text");
    expect(sniff(EXE)).toBeNull();
    expect(sniff(new Uint8Array())).toBeNull();
  });

  it("must match the extension, so a program renamed to .jpg is refused", () => {
    expect(checkUpload("cover", "forside.jpg", 1000, JPEG)).toMatchObject({ ok: true, contentType: "image/jpeg" });
    expect(checkUpload("cover", "forside.jpg", 1000, PNG)).toEqual({ ok: false, error: "file_type" });
    expect(checkUpload("cover", "forside.jpg", 1000, EXE)).toEqual({ ok: false, error: "file_type" });
    expect(checkUpload("file", "virus.exe", 1000, EXE)).toEqual({ ok: false, error: "file_type" });
    expect(checkUpload("file", "program.pdf", 1000, PDF)).toMatchObject({ ok: true, contentType: "application/pdf" });
    expect(checkUpload("file", "program.docx", 1000, ZIP)).toMatchObject({ ok: true });
    expect(checkUpload("file", "program.pdf", 1000, ZIP)).toEqual({ ok: false, error: "file_type" });
  });

  it("allows documents among the files but only pictures as the cover", () => {
    expect(checkUpload("cover", "program.pdf", 1000, PDF)).toEqual({ ok: false, error: "file_type" });
    expect(checkUpload("file", "billede.png", 1000, PNG)).toMatchObject({ ok: true });
  });

  it("holds a photo to 8 MB, other files to 10 MB, and refuses an empty file", () => {
    expect(checkUpload("cover", "a.jpg", COVER_MAX_BYTES, JPEG).ok).toBe(true);
    expect(checkUpload("cover", "a.jpg", COVER_MAX_BYTES + 1, JPEG)).toEqual({ ok: false, error: "file_too_large" });
    expect(checkUpload("file", "a.pdf", FILE_MAX_BYTES, PDF).ok).toBe(true);
    expect(checkUpload("file", "a.pdf", FILE_MAX_BYTES + 1, PDF)).toEqual({ ok: false, error: "file_too_large" });
    expect(checkUpload("file", "a.pdf", 0, PDF)).toEqual({ ok: false, error: "empty_file" });
  });

  it("keeps a file name harmless", () => {
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
    expect(safeFilename("C:\\Users\\Mette\\Program: <v2>.pdf")).toBe("Program v2.pdf");
    expect(safeFilename("")).toBe("fil");
  });
});

async function booking(db: ReturnType<typeof testDatabase>, owner = "user_owner", review = "pending") {
  const r = await db.prepare(`INSERT INTO room_bookings (clerk_user_id, teacher_name, teacher_email, title, starts_at_ms, ends_at_ms, fee_minor, ticket_price_minor, payout_clerk_user_id, created_at_ms, updated_at_ms, review_status)
    VALUES (?, 'T', 't@example.com', 'Event', 1, 2, 0, 0, ?, 1, 1, ?)`).bind(owner, owner, review).run();
  return Number(r.meta?.last_row_id);
}

describe("storing files on an event", () => {
  it("replaces the cover photo and removes the old object", async () => {
    const db = testDatabase(), { bucket, objects } = fakeBucket();
    const id = await booking(db);
    const first = await storeEventFile(db, bucket, { bookingId: id, userId: "user_owner", kind: "cover", name: "en.jpg", bytes: buffer(JPEG), now: 10 });
    expect(first).toMatchObject({ ok: true, replacedCover: false });
    const second = await storeEventFile(db, bucket, { bookingId: id, userId: "user_owner", kind: "cover", name: "to.png", bytes: buffer(PNG), now: 11 });
    expect(second).toMatchObject({ ok: true, replacedCover: true });
    expect(objects.size).toBe(1);
    const files = (await filesByBooking(db, [id])).get(id)!;
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ kind: "cover", filename: "to.png", contentType: "image/png" });
  });

  it("allows five other files and no more", async () => {
    const db = testDatabase(), { bucket } = fakeBucket();
    const id = await booking(db);
    for (let i = 0; i < MAX_OTHER_FILES; i += 1) {
      expect((await storeEventFile(db, bucket, { bookingId: id, userId: "user_owner", kind: "file", name: `program-${i}.pdf`, bytes: buffer(PDF), now: i })).ok).toBe(true);
    }
    expect(await storeEventFile(db, bucket, { bookingId: id, userId: "user_owner", kind: "file", name: "for-meget.pdf", bytes: buffer(PDF), now: 9 })).toEqual({ ok: false, error: "too_many_files" });
  });

  it("stores nothing for a refused file", async () => {
    const db = testDatabase(), { bucket, objects } = fakeBucket();
    const id = await booking(db);
    expect(await storeEventFile(db, bucket, { bookingId: id, userId: "user_owner", kind: "cover", name: "x.jpg", bytes: buffer(EXE), now: 1 })).toEqual({ ok: false, error: "file_type" });
    expect(objects.size).toBe(0);
    expect((await filesByBooking(db, [id])).size).toBe(0);
  });

  it("removes a file and its object", async () => {
    const db = testDatabase(), { bucket, objects } = fakeBucket();
    const id = await booking(db);
    const stored = await storeEventFile(db, bucket, { bookingId: id, userId: "user_owner", kind: "file", name: "a.pdf", bytes: buffer(PDF), now: 1 });
    if (!stored.ok) throw new Error("not stored");
    expect(await removeEventFile(db, bucket, id, stored.file.id + 99)).toEqual({ removed: false, wasCover: false });
    expect(await removeEventFile(db, bucket, id, stored.file.id)).toEqual({ removed: true, wasCover: false });
    expect(objects.size).toBe(0);
  });
});

describe("who may open a file", () => {
  it("makes only an approved, scheduled event's cover photo public", async () => {
    const db = testDatabase(), { bucket } = fakeBucket();
    const pending = await booking(db, "user_a", "pending");
    const approved = await booking(db, "user_a", "approved");
    const [p, a] = await Promise.all([pending, approved].map(async (id) => {
      const r = await storeEventFile(db, bucket, { bookingId: id, userId: "user_a", kind: "cover", name: "c.jpg", bytes: buffer(JPEG), now: 1 });
      return r.ok ? r.file.id : 0;
    }));
    expect(coverIsPublic((await fileForDownload(db, p!))!)).toBe(false);
    expect(coverIsPublic((await fileForDownload(db, a!))!)).toBe(true);
    await db.prepare("UPDATE room_bookings SET status = 'cancelled' WHERE id = ?").bind(approved).run();
    expect(coverIsPublic((await fileForDownload(db, a!))!)).toBe(false);
  });

  it("never makes another file public, and knows the confirmed attendees", async () => {
    const db = testDatabase(), { bucket } = fakeBucket();
    const id = await booking(db, "user_a", "approved");
    const stored = await storeEventFile(db, bucket, { bookingId: id, userId: "user_a", kind: "file", name: "p.pdf", bytes: buffer(PDF), now: 1 });
    if (!stored.ok) throw new Error("not stored");
    expect(coverIsPublic((await fileForDownload(db, stored.file.id))!)).toBe(false);
    await db.prepare(`INSERT INTO room_booking_attendees (room_booking_id, clerk_user_id, member_name, member_email, created_at_ms, registration_status, confirmed_at_ms)
      VALUES (?, 'user_b', 'B', 'b@example.com', 1, 'confirmed', 1), (?, 'user_c', 'C', 'c@example.com', 1, 'pending', NULL)`).bind(id, id).run();
    expect(await isConfirmedAttendee(db, id, "user_b")).toBe(true);
    expect(await isConfirmedAttendee(db, id, "user_c")).toBe(false);
    expect(await isConfirmedAttendee(db, id, "user_d")).toBe(false);
  });
});
