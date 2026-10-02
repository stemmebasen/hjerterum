import { describe, expect, it } from "vitest";
import { createPartner, getPartner, listPartners, memberPartnerEvents, partnerEventDestination, partnerInput, partnerMetrics, publicPartnerEvents, runPartnerSync,
  setEventHidden, setPartnerStatus, syncPartner, type PartnerInput } from "./partners.js";
import { deps, sagaEnv, testDatabase } from "../saga/test-support.js";
import type { D1Database } from "../db.js";

// Partnerplanen, fase 1: "Partneren skal næsten ikke gøre noget efter det første ja."

const NOW = Date.parse("2026-10-01T10:00:00Z");
const FEED = "https://partner.example/calendar.ics";
const ics = (...events: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, "END:VCALENDAR"].join("\r\n");
const vevent = (uid: string, title: string, start: string, ...extra: string[]) =>
  ["BEGIN:VEVENT", `UID:${uid}`, `SUMMARY:${title}`, `DTSTART;TZID=Europe/Copenhagen:${start}`, ...extra, "END:VEVENT"].join("\r\n");

function calendar(initial: string) {
  const state = { body: initial, status: 200, calls: 0 };
  const fetcher: typeof fetch = async input => { state.calls++; expect(String(input)).toBe(FEED); return new Response(state.body, { status: state.status }); };
  return { state, fetcher };
}

const input = (extra: Partial<PartnerInput> = {}): PartnerInput => ({ name: "Yogahuset", website: "https://partner.example/", contactName: "Anna", contactEmail: "anna@partner.example",
  feedUrl: FEED, discount: { kind: "percent", value: 20 }, redemption: "Brug koden HJERTERUM20 ved tilmelding.", agreedOn: "2026-09-30", note: null, ...extra });
const titles = async (db: D1Database, now = NOW) => (await publicPartnerEvents(db, now)).map(e => e.title);

describe("partner events", () => {
  it("reads the board's form and refuses what cannot work", () => {
    const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
    const ok = partnerInput(form({ name: " Yogahuset ", website: "partner.example", feed_url: "webcal://partner.example/cal.ics", discount_kind: "percent",
      discount_value: "10 %", redemption: "Vis dit medlemskab", contact_email: "Anna@Partner.example" }));
    expect(ok).toMatchObject({ ok: true, value: { name: "Yogahuset", website: "https://partner.example/", feedUrl: "https://partner.example/cal.ics",
      discount: { kind: "percent", value: 10 }, contactEmail: "anna@partner.example" } });
    expect(partnerInput(form({ name: "X", discount_kind: "amount", discount_value: "50 kr.", redemption: "Kode" }))).toMatchObject({ ok: true, value: { discount: { kind: "amount", value: 5000 } } });
    expect(partnerInput(form({ name: "", discount_value: "10", redemption: "x" }))).toEqual({ ok: false, error: "Skriv partnerens navn." });
    expect(partnerInput(form({ name: "X", discount_value: "95", redemption: "x" }))).toMatchObject({ ok: false });
    expect(partnerInput(form({ name: "X", discount_value: "10", redemption: "" }))).toMatchObject({ ok: false });
    expect(partnerInput(form({ name: "X", discount_value: "10", redemption: "x", feed_url: "http://partner.example/cal.ics" }))).toMatchObject({ ok: false });
  });

  it("brings the partner's coming events into the calendar after the first yes, with normal and member price", async () => {
    const db = testDatabase();
    const id = await createPartner(db, input(), "Lisbeth", NOW);
    const { fetcher } = calendar(ics(
      vevent("a", "Yin yoga workshop", "20261015T190000", "DTEND;TZID=Europe/Copenhagen:20261015T210000", "DESCRIPTION:Pris: 250 kr.", "URL:https://partner.example/yin"),
      vevent("b", "Lydbad", "20261020T190000", "DESCRIPTION:Tag et tæppe med."),
      vevent("past", "Sidste måned", "20260901T190000"),
      vevent("far", "Om et år", "20271001T190000")));
    const result = await syncPartner(db, deps(fetcher, NOW), { id, feed_url: FEED });
    expect(result).toMatchObject({ ok: true, coming: 2, written: 2, message: "2 kommende events (iCal)" });

    const shown = await publicPartnerEvents(db, NOW);
    expect(shown).toHaveLength(2);
    expect(shown[0]).toMatchObject({ partnerName: "Yogahuset", title: "Yin yoga workshop", startsAt: "2026-10-15T17:00:00.000Z", price: "250 kr.", memberPrice: "200 kr.",
      discount: "20 % rabat for Hjerterum-medlemmer", link: `/api/events/partners/${shown[0]!.id}/go` });
    // Without a stated price only the discount is shown - never a guessed price.
    expect(shown[1]).toMatchObject({ title: "Lydbad", price: null, memberPrice: null, discount: "20 % rabat for Hjerterum-medlemmer" });
    // How to get the discount is for members only.
    expect(JSON.stringify(shown)).not.toContain("HJERTERUM20");
    expect((await memberPartnerEvents(db, NOW))[0]).toMatchObject({ redemption: "Brug koden HJERTERUM20 ved tilmelding.", link: `/api/events/partners/${shown[0]!.id}/go?fra=medlem` });
    expect(await getPartner(db, id)).toMatchObject({ last_sync_ok: 1, last_sync_message: "2 kommende events (iCal)" });
  });

  it("follows changes, cancellations and removals, and keeps the board's hidden events hidden", async () => {
    const db = testDatabase();
    const id = await createPartner(db, input(), "Lisbeth", NOW);
    const { state, fetcher } = calendar(ics(vevent("a", "Yin yoga", "20261015T190000"), vevent("b", "Lydbad", "20261020T190000"), vevent("c", "Dans", "20261025T190000")));
    await syncPartner(db, deps(fetcher, NOW), { id, feed_url: FEED });
    expect((await syncPartner(db, deps(fetcher, NOW), { id, feed_url: FEED })).written).toBe(0);

    const dans = (await publicPartnerEvents(db, NOW)).find(e => e.title === "Dans")!;
    expect(await setEventHidden(db, id, dans.id, true, "Lisbeth")).toBe(true);
    state.body = ics(vevent("a", "Yin yoga - nu 2 timer", "20261015T180000"), vevent("b", "Lydbad", "20261020T190000", "STATUS:CANCELLED"), vevent("c", "Dans", "20261025T190000"),
      vevent("d", "Kakao", "20261101T190000"));
    expect(await syncPartner(db, deps(fetcher, NOW), { id, feed_url: FEED })).toMatchObject({ ok: true, written: 3 });
    expect(await titles(db)).toEqual(["Yin yoga - nu 2 timer", "Kakao"]);

    // Taken off the partner's calendar.
    state.body = ics(vevent("d", "Kakao", "20261101T190000"));
    await syncPartner(db, deps(fetcher, NOW), { id, feed_url: FEED });
    expect(await titles(db)).toEqual(["Kakao"]);
    // Back again - shown again; the board's hidden event stays hidden.
    state.body = ics(vevent("a", "Yin yoga - nu 2 timer", "20261015T180000"), vevent("c", "Dans", "20261025T190000"), vevent("d", "Kakao", "20261101T190000"));
    await syncPartner(db, deps(fetcher, NOW), { id, feed_url: FEED });
    expect(await titles(db)).toEqual(["Yin yoga - nu 2 timer", "Kakao"]);
    // An event that is over drops out by itself.
    expect(await titles(db, Date.parse("2026-10-20T12:00:00Z"))).toEqual(["Kakao"]);
  });

  it("keeps what is shown when the calendar fails, and says why", async () => {
    const db = testDatabase();
    const id = await createPartner(db, input(), "Lisbeth", NOW);
    const { state, fetcher } = calendar(ics(vevent("a", "Yin yoga", "20261015T190000")));
    await syncPartner(db, deps(fetcher, NOW), { id, feed_url: FEED });
    state.status = 500;
    expect(await syncPartner(db, deps(fetcher, NOW), { id, feed_url: FEED })).toMatchObject({ ok: false, message: "Kalenderen svarede med fejl 500. De viste events er beholdt." });
    state.status = 200; state.body = "<html>Log ind</html>";
    expect((await syncPartner(db, deps(fetcher, NOW), { id, feed_url: FEED })).message).toContain("hverken en iCal- eller RSS-kalender");
    expect(await titles(db)).toEqual(["Yin yoga"]);
    expect(await getPartner(db, id)).toMatchObject({ last_sync_ok: 0 });
    state.body = "BEGIN:VCALENDAR\r\n" + "X".repeat(3_000_001);
    expect((await syncPartner(db, deps(fetcher, NOW), { id, feed_url: FEED })).message).toContain("for stor");
    expect(await titles(db)).toEqual(["Yin yoga"]);
    const offline: typeof fetch = async () => { throw new TypeError("network"); };
    expect((await syncPartner(db, deps(offline, NOW), { id, feed_url: FEED })).message).toBe("Kalenderen kunne ikke hentes. De viste events er beholdt.");
  });

  it("runs once an hour for active partners only, and a paused partner's events leave the calendar", async () => {
    const db = testDatabase();
    const id = await createPartner(db, input(), "Lisbeth", NOW);
    const paused = await createPartner(db, input({ name: "Pausehuset" }), "Lisbeth", NOW);
    await setPartnerStatus(db, paused, "paused", NOW);
    const { state, fetcher } = calendar(ics(vevent("a", "Yin yoga", "20261015T190000")));
    await runPartnerSync(sagaEnv(db), deps(fetcher, NOW));
    await runPartnerSync(sagaEnv(db), deps(fetcher, NOW + 10 * 60_000));
    expect(state.calls).toBe(1);
    await runPartnerSync(sagaEnv(db), deps(fetcher, NOW + 60 * 60_000));
    expect(state.calls).toBe(2);
    expect(await titles(db)).toEqual(["Yin yoga"]);
    await setPartnerStatus(db, id, "paused", NOW);
    expect(await titles(db)).toEqual([]);
    expect((await listPartners(db, NOW)).map(p => [p.name, p.status, p.coming])).toEqual([["Pausehuset", "paused", 0], ["Yogahuset", "paused", 1]]);
  });

  it("counts clicks to the partner and members' views per day, without recording who", async () => {
    const db = testDatabase();
    const id = await createPartner(db, input(), "Lisbeth", NOW);
    const { fetcher } = calendar(ics(vevent("a", "Yin yoga", "20261015T190000", "URL:https://partner.example/yin"), vevent("b", "Lydbad", "20261020T190000")));
    await syncPartner(db, deps(fetcher, NOW), { id, feed_url: FEED });
    const [yin, lyd] = await publicPartnerEvents(db, NOW);
    expect(await partnerEventDestination(db, yin!.id, false, NOW)).toBe("https://partner.example/yin");
    expect(await partnerEventDestination(db, yin!.id, true, NOW)).toBe("https://partner.example/yin");
    // No page of its own: the partner's site.
    expect(await partnerEventDestination(db, lyd!.id, false, NOW)).toBe("https://partner.example/");
    expect(await partnerEventDestination(db, 9999, false, NOW)).toBeNull();
    await memberPartnerEvents(db, NOW);
    await memberPartnerEvents(db, NOW);
    expect((await partnerMetrics(db, "2026-10-01")).get(id)).toEqual({ clicks: 2, memberClicks: 1, memberViews: 2 });
    expect((await partnerMetrics(db, "2026-10-02")).get(id)).toBeUndefined();
  });
});
