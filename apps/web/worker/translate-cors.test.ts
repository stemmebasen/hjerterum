import { describe, expect, it } from "vitest";
import { translationHeaders } from "./config-entry.js";

// Reported: "Translate doesn't work" - Google Translate's copy of the page may read our public files and calendar, nothing else.
describe("the page through Google Translate", () => {
  const ask = (path: string, origin = "https://www-hjerterum-info.translate.goog", method = "GET") =>
    translationHeaders(new Request(`https://www.hjerterum.info${path}`, { method, headers: { origin } }), new Response("ok")).headers.get("access-control-allow-origin");
  it("opens the built files, pictures and the public calendar to Google's translation only", () => {
    for (const path of ["/assets/index-abc.js", "/media/cirkler-logo.png", "/api/events/external", "/api/events/external/6ad5d1369e8a60ed5700d232", "/api/room-bookings/public", "/api/room-bookings/public/7", "/api/public-profiles"])
      expect(ask(path), path).toBe("https://www-hjerterum-info.translate.goog");
    for (const path of ["/api/members/me", "/api/room-bookings/calendar", "/api/room-bookings/7/guest", "/cockpit"]) expect(ask(path), path).toBeNull();
    expect(ask("/assets/index-abc.js", "https://evil.example")).toBeNull();
    expect(ask("/api/room-bookings/public", "https://www-hjerterum-info.translate.goog", "POST")).toBeNull();
  });
});
