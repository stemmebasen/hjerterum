import { describe, expect, it } from "vitest";
import { parseMembershipWorksRss } from "./external-events.js";

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
});
