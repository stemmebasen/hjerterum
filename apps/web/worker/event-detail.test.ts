import { describe, expect, it, vi } from "vitest";
import { eventDetail, eventIdOf, htmlParagraphs } from "./event-detail.js";
import { linkParts, plainLine } from "../site/event-links.js";
import { useEventStore } from "./external-events.js";
import { testDatabase } from "./saga/test-support.js";

// Requested: "Prøv at fetche event detaljer automatisk så vi ikke sender folk til en anden hjemmeside."
const EID = "6ab62c8403ff4831ef0b0ff4";
const EVENT = { ttl: "Dhyana Yoga", sdp: 1791880200, edp: 1791883800, adr: { ad1: "Guldsmedgade 26", zip: "8000", cit: "Aarhus", loc: ["10.2078481", "56.1593182"] }, cap: 14,
  dtl: "<p><strong>Dhyana Yoga&nbsp;<br />Teacher: Kasper</strong></p>\r\n<p>&nbsp;</p><div dir=\"auto\">One hour of silence.</div><script>alert(1)</script><ul><li>Mantra</li></ul>",
  tkt: [{ lbl: "Medlem - 80kr" }, { lbl: "Ikke-medlem - se n&#230;rmere info" }] };


describe("an event's own page", () => {
  it("turns the source's HTML into plain paragraphs, without scripts", () => {
    expect(htmlParagraphs(EVENT.dtl)).toEqual(["Dhyana Yoga", "Teacher: Kasper", "One hour of silence.", "• Mantra"]);
  });

  // "alle forbindelser til ... membership works skal klippes" (the chair, 27 Nov 2026): the page is made from the kept calendar, coming or past - never fetched.
  it("is made from the kept calendar, also for an event that has been held, and refuses what is not an event id", async () => {
    const db = testDatabase();
    await db.prepare(`INSERT INTO house_events (id, title, starts_at_ms, ends_at_ms, location, host, category, image_url, description, content_hash, updated_at_ms)
      VALUES (?, 'Dhyana Yoga', ?, ?, 'Hjerterum', 'Kasper Frausing', 'Yoga & Meditation', 'https://img/x.jpg', ?, 'x', 0)`).bind(`SF${EID}`, Date.parse("2021-10-13T08:30:00Z"), Date.parse("2021-10-13T09:30:00Z"), EVENT.dtl).run();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    useEventStore(db);
    const detail = (await eventDetail(EID, 1))!;
    expect(detail).toMatchObject({ title: "Dhyana Yoga", host: "Kasper Frausing", category: "Yoga & Meditation", imageUrl: "https://img/x.jpg", address: "Hjerterum", signUpUrl: null, tickets: [] });
    expect(detail.paragraphs).toContain("One hour of silence.");
    expect(await eventDetail("../etc", 1)).toBeNull();
    expect(await eventDetail("6ab62c8403ff4831ef0b0fff", 1)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(eventIdOf({ id: `SF${EID}` })).toBe(EID);
    expect(eventIdOf({ id: "hjerteland-1" })).toBeNull();
    useEventStore(null);
    vi.unstubAllGlobals();
  });
});

describe("finding the way to an event", () => {
  it("opens Rejseplanen with Hjerterum as the destination, arriving a quarter before the start", async () => {
    const { journeyUrl, mapUrl } = await import("../src/event-way");
    const url = new URL(journeyUrl("Guldsmedgade 26B, 8000 Aarhus C", "2026-10-13T08:30:00.000Z"));
    expect(url.origin + url.pathname).toBe("https://www.rejseplanen.dk/bin/query.exe/mn");
    expect(Object.fromEntries(url.searchParams)).toEqual({ Z: "Guldsmedgade 26B, 8000 Aarhus C", ZADR: "1", timesel: "arrive", date: "13.10.26", time: "10:15" });
    expect(mapUrl(56.159318, 10.207848).open).toContain("mlat=56.159318&mlon=10.207848");
  });
});


// Requested (3 Nov 2026): "I have Source Breathwork as a link in the old system, but it just gets the text but not the link."
describe("links in an event's description", () => {
  it("keep their address as [text](address), and a bare address stays bare", () => {
    expect(htmlParagraphs('<p>Læs om <a href="https://example.dk/source?a=1&amp;b=2" target="_blank"><strong>Source Breathwork</strong></a> her.</p><p><a href="https://www.lisalawrie.com/">www.lisalawrie.com</a></p>'))
      .toEqual(["Læs om [Source Breathwork](https://example.dk/source?a=1&b=2) her.", "https://www.lisalawrie.com/"]);
    expect(htmlParagraphs('<p><a href="mailto:a@b.dk">Skriv til os</a> · <a href="javascript:alert(1)">klik</a> · <a href="/intern">her</a></p>')).toEqual(["[Skriv til os](mailto:a@b.dk) · klik · her"]);
  });

  it("are links on the page and plain text elsewhere", () => {
    expect(linkParts("Mød [Source Breathwork](https://x.dk/sb) og se https://www.y.dk/ i dag")).toEqual([
      { text: "Mød " }, { text: "Source Breathwork", href: "https://x.dk/sb" }, { text: " og se " }, { text: "y.dk", href: "https://www.y.dk/" }, { text: " i dag" }]);
    expect(plainLine("Mød [Source Breathwork](https://x.dk/sb) i dag")).toBe("Mød Source Breathwork i dag");
  });
});
