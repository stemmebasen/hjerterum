import { describe, expect, it } from "vitest";
import { eventDetail, eventIdOf, htmlParagraphs, withDescriptions } from "./event-detail.js";
import { getExternalEvents } from "./external-events.js";

// Requested: "Prøv at fetche event detaljer automatisk så vi ikke sender folk til en anden hjemmeside."
const EID = "6ab62c8403ff4831ef0b0ff4";
const FEED = `<rss><channel><item><title>Dhyana Yoga</title><guid isPermaLink="false">SF${EID}</guid>
<link>https://holistisk.org/events/#!event/2026/10/13/dhyana-yoga</link><media:content medium="image" url="https://img/x.jpg" />
<category>Yoga &#x26; Meditation</category><ev:startdate>2026-10-13T10:30:00+02:00</ev:startdate><ev:enddate>2026-10-13T11:30:00+02:00</ev:enddate>
<ev:organizer>Kasper Frausing</ev:organizer><content:encoded><![CDATA[<p>Kort</p>]]></content:encoded></item></channel></rss>`;
const EVENT = { ttl: "Dhyana Yoga", sdp: 1791880200, edp: 1791883800, adr: { ad1: "Guldsmedgade 26", zip: "8000", cit: "Aarhus", loc: ["10.2078481", "56.1593182"] }, cap: 14,
  dtl: "<p><strong>Dhyana Yoga&nbsp;<br />Teacher: Kasper</strong></p>\r\n<p>&nbsp;</p><div dir=\"auto\">One hour of silence.</div><script>alert(1)</script><ul><li>Mantra</li></ul>",
  tkt: [{ lbl: "Medlem - 80kr" }, { lbl: "Ikke-medlem - se n&#230;rmere info" }] };

const fetcher = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("_op=rss")) return new Response(FEED);
  if (url.includes(`eid=${EID}`)) return new Response(JSON.stringify(EVENT));
  return new Response("{}", { status: 404 });
}) as typeof fetch;

describe("an event's own page", () => {
  it("turns the source's HTML into plain paragraphs, without scripts", () => {
    expect(htmlParagraphs(EVENT.dtl)).toEqual(["Dhyana Yoga", "Teacher: Kasper", "One hour of silence.", "• Mantra"]);
  });

  it("joins the feed and MembershipWorks' event details, and refuses what is not an event id", async () => {
    await getExternalEvents(true, fetcher);
    const detail = (await eventDetail(EID, fetcher, 1))!;
    expect(detail).toMatchObject({ title: "Dhyana Yoga", host: "Kasper Frausing", category: "Yoga & Meditation", imageUrl: "https://img/x.jpg",
      address: "Guldsmedgade 26, 8000 Aarhus", capacity: 14, lat: 56.1593182, lon: 10.2078481, signUpUrl: "https://holistisk.org/events/#!event/2026/10/13/dhyana-yoga" });
    expect(detail.tickets).toEqual(["Medlem - 80kr", "Ikke-medlem - se nærmere info"]);
    expect(detail.paragraphs).toContain("One hour of silence.");
    expect(await eventDetail("../etc", fetcher, 1)).toBeNull();
    expect(eventIdOf({ id: `SF${EID}` })).toBe(EID);
    expect(eventIdOf({ id: "hjerteland-1" })).toBeNull();
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

// Asked: "Hvilket URL er så den rigtige? .../api/events/upcoming" - the radio spots' feed needs the text of the events the RSS feed leaves out.
describe("the text of events from the widget's list", () => {
  const listed = { id: `SF${EID}`, source: "membershipworks" as const, title: "Dhyana Yoga", startsAt: "2026-10-13T08:30:00.000Z", endsAt: null,
    location: null, imageUrl: null, link: null, host: null, description: null, category: null };
  const NOW = Date.parse("2026-10-12T00:00:00.000Z");

  it("is read from the event's details for the coming days", async () => {
    const [event] = await withDescriptions([listed], NOW + 14 * 86_400_000, fetcher, NOW);
    expect(event!.description).toBe("Dhyana Yoga\nTeacher: Kasper\nOne hour of silence.\n• Mantra");
  });

  it("is not fetched for events further ahead or already with text", async () => {
    let calls = 0;
    const counting = (async (input: RequestInfo | URL) => { calls++; return fetcher(input); }) as typeof fetch;
    const out = await withDescriptions([{ ...listed, id: "SF6ab62c8403ff4831ef0b0ff5" }, { ...listed, id: "SF6ab62c8403ff4831ef0b0ff6", description: "Har tekst" }], NOW, counting, NOW);
    expect(calls).toBe(0);
    expect(out.map(e => e.description)).toEqual([null, "Har tekst"]);
  });
});
