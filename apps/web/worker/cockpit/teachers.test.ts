import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { listTeachers } from "./teachers.js";
import { insertMail, saveBoardMessage } from "../saga/store.js";
import { BOARD, deps, fakeServices, sagaEnv, testDatabase, memberCookie, memberCookies } from "../saga/test-support.js";
import type { D1Database } from "../db.js";

// Requested: "Vi skal også have en underside til arrangementer, som hedder Undervisere, hvor vi samler alle underviserne.
// Man kan så klikke ind på hver underviser, udfylde basis-kontaktinformationer, hvis systemet ikke allerede har dem, samt
// bede Saga om at lave et resumé af vores samarbejde med denne underviser." - "Men ser ikke, at man som udgangspunkt selv
// skal hente de undervisere, der allerede eksisterer." - "I bunden skal der stå ... © Jacob Hauge".
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-10-02T10:00:00Z");
const DAY = 86_400_000;

async function calendar(db: D1Database, id: string, title: string, host: string, at: number) {
  await db.prepare("INSERT INTO house_events (id, title, starts_at_ms, host, category, description, content_hash, updated_at_ms) VALUES (?, ?, ?, ?, 'Yoga & Meditation', ?, 'h', 1)")
    .bind(id, title, at, host, `Underviser: ${host}\nEn rolig time.`).run();
}

describe("Undervisere", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("collects the teachers by itself, knows their contacts, keeps the board's and lets Saga sum up the collaboration", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    await calendar(db, "1", "Yin yoga", "Karítas E. Langkjær", NOW - 30 * DAY);
    await calendar(db, "2", "Yin yoga", "Karítas E. Langkjær", NOW + 5 * DAY);
    await calendar(db, "3", "Lydbad", "Philip Lenbroch", NOW - 900 * DAY);
    await db.prepare("INSERT INTO fixed_teachers (email, name, added_by, added_at_ms) VALUES ('kasper@example.com', 'Kasper Frausing', 'Gitta', 1)").run();
    await insertMail(db, { ref: "m1", sender: "Karítas E. Langkjær <karitas@example.com>", subject: "Nye datoer i foråret", receivedAtMs: NOW - 3 * DAY, preview: "Kan jeg få tirsdage fra februar?", nowMs: NOW });
    await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Lisbeth", authorId: "201", text: "Karítas E. Langkjær vil gerne have tirsdage", sentAtMs: NOW - DAY, fromAssistant: false });

    const list = await listTeachers(db, NOW);
    expect(list.map(t => t.name)).toEqual(["Karítas E. Langkjær", "Kasper Frausing", "Philip Lenbroch"]);
    expect(list[0]).toMatchObject({ events: 2, upcoming: 1, hasContact: false });
    expect(list[1]).toMatchObject({ fixed: true, hasContact: true });

    let asked = "";
    const services = fakeServices({ ai: (_system, user) => { asked = user; return "- Karítas har holdt yin yoga i Hjerterum siden 2026.\n- Hun ønsker tirsdage fra februar (mail 29. sep.)."; } });
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    const call = (path: string, init: RequestInit & { cookie?: string } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
      ...init, headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, NOW));
    const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
    const session = ((await call("/login", { method: "POST", body: form({ password: "hjerte-2026" }) })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const cookie = await memberCookie(session, "Lisbeth");

    expect(await (await call("/arrangementer", { cookie })).text()).toContain('href="/arrangementer/undervisere">Undervisere →');
    const page = await (await call("/arrangementer/undervisere", { cookie })).text();
    expect(page).toContain("Karítas E. Langkjær");
    expect(page).toContain("Mangler kontakt");
    expect(page).toContain("Tidligere (1)");
    expect(page).toContain("© Jacob Hauge");

    const url = `/arrangementer/undervisere/${encodeURIComponent("karítas e. langkjær")}`;
    const detail = await (await call(url, { cookie })).text();
    expect(detail).toContain("karitas@example.com <span class=\"small muted\">· mail fra mail til team@");
    expect(detail).toContain('name="email" value="karitas@example.com"');
    expect(detail).toContain("Kommende");

    await call(url, { method: "POST", cookie, body: form({ action: "save", email: "karitas@example.com", phone: "+45 12 34 56 78", website: "karitas.dk", note: "Fast tirsdag?" }) });
    expect(await db.prepare("SELECT email, phone, website, note, updated_by FROM cockpit_teachers").first()).toEqual({ email: "karitas@example.com", phone: "+45 12 34 56 78", website: "https://karitas.dk", note: "Fast tirsdag?", updated_by: "Lisbeth" });

    const summed = await call(url, { method: "POST", cookie, body: form({ action: "summary" }) });
    expect(summed.headers.get("location")).toContain("besked=resume");
    expect(asked).toContain("ARRANGEMENTER (2 i alt");
    expect(asked).toContain("Kan jeg få tirsdage fra februar?");
    expect(asked).toContain("Lisbeth: Karítas E. Langkjær vil gerne have tirsdage");
    expect(asked).toContain("Fast tirsdag?");
    const after = await (await call(url, { cookie })).text();
    expect(after).toContain("<li>Hun ønsker tirsdage fra februar (mail 29. sep.).</li>");
    expect((await call("/arrangementer/undervisere/ukendt%20person", { cookie })).status).toBe(404);
  });
});
