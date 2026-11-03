import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanFolder, copiesToKeep, deleteFile, deleteFolder, listFolder, makeFolder, pruneCopies, uploadFile, type ArchiveBucket, type ArchiveObject } from "./archive.js";
import { handleCockpitRequest } from "./cockpit/handler.js";
import { scheduledArchive } from "./archive-jobs.js";
import { BOARD, deps, fakeServices, OWNER, personalCookie, sagaEnv, testDatabase, memberCookie } from "./saga/test-support.js";
import { saveBoardMessage } from "./saga/store.js";

/** R2, in memory. */
export function memoryBucket(): ArchiveBucket & { keys(): string[] } {
  const store = new Map<string, { bytes: Uint8Array; meta: ArchiveObject }>();
  const bytesOf = async (v: ReadableStream | ArrayBuffer | Uint8Array | string) => typeof v === "string" ? new TextEncoder().encode(v) : v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(await new Response(v).arrayBuffer());
  return {
    keys: () => [...store.keys()].sort(),
    async put(key, value, options) { const bytes = await bytesOf(value); store.set(key, { bytes, meta: { key, size: bytes.byteLength, uploaded: new Date(), ...(options?.customMetadata ? { customMetadata: options.customMetadata } : {}), ...(options?.httpMetadata ? { httpMetadata: options.httpMetadata } : {}) } }); },
    async head(key) { return store.get(key)?.meta ?? null; },
    async get(key) { const o = store.get(key); return o ? { ...o.meta, body: new Response(o.bytes as unknown as BodyInit).body! } : null; },
    async delete(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k); },
    async list({ prefix = "", delimiter }) {
      const objects: ArchiveObject[] = [], prefixes = new Set<string>();
      for (const [key, o] of [...store].sort(([a], [b]) => a.localeCompare(b))) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (delimiter && rest.includes(delimiter)) prefixes.add(prefix + rest.slice(0, rest.indexOf(delimiter) + 1)); else objects.push(o.meta);
      }
      return { objects, delimitedPrefixes: [...prefixes], truncated: false };
    }
  };
}

// Requested: "kan vi ikke helt erstatte Google-kontoen og så lave 'vores egen Google-konto' med R2 i admin?" - "Og så skal der i admin være et form for filarkiv".
describe("the file archive", () => {
  it("keeps files in folders, never two with one name, and deletes only files and empty folders", async () => {
    const bucket = memoryBucket();
    expect(cleanFolder(" Regnskaber / ../2026//x\\y ")).toBe("Regnskaber/2026/x y");
    expect(await makeFolder(bucket, "", "Regnskaber")).toBe("Regnskaber");
    const a = await uploadFile(bucket, "Regnskaber", { name: "årsrapport.pdf", type: "application/pdf", bytes: new Uint8Array([1, 2]).buffer }, "Jacob Hauge", 1);
    const b = await uploadFile(bucket, "Regnskaber", { name: "årsrapport.pdf", type: "application/pdf", bytes: new Uint8Array([3]).buffer }, "Jacob Hauge", 2);
    expect([a, b]).toEqual(["filer/Regnskaber/årsrapport.pdf", "filer/Regnskaber/årsrapport (2).pdf"]);
    expect(await listFolder(bucket, "")).toMatchObject({ folder: "", folders: ["Regnskaber"], files: [] });
    expect((await listFolder(bucket, "Regnskaber")).files.map(f => [f.name, f.size, f.by])).toEqual([["årsrapport (2).pdf", 1, "Jacob Hauge"], ["årsrapport.pdf", 2, "Jacob Hauge"]]);
    expect(await deleteFolder(bucket, "Regnskaber")).toBe(false);
    expect(await deleteFile(bucket, "kopier/hjerterum-2026-11-01.sql.gz")).toBe(false);
    expect(await deleteFile(bucket, a)).toBe(true);
    expect(await deleteFile(bucket, b)).toBe(true);
    expect(await deleteFolder(bucket, "Regnskaber")).toBe(true);
    expect(bucket.keys()).toEqual([]);
  });

  it("keeps the newest 30 copies and the first of each month for a year", async () => {
    const days: string[] = [];
    for (let d = new Date("2025-06-01T12:00:00Z"); d <= new Date("2026-11-03T12:00:00Z"); d = new Date(d.getTime() + 86_400_000)) days.push(d.toISOString().slice(0, 10));
    const list = days.map(day => ({ key: `kopier/hjerterum-${day}.sql.gz`, day, size: 1, uploaded: 0 }));
    const keep = copiesToKeep(list);
    expect(keep.has("kopier/hjerterum-2026-11-03.sql.gz")).toBe(true);
    expect(keep.has("kopier/hjerterum-2026-10-05.sql.gz")).toBe(true);
    expect(keep.has("kopier/hjerterum-2026-10-04.sql.gz")).toBe(false);
    expect(keep.has("kopier/hjerterum-2026-03-01.sql.gz")).toBe(true);
    expect(keep.has("kopier/hjerterum-2026-03-02.sql.gz")).toBe(false);
    expect(keep.has("kopier/hjerterum-2025-12-01.sql.gz")).toBe(true);
    expect(keep.has("kopier/hjerterum-2025-11-01.sql.gz")).toBe(false);
    expect(keep.size).toBe(30 + 11);
    const bucket = memoryBucket();
    for (const c of list.slice(-40)) await bucket.put(c.key, "x");
    await bucket.put("filer/vedtaegter.pdf", "x");
    // The last 40 nights: the newest 30 stay, and the first of September and of October.
    expect(await pruneCopies(bucket)).toBe(40 - 30 - 2);
    expect(bucket.keys()).toContain("filer/vedtaegter.pdf");
  });
});

describe("Filarkiv in admin", () => {
  afterEach(() => vi.unstubAllGlobals());
  const ORIGIN = "https://admin.hjerterum.example", NOW = Date.parse("2026-11-03T10:00:00Z");

  it("is the chair's: upload, folders, download, delete, and the copies to download", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase(), bucket = memoryBucket();
    await bucket.put("kopier/hjerterum-2026-11-03.sql.gz", "CREATE TABLE ...");
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026", ARCHIVE: bucket } as never);
    const call = (path: string, init: RequestInit & { cookie?: string } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
      ...init, redirect: "manual", headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(fakeServices().fetcher, NOW));
    const form = (fields: Record<string, string | File>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
    const session = ((await call("/login", { method: "POST", body: form({ password: "hjerte-2026" }) })).headers.get("set-cookie") ?? "").split(";")[0]!;
    for (const [i, [name, tid]] of ([["Jacob Hauge", OWNER], ["Lisbeth", "201"]] as const).entries())
      await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: tid, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
    expect((await call("/filarkiv", { cookie: await memberCookie(session, "Lisbeth") })).status).toBe(403);
    const cookie = await personalCookie("Jacob Hauge", NOW);
    expect(await (await call("/profil", { cookie })).text()).toContain('href="/filarkiv"');
    expect((await call("/filarkiv/mappe", { method: "POST", cookie, body: form({ mappe: "", navn: "Vedtægter" }) })).headers.get("location")).toBe("/filarkiv?mappe=Vedt%C3%A6gter&besked=mappe");
    expect((await call("/filarkiv/upload", { method: "POST", cookie, body: form({ mappe: "Vedtægter", filer: new File(["%PDF"], "vedtaegter-2026.pdf", { type: "application/pdf" }) }) })).headers.get("location")).toContain("besked=oppe");
    const page = await (await call("/filarkiv?mappe=Vedt%C3%A6gter", { cookie })).text();
    expect(page).toContain("vedtaegter-2026.pdf");
    expect(page).toContain("Jacob Hauge");
    const file = await call(`/filarkiv/fil?k=${encodeURIComponent("filer/Vedtægter/vedtaegter-2026.pdf")}`, { cookie });
    expect(file.headers.get("content-disposition")).toContain("attachment");
    expect(await file.text()).toBe("%PDF");
    // A copy can be fetched only as a copy, a file only as a file.
    expect((await call(`/filarkiv/fil?k=${encodeURIComponent("kopier/hjerterum-2026-11-03.sql.gz")}`, { cookie })).status).toBe(404);
    expect(await (await call("/filarkiv?vis=kopier", { cookie })).text()).toContain("tirsdag den 3. november 2026");
    expect(await (await call(`/filarkiv/kopi?k=${encodeURIComponent("kopier/hjerterum-2026-11-03.sql.gz")}`, { cookie })).text()).toBe("CREATE TABLE ...");
    await call("/filarkiv/slet", { method: "POST", cookie, body: form({ mappe: "Vedtægter", k: "filer/Vedtægter/vedtaegter-2026.pdf" }) });
    await call("/filarkiv/slet-mappe", { method: "POST", cookie, body: form({ mappe: "Vedtægter" }) });
    expect(bucket.keys()).toEqual(["kopier/hjerterum-2026-11-03.sql.gz"]);
  });

  it("reminds the chair on the 1st to download the month's copy", async () => {
    const db = testDatabase(), bucket = memoryBucket(), services = fakeServices();
    await bucket.put("kopier/hjerterum-2026-12-01.sql.gz", "x");
    const env = sagaEnv(db, { ARCHIVE: bucket, COCKPIT_URL: "https://admin.hjerterum.info" } as never);
    const claimed = new Set<string>();
    const claim = async (key: string, slot: number) => { const k = `${key}:${slot}`; if (claimed.has(k)) return false; claimed.add(k); return true; };
    await scheduledArchive(env, deps(services.fetcher, Date.parse("2026-12-01T07:00:00Z")), db, claim);
    expect(services.telegram("sendMessage")).toHaveLength(0);
    await scheduledArchive(env, deps(services.fetcher, Date.parse("2026-12-01T09:30:00Z")), db, claim);
    await scheduledArchive(env, deps(services.fetcher, Date.parse("2026-12-01T12:00:00Z")), db, claim);
    const sent = services.telegram("sendMessage");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ chat_id: OWNER, text: expect.stringContaining("https://admin.hjerterum.info/filarkiv?vis=kopier") });
  });
});
