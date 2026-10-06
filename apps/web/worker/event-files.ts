import type { D1Database } from "./db.js";

/** Photos and files on member events (requested): the organiser uploads one cover photo and a few other files; the photo
 * is public once the event is approved, the other files are for the organiser, the registered and the board.
 * The photo rules follow the booking form (jpg, png, webp or gif up to 8 MB); other files are documents and pictures
 * up to 10 MB, never anything executable. What a file is comes from its first bytes, not from what the browser says. */

export interface EventMediaBucket {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
  delete(key: string): Promise<void>;
}

export type FileKind = "cover" | "file";
export const COVER_MAX_BYTES = 8 * 1024 * 1024;
export const FILE_MAX_BYTES = 10 * 1024 * 1024;
export const MAX_OTHER_FILES = 5;

export type EventFileRow = {
  id: number; room_booking_id: number; kind: FileKind; r2_key: string; filename: string; content_type: string;
  size_bytes: number; uploaded_by: string; created_at_ms: number;
};
export type EventFileView = { id: number; kind: FileKind; filename: string; contentType: string; sizeBytes: number; url: string };

const IMAGES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
const DOCUMENTS: Record<string, string> = {
  pdf: "application/pdf", txt: "text/plain; charset=utf-8",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", odt: "application/vnd.oasis.opendocument.text",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ods: "application/vnd.oasis.opendocument.spreadsheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", odp: "application/vnd.oasis.opendocument.presentation"
};
export const FILE_EXTENSIONS = [...Object.keys(IMAGES), ...Object.keys(DOCUMENTS)];

type Sniffed = "jpeg" | "png" | "webp" | "gif" | "pdf" | "zip" | "ole" | "text";
const startsWith = (b: Uint8Array, ...bytes: number[]) => bytes.every((v, i) => b[i] === v);
/** What the first bytes say a file is; null when it looks like nothing we accept. */
export function sniff(bytes: Uint8Array): Sniffed | null {
  if (startsWith(bytes, 0xff, 0xd8, 0xff)) return "jpeg";
  if (startsWith(bytes, 0x89, 0x50, 0x4e, 0x47)) return "png";
  if (startsWith(bytes, 0x47, 0x49, 0x46, 0x38)) return "gif";
  if (startsWith(bytes, 0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "webp";
  if (startsWith(bytes, 0x25, 0x50, 0x44, 0x46)) return "pdf";
  if (startsWith(bytes, 0x50, 0x4b, 0x03, 0x04)) return "zip";
  if (startsWith(bytes, 0xd0, 0xcf, 0x11, 0xe0)) return "ole";
  const head = bytes.subarray(0, 2048);
  return head.length > 0 && !head.includes(0) ? "text" : null;
}

const EXTENSION_KIND: Record<string, Sniffed> = {
  jpg: "jpeg", jpeg: "jpeg", png: "png", webp: "webp", gif: "gif", pdf: "pdf", txt: "text",
  docx: "zip", xlsx: "zip", pptx: "zip", odt: "zip", ods: "zip", odp: "zip", doc: "ole", xls: "ole", ppt: "ole"
};

export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, "").replace(/\s+/g, " ").trim().slice(-120);
  return cleaned || "fil";
}
const extensionOf = (name: string) => (/\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1] ?? "").toLowerCase();

export type UploadCheck = { ok: true; filename: string; contentType: string; extension: string } | { ok: false; error: "empty_file" | "file_too_large" | "file_type" };
/** Whether a file may be stored, and under what name and type. `head` is the file's first bytes. */
export function checkUpload(kind: FileKind, name: string, size: number, head: Uint8Array): UploadCheck {
  if (size <= 0) return { ok: false, error: "empty_file" };
  if (size > (kind === "cover" ? COVER_MAX_BYTES : FILE_MAX_BYTES)) return { ok: false, error: "file_too_large" };
  const filename = safeFilename(name), extension = extensionOf(filename);
  const allowed = kind === "cover" ? IMAGES : { ...IMAGES, ...DOCUMENTS };
  const contentType = allowed[extension];
  if (!contentType) return { ok: false, error: "file_type" };
  const found = sniff(head);
  const wanted = EXTENSION_KIND[extension];
  if (!found || found !== wanted) return { ok: false, error: "file_type" };
  return { ok: true, filename, contentType, extension };
}

const view = (row: EventFileRow): EventFileView => ({ id: row.id, kind: row.kind, filename: row.filename, contentType: row.content_type, sizeBytes: row.size_bytes, url: `/api/event-files/${row.id}` });

const COLUMNS = "id, room_booking_id, kind, r2_key, filename, content_type, size_bytes, uploaded_by, created_at_ms";

export async function listEventFiles(db: D1Database, bookingId: number): Promise<EventFileView[]> {
  const rows = (await db.prepare(`SELECT ${COLUMNS} FROM room_booking_files WHERE room_booking_id = ? ORDER BY kind ASC, id ASC`).bind(bookingId).all<EventFileRow>()).results ?? [];
  return rows.map(view);
}

/** The files of many events at once: cover photo ids for everyone, the rest only for the events the viewer may open. */
export async function filesByBooking(db: D1Database, bookingIds: number[]): Promise<Map<number, EventFileView[]>> {
  const out = new Map<number, EventFileView[]>();
  if (!bookingIds.length) return out;
  const marks = bookingIds.map(() => "?").join(",");
  const rows = (await db.prepare(`SELECT ${COLUMNS} FROM room_booking_files WHERE room_booking_id IN (${marks}) ORDER BY kind ASC, id ASC`).bind(...bookingIds).all<EventFileRow>()).results ?? [];
  for (const row of rows) out.set(row.room_booking_id, [...(out.get(row.room_booking_id) ?? []), view(row)]);
  return out;
}

export type StoreResult = { ok: true; file: EventFileView; replacedCover: boolean } | { ok: false; error: "empty_file" | "file_too_large" | "file_type" | "too_many_files" };

/** Stores one upload for an event the caller already knows is theirs. A new cover photo replaces the old one. */
export async function storeEventFile(db: D1Database, bucket: EventMediaBucket, input: {
  bookingId: number; userId: string; kind: FileKind; name: string; bytes: ArrayBuffer; now: number;
}): Promise<StoreResult> {
  const check = checkUpload(input.kind, input.name, input.bytes.byteLength, new Uint8Array(input.bytes, 0, Math.min(input.bytes.byteLength, 2048)));
  if (!check.ok) return check;
  if (input.kind === "file") {
    const count = await db.prepare("SELECT COUNT(*) AS n FROM room_booking_files WHERE room_booking_id = ? AND kind = 'file'").bind(input.bookingId).first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_OTHER_FILES) return { ok: false, error: "too_many_files" };
  }
  const key = `events/${input.bookingId}/${crypto.randomUUID()}.${check.extension}`;
  await bucket.put(key, input.bytes, { httpMetadata: { contentType: check.contentType } });
  const old = input.kind === "cover"
    ? await db.prepare(`SELECT ${COLUMNS} FROM room_booking_files WHERE room_booking_id = ? AND kind = 'cover'`).bind(input.bookingId).first<EventFileRow>()
    : null;
  try {
    if (old) await db.prepare("DELETE FROM room_booking_files WHERE id = ?").bind(old.id).run();
    const inserted = await db.prepare(`INSERT INTO room_booking_files (room_booking_id, kind, r2_key, filename, content_type, size_bytes, uploaded_by, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(input.bookingId, input.kind, key, check.filename, check.contentType, input.bytes.byteLength, input.userId, input.now).run();
    const id = Number(inserted.meta?.last_row_id);
    if (old) await bucket.delete(old.r2_key).catch(() => undefined);
    return { ok: true, replacedCover: Boolean(old), file: { id, kind: input.kind, filename: check.filename, contentType: check.contentType, sizeBytes: input.bytes.byteLength, url: `/api/event-files/${id}` } };
  } catch (error) {
    await bucket.delete(key).catch(() => undefined);
    throw error;
  }
}

/** Removes a file from an event the caller already knows is theirs. */
export async function removeEventFile(db: D1Database, bucket: EventMediaBucket, bookingId: number, fileId: number): Promise<{ removed: boolean; wasCover: boolean }> {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM room_booking_files WHERE id = ? AND room_booking_id = ?`).bind(fileId, bookingId).first<EventFileRow>();
  if (!row) return { removed: false, wasCover: false };
  await db.prepare("DELETE FROM room_booking_files WHERE id = ?").bind(fileId).run();
  await bucket.delete(row.r2_key).catch(() => undefined);
  return { removed: true, wasCover: row.kind === "cover" };
}

export type DownloadTarget = EventFileRow & { owner_id: string; review_status: string | null; booking_status: string };
export async function fileForDownload(db: D1Database, fileId: number): Promise<DownloadTarget | null> {
  return db.prepare(`SELECT f.id, f.room_booking_id, f.kind, f.r2_key, f.filename, f.content_type, f.size_bytes, f.uploaded_by, f.created_at_ms,
      b.clerk_user_id AS owner_id, b.review_status AS review_status, b.status AS booking_status
    FROM room_booking_files f JOIN room_bookings b ON b.id = f.room_booking_id WHERE f.id = ?`).bind(fileId).first<DownloadTarget>();
}

export async function isConfirmedAttendee(db: D1Database, bookingId: number, userId: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS yes FROM room_booking_attendees WHERE room_booking_id = ? AND clerk_user_id = ? AND registration_status = 'confirmed'").bind(bookingId, userId).first();
  return Boolean(row);
}

/** A cover photo is public once the event is approved and still on; anything else needs the owner, a registered member or the board. */
export const coverIsPublic = (target: Pick<DownloadTarget, "kind" | "review_status" | "booking_status">) =>
  target.kind === "cover" && (target.review_status ?? "approved") === "approved" && target.booking_status === "scheduled";
