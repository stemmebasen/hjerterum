import { describe, expect, it, vi } from "vitest";
import { endFromText, getExternalEvents, isCancelledEvent, mergeExternalEvents, parseMembershipWorksList, parseMembershipWorksRss, useEventStore } from "./external-events.js";
import { testDatabase } from "./saga/test-support.js";

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
      category: "Hjerterum events", imageUrl: "https://img/f.jpg", link: null, description: null
    });
    expect(workshop).toMatchObject({ title: "RELAX YOUR EYES – A feldenkrais workshop", category: "Events & Workshops", endsAt: null, link: null });
  });

  it("keeps the feed's richer copy and adds only what the feed lacks", () => {
    const feed = parseMembershipWorksList({ evt: [{ ttl: "Fra feedet", sdp: 1792500000, eid: "6a0000000000000000000001" }] }).map(e => ({ ...e, description: "Tekst" }));
    const merged = mergeExternalEvents(feed, parseMembershipWorksList(LIST));
    expect(merged.map(e => e.title)).toEqual(["Fællesspisning med ÅBEN SCENE 📖", "Fra feedet"]);
    expect(merged[1]!.description).toBe("Tekst");
  });

});

// The chair (27 Nov 2026): "alle forbindelser til holistisk og membership works skal klippes" - the kept calendar is read from D1, never fetched.
describe("the kept calendar", () => {
  it("is read from house_events: coming events only, not cancelled or removed, and without links to holistisk.org - never from MembershipWorks", async () => {
    const db = testDatabase();
    const now = Date.now();
    const add = (id: string, title: string, at: number, removed: number | null = null) => db.prepare(`INSERT INTO house_events (id, title, starts_at_ms, ends_at_ms, host, link, content_hash, removed_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, 'Kasper', 'https://holistisk.org/events/#!event/x', 'x', ?, 0)`).bind(id, title, at, at + 3_600_000, removed).run();
    await add("SF6a0000000000000000000009", "Qi Gong", now + 86_400_000);
    await add("SF6a0000000000000000000010", "Holdt for længe siden", now - 10 * 86_400_000);
    await add("SF6a0000000000000000000011", "Yoga - Aflyst -", now + 86_400_000);
    await add("SF6a0000000000000000000012", "Fjernet", now + 86_400_000, now);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    useEventStore(db);
    const events = await getExternalEvents(true);
    expect(events.map(e => e.title)).toEqual(["Qi Gong"]);
    expect(events[0]).toMatchObject({ host: "Kasper", link: null });
    expect(fetcher).not.toHaveBeenCalled();
    useEventStore(null);
    expect(await getExternalEvents(true)).toEqual([]);
    vi.unstubAllGlobals();
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

// Requested (5 Nov 2026): "Når et event er aflyst bør det fjernes fra listen - ligesom Mediterende yoga".
describe("a cancelled event", () => {
  it("is known by 'Aflyst' or 'Cancelled' in the title or at the start of the text - not by a word further down", () => {
    expect(isCancelledEvent({ title: "Mediterende Yoga | Onsdage 16-17.20 - Aflyst -", description: "Underviser: …" })).toBe(true);
    expect(isCancelledEvent({ title: "Mediterende Yoga | Onsdage 16-17.20", description: "- AFLYST - CANCELLED -  Underviser: Meditating Yoga" })).toBe(true);
    expect(isCancelledEvent({ title: "Kirtan (CANCELLED)" })).toBe(true);
    expect(isCancelledEvent({ title: "Mediterende Yoga | Onsdage 16-17.20", description: "Underviser: Meditating Yoga. Holdet aflyses ved under 4 tilmeldte, og et aflyst hold refunderes." })).toBe(false);
    expect(isCancelledEvent({ title: "Aflystning af stress – workshop" })).toBe(false);
  });
});
