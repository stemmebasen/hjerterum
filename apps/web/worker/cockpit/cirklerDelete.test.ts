import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { BOARD, deps, fakeServices, OWNER, personalCookie, sagaEnv, testDatabase } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";
import { reserveForMeeting } from "../cirkler-reservations.js";

// Requested (the chair, 3 Nov 2026): "Gør mig i stand til at slette CIRKLER-møder som formand".
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-11-03T12:00:00Z");

describe("a CIRKLER meeting deleted by the chair", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("frees the hall, is the chair's alone, and is in the chair's log", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { headers: { "content-type": "application/json" } })));
    const db = testDatabase();
    const services = fakeServices();
    const env = sagaEnv(db);
    for (const [i, [name, tid]] of ([["Jacob Hauge", OWNER], ["Lisbeth", "201"]] as const).entries())
      await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: tid, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
    const reservation = await reserveForMeeting(db, "meeting-42", { startsAt: "2026-11-14T18:30:00Z", endsAt: "2026-11-14T21:00:00Z", setupMinutes: 0, cleanupMinutes: 0 }, NOW);
    const id = Number(reservation.reference);
    const call = (path: string, cookie: string, method = "GET") => handleCockpitRequest(new Request(ORIGIN + path, { method, redirect: "manual",
      headers: { cookie, ...(method === "POST" ? { origin: ORIGIN } : {}) } }), env, deps(services.fetcher, NOW));
    const chair = await personalCookie("Jacob Hauge", NOW), lisbeth = await personalCookie("Lisbeth", NOW);

    // The board sees it, as before; only the chair has Slet.
    expect(await (await call("/arrangementer", lisbeth)).text()).not.toContain(`/arrangementer/system/${id}/slet`);
    const page = await (await call("/arrangementer", chair)).text();
    expect(page).toContain(`/arrangementer/system/${id}/slet`);
    expect(page).toContain("CIRKLER får ikke besked");
    expect((await call(`/arrangementer/system/${id}/slet`, lisbeth, "POST")).status).toBe(403);
    // Never changed here - only deleted.
    expect((await call(`/arrangementer/system/${id}`, chair)).status).toBe(404);

    expect((await call(`/arrangementer/system/${id}/slet`, chair, "POST")).headers.get("location")).toBe("/arrangementer?system=cirkler-slettet#system-events");
    expect(await db.prepare("SELECT status FROM room_bookings WHERE id = ?").bind(id).first()).toEqual({ status: "cancelled" });
    const after = await (await call("/arrangementer?system=cirkler-slettet", chair)).text();
    expect(after).toContain("CIRKLER-mødet er slettet, og salen er ledig.");
    expect(after).not.toContain(`/arrangementer/system/${id}/slet`);
    expect((await db.prepare("SELECT power, detail FROM chair_audit").all<{ power: string; detail: string }>()).results).toEqual([{ power: "cirkler.delete", detail: "Slettede CIRKLER-mødet 2026-11-14 18:30 UTC (frigav salen)" }]);
  });
});
