import { describe, expect, it } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { saveBoardMessage } from "../saga/store.js";
import { BOARD, deps, fakeServices, memberCookie, OWNER, personalCookie, sagaEnv, testDatabase } from "../saga/test-support.js";
import { studioData } from "./posterStudio.js";
import { teacherOfSender } from "./eventArchive.js";

// Asked (the chair, 6 Nov 2026): "Der er slet ikke noget i vores filarkiv endnu? Hvad med event materialet som aftalt?" - "Underviser -> Dato/Event. Generelt
// materiale lægger i selve underviser-mappen" - "Det er også disse mapper Saga skal søge i ved PR".
const NOW = Date.parse("2026-11-06T12:00:00Z");
const ORIGIN = "https://admin.hjerterum.example";
const HEX = "6ae8cff06e0ca88f0503bf74";
const JPEG = (() => { const b = new Uint8Array(60_000); b.set([0xff, 0xd8, 0xff, 0xe0]); return b; })();

async function setup() {
  const db = testDatabase();
  const objects = new Map<string, Uint8Array>();
  const media = { put: async (k: string, v: ArrayBuffer) => { objects.set(k, new Uint8Array(v)); return {}; }, get: async (k: string) => objects.has(k) ? { body: new Blob([objects.get(k)!.slice()]).stream() } : null,
    delete: async (k: string) => { objects.delete(k); } };
  const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026", EVENT_MEDIA: media } as never);
  for (const [i, [name, tid]] of ([["Jacob Hauge", OWNER], ["Lisbeth", "201"]] as const).entries())
    await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: tid, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
  await db.prepare("INSERT INTO house_events (id, title, starts_at_ms, host, content_hash, updated_at_ms) VALUES (?, 'Nærvær', ?, 'Pia Lundgaard', 'x', 0), ('SFother', 'Aften uden vært', ?, NULL, 'x', 0)")
    .bind(`SF${HEX}`, Date.parse("2026-11-24T18:00:00Z"), Date.parse("2026-11-20T18:00:00Z")).run();
  // What Pia's PR mail brought, with the event.
  await db.prepare("INSERT INTO event_material (event_key, mail_id, kind, filename, content_type, r2_key, size_bytes, created_at_ms) VALUES (?, NULL, 'file', 'program.pdf', 'application/pdf', 'material/x/1.pdf', 1200, ?)").bind(`mw:SF${HEX}`, NOW).run();
  await media.put("material/x/1.pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer);
  const session = ((await handleCockpitRequest(new Request(`${ORIGIN}/login`, { method: "POST", body: (() => { const f = new FormData(); f.append("password", "hjerte-2026"); return f; })(), redirect: "manual", headers: { origin: ORIGIN } }), env, deps(fakeServices().fetcher, NOW)))
    .headers.get("set-cookie") ?? "").split(";")[0]!;
  const call = (path: string, cookie: string, init: RequestInit = {}) => handleCockpitRequest(new Request(ORIGIN + path, { ...init, redirect: "manual", headers: { cookie, ...(init.method === "POST" ? { origin: ORIGIN } : {}) } }), env, deps(fakeServices().fetcher, NOW));
  return { db, call, session };
}

describe("Filarkiv → Undervisere", () => {
  it("has a folder for each teacher, a folder for each of their events, and their general material - and Saga uses it", async () => {
    const { db, call } = await setup();
    const chair = await personalCookie("Jacob Hauge", NOW);
    const root = await (await call("/filarkiv", chair)).text();
    expect(root).toContain(`href="/filarkiv?mappe=Undervisere"`);
    const teachers = await (await call("/filarkiv?mappe=Undervisere", chair)).text();
    expect(teachers).toContain("Pia Lundgaard");
    expect(teachers).toContain("Hjerterum"); // the board's own events, without a teacher
    const pia = await (await call(`/filarkiv?mappe=${encodeURIComponent("Undervisere/Pia Lundgaard")}`, chair)).text();
    expect(pia).toContain(`mappe=${encodeURIComponent(`Undervisere/Pia Lundgaard/mw:SF${HEX}`)}`);
    expect(pia).toContain("2026-11-24 · Nærvær");
    const event = await (await call(`/filarkiv?mappe=${encodeURIComponent(`Undervisere/Pia Lundgaard/mw:SF${HEX}`)}`, chair)).text();
    expect(event).toContain("program.pdf");
    // General material in Pia's own folder - and Plakater og opslag offers it for her events.
    const form = new FormData(); form.append("mappe", "Undervisere/Pia Lundgaard"); form.append("filer", new File([JPEG], "portraet.jpg", { type: "image/jpeg" }));
    expect((await call("/filarkiv/materiale-upload", chair, { method: "POST", body: form })).headers.get("location")).toContain("besked=oppe");
    expect(await (await call(`/filarkiv?mappe=${encodeURIComponent("Undervisere/Pia Lundgaard")}`, chair)).text()).toContain("portraet.jpg");
    expect((await studioData(db, HEX, NOW))!.teacher!.pictures.some(p => p.label === "Fra underviserens mappe: portraet.jpg")).toBe(true);
    // A PR mail from Pia that is about no one event: her folder.
    expect(await teacherOfSender(db, "Pia Lundgaard <pia@example.dk>")).toBe("Pia Lundgaard");
    expect(await teacherOfSender(db, "Ukendt <x@example.dk>")).toBeNull();
  });

  it("is the board's to see and add to; deleting is the chair's", async () => {
    const { call, session } = await setup();
    const chair = await personalCookie("Jacob Hauge", NOW);
    const folder = encodeURIComponent(`Undervisere/Pia Lundgaard/mw:SF${HEX}`);
    const event = await (await call(`/filarkiv?mappe=${folder}`, chair)).text();
    expect(event).toContain('action="/filarkiv/materiale-slet"');
    const id = /name="id" value="(\d+)"/.exec(event)![1]!;
    // Lisbeth sees it and adds to it, but may not delete.
    const lisbeth = await memberCookie(session, "Lisbeth");
    const hers = await (await call(`/filarkiv?mappe=${folder}`, lisbeth)).text();
    expect(hers).toContain("program.pdf");
    expect(hers).not.toContain('action="/filarkiv/materiale-slet"');
    const up = new FormData(); up.append("mappe", `Undervisere/Pia Lundgaard/mw:SF${HEX}`); up.append("filer", new File([JPEG], "plakat.jpg", { type: "image/jpeg" }));
    expect((await call("/filarkiv/materiale-upload", lisbeth, { method: "POST", body: up })).headers.get("location")).toContain("besked=oppe");
    const del = () => { const f = new FormData(); f.append("id", id); f.append("mappe", `Undervisere/Pia Lundgaard/mw:SF${HEX}`); return f; };
    expect((await call("/filarkiv/materiale-slet", lisbeth, { method: "POST", body: del() })).status).toBe(403);
    expect((await call("/filarkiv/materiale-slet", chair, { method: "POST", body: del() })).headers.get("location")).toContain("besked=slettet");
    const after = await (await call(`/filarkiv?mappe=${folder}`, chair)).text();
    expect(after).not.toContain("program.pdf");
    expect(after).toContain("plakat.jpg");
  });
});
