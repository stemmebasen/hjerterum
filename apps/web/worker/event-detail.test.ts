import { describe, expect, it } from "vitest";
import { eventDetail, eventIdOf, htmlParagraphs } from "./event-detail.js";
import { getExternalEvents } from "./external-events.js";

// Requested: "Prøv at fetche event detaljer automatisk så vi ikke sender folk til en anden hjemmeside."
const EID = "6ab62c8403ff4831ef0b0ff4";
const FEED = `<rss><channel><item><title>Dhyana Yoga</title><guid isPermaLink="false">SF${EID}</guid>
<link>https://holistisk.org/events/#!event/2026/10/13/dhyana-yoga</link><media:content medium="image" url="https://img/x.jpg" />
<category>Yoga &#x26; Meditation</category><ev:startdate>2026-10-13T10:30:00+02:00</ev:startdate><ev:enddate>2026-10-13T11:30:00+02:00</ev:enddate>
<ev:organizer>Kasper Frausing</ev:organizer><content:encoded><![CDATA[<p>Kort</p>]]></content:encoded></item></channel></rss>`;
const EVENT = { ttl: "Dhyana Yoga", sdp: 1791880200, edp: 1791883800, adr: { ad1: "Guldsmedgade 26", zip: "8000", cit: "Aarhus" }, cap: 14,
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
      address: "Guldsmedgade 26, 8000 Aarhus", capacity: 14, signUpUrl: "https://holistisk.org/events/#!event/2026/10/13/dhyana-yoga" });
    expect(detail.tickets).toEqual(["Medlem - 80kr", "Ikke-medlem - se nærmere info"]);
    expect(detail.paragraphs).toContain("One hour of silence.");
    expect(await eventDetail("../etc", fetcher, 1)).toBeNull();
    expect(eventIdOf({ id: `SF${EID}` })).toBe(EID);
    expect(eventIdOf({ id: "hjerteland-1" })).toBeNull();
  });
});
