import { describe, expect, it } from "vitest";
import { setSiteLive, siteLive, toPublicSite } from "./public-site.js";
import { testDatabase } from "./saga/test-support.js";

// Requested (5 Nov 2026): "Vigtigt at vi først bruger den nye url når vi er begyndt at bruge den nye hjemmeside."
describe("the public website's address in what goes out", () => {
  it("is the old website's until the chair says the new one is in use", async () => {
    const db = testDatabase();
    await db.prepare(`INSERT INTO house_events (id, title, starts_at_ms, link, content_hash, updated_at_ms) VALUES ('SF69c0139078ffd0f6f3047932', 'Source Breathwork', 1, 'https://holistisk.org/events/#!event/2026/11/4/source-breathwork', 'x', 1)`).run();
    const text = "Læs mere: https://www.hjerterum.info/events/69c0139078ffd0f6f3047932\nSe alle events og tilmeld dig: https://www.hjerterum.info/events\nLæs mere og tilmeld dig på hjerterum.info/events (link i bio).\nEget event: https://www.hjerterum.info/events/h12 <img src=\"https://www.hjerterum.info/brand/logo.png\">";
    expect(await siteLive(db)).toBe(false);
    expect(await toPublicSite(db, text)).toBe("Læs mere: https://holistisk.org/events/#!event/2026/11/4/source-breathwork\nSe alle events og tilmeld dig: https://holistisk.org/events/\nLæs mere og tilmeld dig på holistisk.org/events (link i bio).\nEget event: https://www.hjerterum.info/events/h12 <img src=\"https://www.hjerterum.info/brand/logo.png\">");
    expect(await toPublicSite(db, "https://www.hjerterum.info/events/6abba949e1a89220c3050d27")).toBe("https://holistisk.org/events/");
    expect(await toPublicSite(db, '<a href="https://www.hjerterum.info/events" style="x">')).toBe('<a href="https://holistisk.org/events/" style="x">');
    await setSiteLive(db, true, "Jacob Hauge", 2);
    expect(await toPublicSite(db, text)).toBe(text);
  });
});
