import { describe, expect, it } from "vitest";
import { parseFeed, parseIcs, webUrl, zonedMs } from "./feed.js";

// Partnerplanen, fase 1: "Saga skal på sigt kunne hente eller modtage nye partner-events" - a partner's
// own calendar address is enough.

const ics = (...events: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Partner//DA", ...events, "END:VCALENDAR"].join("\r\n");
const vevent = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");

describe("a partner's iCal calendar", () => {
  it("reads Copenhagen time in summer and winter, UTC and floating times", () => {
    expect(zonedMs(2026, 10, 15, 19, 0, 0, "Europe/Copenhagen")).toBe(Date.parse("2026-10-15T17:00:00Z"));
    expect(zonedMs(2026, 11, 15, 19, 0, 0, "Europe/Copenhagen")).toBe(Date.parse("2026-11-15T18:00:00Z"));
    const { events } = parseIcs(ics(
      vevent("UID:a@partner", "SUMMARY:Lydbad", "DTSTART;TZID=Europe/Copenhagen:20261015T190000", "DTEND;TZID=Europe/Copenhagen:20261015T210000"),
      vevent("UID:b@partner", "SUMMARY:Vintermeditation", "DTSTART:20261115T180000Z", "DURATION:PT1H30M"),
      vevent("UID:c@partner", "SUMMARY:Flydende tid", "DTSTART:20261201T100000"),
      vevent("UID:d@partner", "SUMMARY:Windows-zone", "DTSTART;TZID=Romance Standard Time:20261201T100000"),
      vevent("UID:e@partner", "SUMMARY:Mozilla-zone", "DTSTART;TZID=/mozilla.org/20070129_1/Europe/Copenhagen:20261201T100000")));
    expect(events.map(e => [e.uid, new Date(e.startsAtMs).toISOString(), e.endsAtMs && new Date(e.endsAtMs).toISOString()])).toEqual([
      ["a@partner", "2026-10-15T17:00:00.000Z", "2026-10-15T19:00:00.000Z"],
      ["b@partner", "2026-11-15T18:00:00.000Z", "2026-11-15T19:30:00.000Z"],
      ["c@partner", "2026-12-01T09:00:00.000Z", null],
      ["d@partner", "2026-12-01T09:00:00.000Z", null],
      ["e@partner", "2026-12-01T09:00:00.000Z", null]]);
  });

  it("unfolds long lines, unescapes text, strips HTML and keeps only web links", () => {
    const { events } = parseIcs(ics(vevent("UID:x", "SUMMARY:Kakao\\, sang & samvær", "DTSTART;VALUE=DATE:20261024",
      "DESCRIPTION:Første linje.\\nPris: 250 kr.\\n<b>Ta", " g</b> en pude med.", "LOCATION:Fællessalen\\; Aarhus", "URL:https://partner.example/kakao",
      "CATEGORIES:Ceremoni,Musik", "IMAGE;VALUE=URI:https://partner.example/kakao.jpg", "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Påmindelse", "END:VALARM")));
    expect(events[0]).toMatchObject({ uid: "x", title: "Kakao, sang & samvær", allDay: true, startsAtMs: Date.parse("2026-10-23T22:00:00Z"),
      description: "Første linje.\nPris: 250 kr.\nTag en pude med.", location: "Fællessalen; Aarhus", link: "https://partner.example/kakao",
      category: "Ceremoni", imageUrl: "https://partner.example/kakao.jpg", cancelled: false });
    const [unsafe] = parseIcs(ics(vevent("UID:y", "SUMMARY:Farlig", "DTSTART:20261024T100000Z", "URL:javascript:alert(1)", "IMAGE:http://partner.example/x.jpg"))).events;
    expect(unsafe).toMatchObject({ link: null, imageUrl: null });
    expect(webUrl("https://ok.example/a")).toBe("https://ok.example/a");
    expect(webUrl("data:text/html,x")).toBeNull();
  });

  it("leaves repeating series and private events out, and knows a cancelled event", () => {
    const parsed = parseIcs(ics(
      vevent("UID:weekly", "SUMMARY:Ugentlig yoga", "DTSTART:20261005T170000Z", "RRULE:FREQ=WEEKLY;BYDAY=MO"),
      vevent("UID:weekly", "SUMMARY:Ugentlig yoga (flyttet)", "DTSTART:20261013T170000Z", "RECURRENCE-ID:20261012T170000Z"),
      vevent("UID:private", "SUMMARY:Bestyrelsesmøde", "DTSTART:20261005T170000Z", "CLASS:PRIVATE"),
      vevent("UID:off", "SUMMARY:Aflyst workshop", "DTSTART:20261006T170000Z", "STATUS:CANCELLED"),
      vevent("SUMMARY:Uden uid", "DTSTART:20261007T170000Z"),
      vevent("UID:notime", "SUMMARY:Uden tid")));
    expect(parsed.recurring).toBe(2);
    expect(parsed.events.map(e => [e.title, e.cancelled])).toEqual([["Aflyst workshop", true], ["Uden uid", false]]);
    expect(parsed.events[1]!.uid).toMatch(/^ics-/);
  });

  it("recognises iCal and RSS by their content, and nothing else", () => {
    expect(parseFeed(ics(vevent("UID:a", "SUMMARY:A", "DTSTART:20261024T100000Z")))?.kind).toBe("ics");
    const rss = parseFeed(`<?xml version="1.0"?><rss><channel><item><guid>r1</guid><title>Cirkeldans</title><link>https://partner.example/r1</link>
      <ev:startdate>2026-10-20T19:00:00+02:00</ev:startdate><description>Pris: 120 kr.</description></item></channel></rss>`);
    expect(rss).toMatchObject({ kind: "rss", recurring: 0, events: [{ uid: "r1", title: "Cirkeldans", startsAtMs: Date.parse("2026-10-20T17:00:00Z"), link: "https://partner.example/r1" }] });
    expect(parseFeed("<!doctype html><html><body>Login</body></html>")).toBeNull();
  });
});
