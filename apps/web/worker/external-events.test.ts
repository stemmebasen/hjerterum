import { describe, expect, it } from "vitest";
import { endFromText, getExternalEvents, mergeExternalEvents, parseMembershipWorksList, parseMembershipWorksRss, withTexts } from "./external-events.js";

describe("MembershipWorks RSS parser", () => {
  it("parses the documented event tags", () => {
    const xml = `<?xml version="1.0"?>
      <rss xmlns:ev="http://purl.org/rss/1.0/modules/event/" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
        <channel>
          <item>
            <guid>evt-1</guid>
            <title><![CDATA[Sound Meditation &amp; Tea]]></title>
            <link>https://example.org/event/1</link>
            <category>Practice</category>
            <ev:startdate>2026-09-10T17:30:00+02:00</ev:startdate>
            <ev:enddate>2026-09-10T19:00:00+02:00</ev:enddate>
            <ev:location><![CDATA[Hjerterum, Aarhus]]></ev:location>
            <media:content medium="image" url="https://example.org/event.jpg" />
            <content:encoded><![CDATA[<p>En rolig aften med lyd.</p>]]></content:encoded>
          </item>
        </channel>
      </rss>`;

    const [event] = parseMembershipWorksRss(xml);
    expect(event).toMatchObject({
      id: "evt-1",
      source: "membershipworks",
      title: "Sound Meditation & Tea",
      startsAt: "2026-09-10T15:30:00.000Z",
      endsAt: "2026-09-10T17:00:00.000Z",
      location: "Hjerterum, Aarhus",
      imageUrl: "https://example.org/event.jpg",
      link: "https://example.org/event/1",
      description: "En rolig aften med lyd.",
      category: "Practice"
    });
  });

  it("drops items without a valid start date", () => {
    const xml = `<rss><channel><item><title>No time</title></item></channel></rss>`;
    expect(parseMembershipWorksRss(xml)).toEqual([]);
  });

  it("decodes HTML entities from MembershipWorks descriptions", () => {
    const xml = `<rss><channel><item>
      <title>Hjerterum</title>
      <ev:startdate xmlns:ev="http://purl.org/rss/1.0/modules/event/">2026-09-10T17:30:00+02:00</ev:startdate>
      <description>En h&amp;aring;ndfuld &amp;aelig;bler, &amp;oslash;velser og plads&nbsp;til ro.</description>
    </item></channel></rss>`;
    const event = parseMembershipWorksRss(xml)[0];
    expect(event?.description).toBe("En håndfuld æbler, øvelser og plads til ro.");
  });
});

// Asked: "All of these appear in Membership works" - the categories left out of the RSS feed come from the widget's list.
describe("MembershipWorks event list", () => {
  const LIST = {
    evt: [
      { grp: 7, ttl: "F&#230;llesspisning med &#197;BEN SCENE &#128214;", sdp: 1792427400, edp: 1792438200, url: "2026/10/19/faellesspisning", lgo: { l: "https://img/f.jpg" }, eid: "6a0000000000000000000007" },
      { grp: 0, ttl: "RELAX YOUR EYES<br>A feldenkrais workshop", sdp: 1792400000, eid: "6a0000000000000000000001" },
      { grp: 0, ttl: "Uden id", sdp: 1792400000 }
    ],
    _st: { evg: [{ ttl: "Events &amp; Workshops" }, {}, {}, {}, {}, {}, {}, { ttl: "Hjerterum events" }] }
  };

  it("reads title, time, category, picture and link", () => {
    const [meal, workshop, ...rest] = parseMembershipWorksList(LIST);
    expect(rest).toEqual([]);
    expect(meal).toMatchObject({
      id: "SF6a0000000000000000000007", title: "Fællesspisning med ÅBEN SCENE 📖", startsAt: "2026-10-19T16:30:00.000Z", endsAt: "2026-10-19T19:30:00.000Z",
      category: "Hjerterum events", imageUrl: "https://img/f.jpg", link: "https://holistisk.org/events/#!event/2026/10/19/faellesspisning", description: null
    });
    expect(workshop).toMatchObject({ title: "RELAX YOUR EYES – A feldenkrais workshop", category: "Events & Workshops", endsAt: null, link: null });
  });

  it("keeps the feed's richer copy and adds only what the feed lacks", () => {
    const feed = parseMembershipWorksList({ evt: [{ ttl: "Fra feedet", sdp: 1792500000, eid: "6a0000000000000000000001" }] }).map(e => ({ ...e, description: "Tekst" }));
    const merged = mergeExternalEvents(feed, parseMembershipWorksList(LIST));
    expect(merged.map(e => e.title)).toEqual(["Fællesspisning med ÅBEN SCENE 📖", "Fra feedet"]);
    expect(merged[1]!.description).toBe("Tekst");
  });

  it("shows the feed's events when the list cannot be read", async () => {
    const rss = `<rss><channel><item><guid>SF6a0000000000000000000009</guid><title>Qi Gong</title><ev:startdate>2026-10-23T10:30:00+02:00</ev:startdate></item></channel></rss>`;
    const fetcher = (async (input: RequestInfo | URL) => String(input).includes("_op=rss") ? new Response(rss) : new Response("nej", { status: 500 })) as typeof fetch;
    expect((await getExternalEvents(true, fetcher)).map(e => e.title)).toEqual(["Qi Gong"]);
  });
});

// Asked: "Hvorfor er der den forskel på tekst? Alle events har jo en beskrivelse."
describe("the text of events only the list has", () => {
  const listed = parseMembershipWorksList({ evt: [{ ttl: "Satsãnga", sdp: 1792427400, eid: "6aaa8347f1a29b96a0031976" }, { ttl: "Har tekst", sdp: 1792427400, eid: "6aaa8347f1a29b96a0031977" }] })
    .map((e, i) => i === 1 ? { ...e, description: "Fra feedet" } : e);

  it("is read from the event's details once, and kept", async () => {
    let calls = 0;
    const fetcher = (async (input: RequestInfo | URL) => {
      calls++;
      expect(String(input)).toContain("eid=6aaa8347f1a29b96a0031976");
      return new Response(JSON.stringify({ dtl: "<p>Sats&atilde;nga: mantra &amp; dans</p><p>Med Marin</p>" }));
    }) as typeof fetch;
    const [first, second] = await withTexts(listed, fetcher, 1);
    expect(first!.description).toBe("Satsãnga: mantra & dans\nMed Marin");
    expect(second!.description).toBe("Fra feedet");
    await withTexts(listed, fetcher, 2);
    expect(calls).toBe(1);
  });
});

// Reported (Gitta): "Fri morgendans den 30. oktober fra kl. 9 til 22" - MembershipWorks' end is 22.00, its text says "kl 10.00".
describe("an end time that contradicts the event's own text", () => {
  const start = Date.parse("2026-10-30T08:00:00Z"); // 09.00 in Copenhagen
  it("follows the clock in the text", () => {
    expect(new Date(endFromText(start, Date.parse("2026-10-30T21:00:00Z"), "Fredag. d. 30. Oktober kl 10.00")).toISOString()).toBe("2026-10-30T09:00:00.000Z");
    expect(new Date(endFromText(Date.parse("2026-10-24T17:30:00Z"), Date.parse("2026-10-24T21:00:00Z"), "Sat Oct 24 2026, 9:15pm CET")).toISOString()).toBe("2026-10-24T19:15:00.000Z");
  });
  it("keeps the end when the text agrees, has no clock, or would end before the start", () => {
    expect(endFromText(start, Date.parse("2026-10-30T09:00:00Z"), "kl 10.00")).toBe(Date.parse("2026-10-30T09:00:00Z"));
    expect(endFromText(start, Date.parse("2026-10-30T21:00:00Z"), "Fredag")).toBe(Date.parse("2026-10-30T21:00:00Z"));
    expect(endFromText(start, Date.parse("2026-10-30T21:00:00Z"), "kl 08.00")).toBe(Date.parse("2026-10-30T21:00:00Z"));
  });
});
