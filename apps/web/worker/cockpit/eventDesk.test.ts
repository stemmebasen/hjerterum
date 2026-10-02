import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { checkDraft, copenhagenMs, draftFrom, membershipWorksText, readVerdict, reviewPendingEvents, scheduledEventReview } from "./eventDesk.js";
import { createRoomBooking, normalizeCreateRoomBookingInput } from "../room-bookings.js";
import { listUpcomingPublicRoomBookings } from "../db.js";
import { claimJob } from "../saga/store.js";
import { deps, fakeServices, sagaEnv, testDatabase } from "../saga/test-support.js";
import type { D1Database } from "../db.js";

// Requested: "Vi skal også forberede Saga til at kunne hjælpe med at sætte et event op" - "I det nye system" -
// "Husk også, at Saga skal godkende events som medlemmer selv sætter op ud fra kriterier der allerede ligger i
// blueprint eller systemet" - "vi laver en hybrid i den første periode".

const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-10-01T10:00:00Z"); // a Thursday
const SATURDAY = Date.parse("2026-10-03T10:00:00Z");
const ALL_MET = '{"criteria":{"formaal":true,"vaerdier":true,"aabent":true,"redeligt":true,"tekst":true},"verdict":"approve","note":"Et yogaforløb, der passer til formålet."}';

const memberEvent = (db: D1Database, title: string, description: string, day = "2027-03-02") => createRoomBooking(db, "member-1", normalizeCreateRoomBookingInput({
  teacherName: "Maria", teacherEmail: "maria@example.com", title, description, startsAt: `${day}T09:00:00Z`, endsAt: `${day}T11:00:00Z` }));
const statusOf = async (db: D1Database, id: number) => db.prepare("SELECT review_status, review_note, reviewed_by FROM room_bookings WHERE id = ?").bind(id).first<{ review_status: string; review_note: string | null; reviewed_by: string | null }>();

describe("Saga's event desk", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("approves only on a clean, complete yes - never fails open", () => {
    expect(readVerdict(ALL_MET).approve).toBe(true);
    expect(readVerdict(ALL_MET.replace('"tekst":true', '"tekst":false'))).toMatchObject({ approve: false });
    expect(readVerdict('{"criteria":{"formaal":true},"verdict":"approve"}').approve).toBe(false);
    expect(readVerdict("Det ser fint ud!").approve).toBe(false);
    expect(readVerdict('{"verdict":"board","note":"Lover helbredelse."}')).toEqual({ approve: false, note: "Lover helbredelse." });
  });

  it("keeps a member's event private until Saga or the board approves it; Saga sends doubt to the board", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const yoga = await memberEvent(db, "Yin yoga", "Rolig yin yoga for alle. Underviser: Maria.");
    const cure = await memberEvent(db, "Helbred din kræft", "Garanteret helbredelse på én aften.", "2027-03-03");
    const broken = await memberEvent(db, "Lydbad", "Gongs og skåle.", "2027-03-04");
    expect(await listUpcomingPublicRoomBookings(db, NOW)).toEqual([]);
    const services = fakeServices({ ai: (_system, user) => user.includes("Yin yoga") ? ALL_MET
      : user.includes("Helbred") ? '{"criteria":{"formaal":true,"vaerdier":false,"aabent":true,"redeligt":false,"tekst":true},"verdict":"board","note":"Lover helbredelse af sygdom."}'
      : "Beklager, jeg kan ikke svare nu." });
    expect(await reviewPendingEvents(sagaEnv(db), deps(services.fetcher, NOW), db)).toEqual({ approved: 1, toBoard: 2 });
    expect(await statusOf(db, yoga.id)).toMatchObject({ review_status: "approved", reviewed_by: "Saga" });
    expect(await statusOf(db, cure.id)).toMatchObject({ review_status: "needs_board", review_note: "Lover helbredelse af sygdom." });
    // An unreadable answer is not a yes either.
    expect(await statusOf(db, broken.id)).toMatchObject({ review_status: "needs_board" });
    expect((await listUpcomingPublicRoomBookings(db, NOW)).map(e => e.title)).toEqual(["Yin yoga"]);
  });

  it("leaves the event pending when Saga cannot be reached, and does nothing at the weekend", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const event = await memberEvent(db, "Yin yoga", "Rolig yin yoga.");
    const down: typeof fetch = async () => new Response("down", { status: 503 });
    await reviewPendingEvents(sagaEnv(db), deps(down, NOW), db);
    expect(await statusOf(db, event.id)).toMatchObject({ review_status: "pending" });
    const services = fakeServices({ ai: () => ALL_MET });
    await scheduledEventReview(sagaEnv(db), deps(services.fetcher, SATURDAY), db, (key, slot) => claimJob(db, key, slot, SATURDAY));
    expect(await statusOf(db, event.id)).toMatchObject({ review_status: "pending" });
    await scheduledEventReview(sagaEnv(db), deps(services.fetcher, NOW), db, (key, slot) => claimJob(db, key, slot, NOW));
    expect(await statusOf(db, event.id)).toMatchObject({ review_status: "approved" });
  });

  it("prices a draft by the calculator, holds its rules, and writes the MembershipWorks text as the calendar does", () => {
    const draft = draftFrom({ title: "Lydhealing", category: "Lyd, Sang & Musik", host_name: "Lisbeth", host_email: "Lisbeth@Example.com", date: "2027-03-06", start: "14:00", end: "16:00",
      booking_type: "reduced", member_price_kr: 100, non_member_price_kr: 150, description: "En rolig rejse i lyd.", signup: "online" });
    expect(draft.missing).toEqual([]);
    expect(draft.host_email).toBe("lisbeth@example.com");
    const { quote, problems } = checkDraft(draft);
    expect(quote).toMatchObject({ band: "A", totalPriceKr: 300 });
    expect(problems).toEqual(["Med medlemspris 100 kr. skal ikke-medlemmer betale mindst 200 kr. (prisberegneren)."]);
    expect(checkDraft({ ...draft, date: "2027-03-02", start: "17:00", end: "19:00" }).problems[0]).toContain("kl. 18:30");
    const text = membershipWorksText({ ...draft, non_member_price_kr: 200 });
    expect(text).toContain("Titel: Lydhealing\nKategori: Lyd, Sang & Musik\nSted: Hjerterum, Guldsmedgade 26B, 8000 Aarhus");
    expect(text).toContain("Underviser: Lisbeth");
    expect(text).toContain("Medlemmer 100 kr. | Ikke-medlemmer 200 kr.");
    expect(draftFrom({ title: "X" }).missing).toContain("dato");
    expect(new Date(copenhagenMs("2027-03-06", "14:00")).toISOString()).toBe("2027-03-06T13:00:00.000Z");
    expect(new Date(copenhagenMs("2027-07-06", "14:00")).toISOString()).toBe("2027-07-06T12:00:00.000Z");
  });

  it("lets the board draft an event with Saga, create it in the new system, and decide members' events", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    let prompt = "";
    const services = fakeServices({ ai: (system, user) => { prompt = system + user; return system.includes("Et bestyrelsesmedlem beskriver et arrangement")
      ? '{"title":"Lydhealing med Lisbeth","category":"Lyd, Sang & Musik","host_name":"Lisbeth","host_email":"lisbeth@example.com","date":"2027-03-06","start":"14:00","end":"16:00","booking_type":"reduced","member_price_kr":100,"non_member_price_kr":200,"max_attendees":20,"signup":"online","payment":"","description":"En rolig rejse i lyd."}'
      : "Svar."; } });
    await db.prepare("INSERT INTO house_events (id, title, starts_at_ms, category, description, content_hash, updated_at_ms) VALUES ('mw-1', 'Yin yoga med Mari-Anne', ?, 'Yoga & Meditation', 'Hjerterum Mornings præsenterer: Yin Yoga', 'h', 1)").bind(NOW - 86_400_000).run();
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    const call = (path: string, init: RequestInit & { cookie?: string } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
      ...init, redirect: "manual", headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, NOW));
    const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
    const session = ((await call("/login", { method: "POST", body: form({ password: "hjerte-2026" }) })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const cookie = `${session}; hjerterum_cockpit_who=Lisbeth`;

    const page = await (await call("/arrangementer", { cookie })).text();
    expect(page).toContain("Nyt arrangement med Saga");
    expect(page).toContain("Ingen medlems-events venter på godkendelse.");

    const made = await call("/arrangementer/nyt", { method: "POST", cookie, body: form({ request: "Lisbeth holder lydhealing lørdag d. 6. marts 2027 kl. 14-16, lisbeth@example.com, medlemmer 100 kr., ikke-medlemmer 200 kr." }) });
    expect(made.status).toBe(303);
    const draftUrl = made.headers.get("location")!;
    expect(prompt).toContain("Opfind ALDRIG");
    expect(prompt).toContain("Hjerterum Mornings præsenterer");
    expect(prompt).toContain("https://prisberegner.replit.app/beregner");
    const draft = await (await call(draftUrl, { cookie })).text();
    expect(draft).toContain("Lydhealing med Lisbeth");
    expect(draft).toContain("300 kr.");
    expect(draft).toContain("Til MembershipWorks");

    const created = await call(draftUrl, { method: "POST", cookie, body: form({ action: "create" }) });
    expect(decodeURIComponent(created.headers.get("location")!)).toContain("oprettet i Hjerterums nye system");
    const booking = await db.prepare("SELECT clerk_user_id, review_status, fee_minor, booking_type, description FROM room_bookings").first<Record<string, unknown>>();
    expect(booking).toMatchObject({ clerk_user_id: "cockpit:Lisbeth", review_status: "approved", fee_minor: 30000, booking_type: "reduced" });
    expect(String(booking!.description)).toContain("Medlemmer 100 kr. | Ikke-medlemmer 200 kr.");

    // A member's own event waits for the board here, and the board decides.
    const own = await memberEvent(db, "Tarot for begyndere", "Lær at lægge kort.", "2027-04-01");
    expect(await (await call("/arrangementer", { cookie })).text()).toContain("Tarot for begyndere");
    expect(await (await call("/", { cookie })).text()).toContain("venter på godkendelse");
    await call("/arrangementer/godkend", { method: "POST", cookie, body: form({ id: String(own.id), decision: "reject", note: "Passer ikke til formålet." }) });
    expect(await statusOf(db, own.id)).toEqual({ review_status: "rejected", review_note: "Passer ikke til formålet.", reviewed_by: "Lisbeth" });

    // A fixed teacher's event needs no approval.
    await call("/arrangementer/faste", { method: "POST", cookie, body: form({ name: "Maria", email: "Maria@Example.com" }) });
    expect(await db.prepare("SELECT email, name, added_by FROM fixed_teachers").first()).toEqual({ email: "maria@example.com", name: "Maria", added_by: "Lisbeth" });
  });
});
