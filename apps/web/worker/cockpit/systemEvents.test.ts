import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { createRoomBooking, normalizeCreateRoomBookingInput } from "../room-bookings.js";
import { deps, fakeServices, sagaEnv, testDatabase, memberCookie } from "../saga/test-support.js";

// Requested by the chair: "Som admin skal man kunne redigere og slette events oprettet i systemet."
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-11-01T10:00:00Z");

describe("the board changes and deletes members' events", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists the coming events, changes words and time, refuses a taken hall, and deletes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const make = (title: string, day: string, from: string, to: string) => createRoomBooking(db, "member-1", normalizeCreateRoomBookingInput({
      teacherName: "Maria", teacherEmail: "maria@example.com", title, description: "Rolig yoga.", startsAt: `${day}T${from}:00Z`, endsAt: `${day}T${to}:00Z` }));
    const yoga = await make("Yin yoga", "2026-12-02", "09:00", "11:00");
    await make("Lydbad", "2026-12-02", "13:00", "15:00");
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    const call = (path: string, init: RequestInit & { cookie?: string } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
      ...init, redirect: "manual", headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(fakeServices().fetcher, NOW));
    const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
    const session = ((await call("/login", { method: "POST", body: form({ password: "hjerte-2026" }) })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const cookie = await memberCookie(session, "Lisbeth");
    const id = yoga.id;

    const page = await (await call("/arrangementer", { cookie })).text();
    expect(page).toContain("Events oprettet i systemet");
    expect(page).toContain(`href="/arrangementer/system/${id}"`);
    expect(page).toContain(`action="/arrangementer/system/${id}/slet"`);
    expect(await (await call(`/arrangementer/system/${id}`, { cookie })).text()).toContain('value="Yin yoga"');

    // New words and a new time (10-12 Danish time).
    const saved = await call(`/arrangementer/system/${id}`, { method: "POST", cookie, body: form({ title: "Yin yoga for alle", teacher: "Maria Holm", date: "2026-12-02", start: "10:00", end: "12:00", description: "Ny tekst.", max: "14" }) });
    expect(saved.status).toBe(303);
    const row = await db.prepare("SELECT title, teacher_name, description, starts_at_ms, ends_at_ms, max_attendees FROM room_bookings WHERE id = ?").bind(id).first<Record<string, unknown>>();
    expect(row).toMatchObject({ title: "Yin yoga for alle", teacher_name: "Maria Holm", description: "Ny tekst.", starts_at_ms: Date.parse("2026-12-02T09:00:00Z"), ends_at_ms: Date.parse("2026-12-02T11:00:00Z"), max_attendees: 14 });

    // Onto the other event's time: refused, nothing changed.
    const clash = await call(`/arrangementer/system/${id}`, { method: "POST", cookie, body: form({ title: "Yin yoga for alle", teacher: "Maria Holm", date: "2026-12-02", start: "14:00", end: "16:00" }) });
    expect(clash.status).toBe(409);
    expect(await clash.text()).toContain("Salen er optaget");

    // Deleted: cancelled, gone from the list.
    expect((await call(`/arrangementer/system/${id}/slet`, { method: "POST", cookie })).status).toBe(303);
    expect((await db.prepare("SELECT status FROM room_bookings WHERE id = ?").bind(id).first<{ status: string }>())?.status).toBe("cancelled");
    expect(await (await call("/arrangementer", { cookie })).text()).not.toContain(`/arrangementer/system/${id}"`);
  });
});
