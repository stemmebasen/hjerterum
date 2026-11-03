/** Requested (3 November 2026): "kan vi ikke helt erstatte Google-kontoen og så lave 'vores egen Google-konto' med R2 i admin?" - "Ja. Bare dér,
 * hvor det er nemmest at etablere. Og så skal der i admin være et form for filarkiv." One R2 bucket, hjerterum-arkiv-eu (binding ARCHIVE):
 * - filer/...  the board's file archive in admin (Filarkiv): folders, upload, download, delete;
 * - kopier/... a full copy of the database every night (.github/workflows/natlig-kopi.yml: wrangler d1 export), kept here: the newest 30 and the
 *   first of each month for a year. The chair downloads one a month to keep outside Cloudflare (a reminder comes on the 1st). */

export type ArchiveObject = { key: string; size: number; uploaded: Date; customMetadata?: Record<string, string>; httpMetadata?: { contentType?: string } };
export type ArchiveBucket = {
  list(options: { prefix?: string; delimiter?: string; cursor?: string | undefined; limit?: number; include?: Array<"customMetadata" | "httpMetadata"> }): Promise<{ objects: ArchiveObject[]; delimitedPrefixes: string[]; truncated: boolean; cursor?: string }>;
  get(key: string): Promise<(ArchiveObject & { body: ReadableStream }) | null>;
  head(key: string): Promise<ArchiveObject | null>;
  put(key: string, value: ReadableStream | ArrayBuffer | Uint8Array | string, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
};

export const FILES = "filer/";
export const COPIES = "kopier/";
const FOLDER_MARK = ".mappe";
export const MAX_UPLOAD_BYTES = 95 * 1024 * 1024;

/** A name as one may keep it: no slashes, no control characters, not empty, not "." or "..". */
export function cleanName(raw: string): string {
  const name = raw.normalize("NFC").replace(/[\u0000-\u001f\u007f\\/]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return name === "." || name === ".." || name === FOLDER_MARK ? "" : name;
}

/** A folder path inside the archive ("Regnskaber/2026"), cleaned: at most six levels. */
export function cleanFolder(raw: string | null | undefined): string {
  return String(raw ?? "").split("/").map(cleanName).filter(Boolean).slice(0, 6).join("/");
}

const prefixOf = (folder: string) => `${FILES}${folder ? `${folder}/` : ""}`;

export type FolderView = { folder: string; folders: string[]; files: Array<{ key: string; name: string; size: number; uploaded: number; by: string }> };

export async function listFolder(bucket: ArchiveBucket, folderPath: string): Promise<FolderView> {
  const folder = cleanFolder(folderPath), prefix = prefixOf(folder);
  const folders: string[] = [], files: FolderView["files"] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const result = await bucket.list({ prefix, delimiter: "/", cursor, limit: 1000, include: ["customMetadata"] });
    folders.push(...result.delimitedPrefixes.map(p => p.slice(prefix.length).replace(/\/$/, "")));
    for (const o of result.objects) {
      const name = o.key.slice(prefix.length);
      if (name === FOLDER_MARK) continue;
      files.push({ key: o.key, name, size: o.size, uploaded: o.uploaded.getTime(), by: o.customMetadata?.by ?? "" });
    }
    if (!result.truncated) break;
    cursor = result.cursor;
  }
  const da = (a: string, b: string) => a.localeCompare(b, "da");
  return { folder, folders: folders.sort(da), files: files.sort((a, b) => da(a.name, b.name)) };
}

/** A file into a folder; a name already there gets " (2)", " (3)" ... */
export async function uploadFile(bucket: ArchiveBucket, folderPath: string, file: { name: string; type: string; bytes: ArrayBuffer }, by: string, nowMs: number): Promise<string> {
  const prefix = prefixOf(cleanFolder(folderPath));
  const name = cleanName(file.name) || "fil";
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  let key = `${prefix}${name}`;
  for (let n = 2; await bucket.head(key) && n < 100; n++) key = `${prefix}${stem} (${n})${ext}`;
  await bucket.put(key, file.bytes, { httpMetadata: { contentType: file.type || "application/octet-stream" }, customMetadata: { by, at: String(nowMs) } });
  return key;
}

export async function makeFolder(bucket: ArchiveBucket, folderPath: string, name: string): Promise<string | null> {
  const clean = cleanName(name);
  if (!clean) return null;
  const folder = cleanFolder(`${cleanFolder(folderPath)}/${clean}`);
  await bucket.put(`${prefixOf(folder)}${FOLDER_MARK}`, "");
  return folder;
}

/** Only files in the file archive - never a copy, never outside filer/. */
export async function deleteFile(bucket: ArchiveBucket, key: string): Promise<boolean> {
  if (!key.startsWith(FILES) || key.endsWith(`/${FOLDER_MARK}`) || key.includes("/../")) return false;
  await bucket.delete(key);
  return true;
}

/** A folder goes only when it is empty. */
export async function deleteFolder(bucket: ArchiveBucket, folderPath: string): Promise<boolean> {
  const folder = cleanFolder(folderPath);
  if (!folder) return false;
  const inside = await bucket.list({ prefix: prefixOf(folder), limit: 2 });
  if (inside.objects.some(o => !o.key.endsWith(`/${FOLDER_MARK}`)) || inside.delimitedPrefixes.length) return false;
  await bucket.delete(`${prefixOf(folder)}${FOLDER_MARK}`);
  return true;
}

export type Copy = { key: string; day: string; size: number; uploaded: number };

export async function copies(bucket: ArchiveBucket): Promise<Copy[]> {
  const all: Copy[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const result = await bucket.list({ prefix: COPIES, cursor, limit: 1000 });
    for (const o of result.objects) {
      const day = /(\d{4}-\d{2}-\d{2})/.exec(o.key)?.[1];
      if (day) all.push({ key: o.key, day, size: o.size, uploaded: o.uploaded.getTime() });
    }
    if (!result.truncated) break;
    cursor = result.cursor;
  }
  return all.sort((a, b) => b.day.localeCompare(a.day));
}

/** The copies to keep: the newest 30, and the first copy of each month for the last twelve months. */
export function copiesToKeep(list: Copy[]): Set<string> {
  const sorted = [...list].sort((a, b) => b.day.localeCompare(a.day));
  const keep = new Set(sorted.slice(0, 30).map(c => c.key));
  const months = new Map<string, Copy>();
  for (const c of [...sorted].reverse()) if (!months.has(c.day.slice(0, 7))) months.set(c.day.slice(0, 7), c);
  for (const c of [...months.values()].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 12)) keep.add(c.key);
  return keep;
}

export async function pruneCopies(bucket: ArchiveBucket): Promise<number> {
  const list = await copies(bucket);
  const keep = copiesToKeep(list);
  const gone = list.filter(c => !keep.has(c.key)).map(c => c.key);
  if (gone.length) await bucket.delete(gone);
  return gone.length;
}
