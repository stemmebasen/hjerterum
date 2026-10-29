import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { D1Database } from "./db.js";
import { memberSagaChat } from "./member-saga.js";
import { memberSagaEvent } from "./member-saga-event.js";
import { publicSagaChat, VISITOR_DAILY } from "./web-saga.js";
import { deps, fakeServices, testDatabase } from "./saga/test-support.js";

vi.mock("./auth.js", () => ({ authenticateBearer: async (request: Request) => {
  const userId = request.headers.get("authorization");
  if (!userId) throw new Error("unauthorized");
  return { userId };
} }));

// Requested: "Sørg for at implementer Saga chat widget på alle tre sider - og med de permissions der giver mening for de tre. Saga skal kunne
// hjælpe med opsætning af event i medlem. og også kunne modtage billeder direkte i chatten. Hun skal være yderst hjælpsom og kunne bringe
// eventet online (hvis hun vurderer det passer til hjerterum). På den offentlige hjemmeside uden login må hun gerne tilbyde at hjælpe med
// både medlemskab og event opsætning men skal bede brugeren om at blive medlem og logge ind først. Kan hun huske samtalen før og efter login".
const SITE = "https://www.hjerterum.test";
let db: D1Database;
let systems: string[] = [];
let review = "approve";
const realFetch = globalThis.fetch;
const services = () => fakeServices({ ai: (system, user) => {
  systems.push(system);
  // "approve-unmet": she says approve, but one criterion is not met - that is never online.
  if (system.includes("Vurder det KUN ud fra kriterierne")) return JSON.stringify({ criteria: { formaal: true, vaerdier: true, aabent: true, redeligt: true, tekst: review === "approve" }, verdict: review === "board" ? "board" : "approve", note: review === "approve" ? "" : "Beskrivelsen er uklar." });
  if (system.includes("Du er Saga, Hjerterums assistent på medlemssiden")) return JSON.stringify({ reply: `Medlem: ${user.slice(0, 40)}`, draft: null, photo_ok: null });
  return JSON.stringify({ reply: `Hjemmeside: ${user.slice(0, 40)}`, action: user.includes("event") ? "login" : null });
} });
const env = () => ({ DB: db, AI_API_KEY: "k", AI_MODEL: "m", CLERK_JWT_ISSUER: "https://clerk.test" });
const site = (body: unknown, ip = "10.0.0.1") => publicSagaChat(new Request(`${SITE}/api/site/saga/chat`, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify(body) }), env(), deps(services().fetcher, Date.now()));
const siteGet = (id: string) => publicSagaChat(new Request(`${SITE}/api/site/saga/chat?conversation=${id}`), env(), deps(services().fetcher, Date.now()));
const member = (user: string, body?: unknown, query = "") => memberSagaChat(new Request(`https://medlem.hjerterum.test/api/members/saga/chat${query}`, {
  method: body ? "POST" : "GET", headers: { authorization: user, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }), env(), deps(services().fetcher, Date.now()));
const inDays = (n: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(Date.now() + n * 86_400_000);
const create = (user: string, draft: Record<string, unknown>, conversation?: string) => {
  const form = new FormData();
  form.set("draft", JSON.stringify(draft));
  if (conversation) form.set("conversation", conversation);
  return memberSagaEvent(new Request("https://medlem.hjerterum.test/api/members/saga/event", { method: "POST", headers: { authorization: user }, body: form }), env(), deps(services().fetcher, Date.now()));
};

beforeEach(async () => {
  db = testDatabase(); systems = []; review = "approve";
  // The membership calendar (MembershipWorks) is not reached in a test: no conflicts from there.
  globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
  await db.prepare(`INSERT INTO members (clerk_user_id, stripe_customer_id, tier, interval, status, full_name, email, created_at_ms, updated_at_ms)
    VALUES ('anna', 'c1', 'standard', 'month', 'active', 'Anna Andersen', 'anna@example.test', 1, 1)`).run();
});
afterEach(() => { globalThis.fetch = realFetch; });

describe("Saga on the website, without login", () => {
  it("answers from the public website only, and offers the way in when it is about an event", async () => {
    const first = await (await site({ text: "Kan jeg holde et event hos jer?" })).json() as { conversation: string; reply: string; action: string | null };
    expect(first.action).toBe("login");
    expect(first.conversation).toMatch(/^[A-Za-z0-9_-]{22,64}$/);
    const system = systems.at(-1)!;
    expect(system).toContain("ikke er logget ind");
    expect(system).toContain("bed personen om at blive medlem");
    expect(system).not.toContain("KALENDER");
    expect(system).not.toContain("MEDLEMMETS OPLYSNINGER");
    // The second message carries the first along.
    await site({ conversation: first.conversation, text: "Hvad koster salen?" });
    const kept = await (await siteGet(first.conversation)).json() as { messages: Array<{ role: string; text: string }> };
    expect(kept.messages.map(m => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(kept.messages[0]!.text).toBe("Kan jeg holde et event hos jer?");
  });

  it("takes only JSON, and stops a visitor at the day's limit", async () => {
    const form = await publicSagaChat(new Request(`${SITE}/api/site/saga/chat`, { method: "POST", body: "text=hej", headers: { "content-type": "application/x-www-form-urlencoded" } }), env(), deps(services().fetcher, Date.now()));
    expect(form.status).toBe(415);
    for (let i = 0; i < VISITOR_DAILY; i++) await site({ text: "Hej" }, "10.0.0.9");
    const asked = systems.length;
    const stopped = await (await site({ text: "Hej" }, "10.0.0.9")).json() as { reply: string };
    expect(stopped.reply).toContain("Jeg har talt meget i dag");
    expect(systems.length).toBe(asked);
    // Another visitor still gets an answer.
    expect((await (await site({ text: "Hej" }, "10.0.0.10")).json() as { reply: string }).reply).toContain("Hjemmeside");
  });
});

describe("the conversation before and after login", () => {
  it("becomes the member's when they log in with it, and no one else can read it after", async () => {
    const { conversation } = await (await site({ text: "Jeg vil gerne lave et event med yin yoga" })).json() as { conversation: string };
    // Logged in through Saga's button: the member area asks with the conversation's id.
    const mine = await (await member("anna", undefined, `?conversation=${conversation}`)).json() as { conversation: string; messages: Array<{ text: string }> };
    expect(mine.conversation).toBe(conversation);
    expect(mine.messages[0]!.text).toBe("Jeg vil gerne lave et event med yin yoga");
    // Saga continues it - and sees what was said before the login.
    await member("anna", { conversation, text: "Hvad med en onsdag?" });
    expect(systems.at(-1)).toContain("Samtalen kan være begyndt på den offentlige hjemmeside");
    const after = await (await member("anna", undefined, `?conversation=${conversation}`)).json() as { messages: unknown[] };
    expect(after.messages).toHaveLength(4);
    // The website and another member cannot open it any more.
    expect(await (await siteGet(conversation)).json()).toEqual({ conversation: null, messages: [] });
    expect((await (await member("bo", undefined, `?conversation=${conversation}`)).json() as { messages: unknown[] }).messages).toEqual([]);
    // On another device the member gets it back without the id.
    expect((await (await member("anna")).json() as { conversation: string }).conversation).toBe(conversation);
  });

  it("gives someone logged in without a membership the website's help to become a member", async () => {
    const answer = await (await member("bo", { text: "Kan du lave et event for mig?" })).json() as { reply: string; draft: unknown };
    expect(answer.reply).toContain("Hjemmeside");
    expect(answer.draft).toBeNull();
    expect(systems.at(-1)).toContain("logget ind på medlemssiden, men som ikke har et aktivt medlemskab");
    expect(systems.at(-1)).not.toContain("KALENDER");
  });
});

describe("Saga creates the member's event and brings it online", () => {
  const draft = () => ({ title: "Yin yoga om aftenen", description: "Rolig yin yoga for alle. Medbring tæppe.", date: inDays(30), start: "19:00", end: "21:00", booking_type: "standard", max_attendees: 12, member_price_kr: null, non_member_price_kr: null });
  const booking = async () => db.prepare("SELECT title, review_status, reviewed_by, clerk_user_id, teacher_email, ticket_price_minor, setup_minutes, cleanup_minutes FROM room_bookings").first<Record<string, unknown>>();

  it("creates it as the member's own and puts it online when it fits Hjerterum", async () => {
    const { conversation } = await (await member("anna", { text: "Hej" })).json() as { conversation: string };
    const response = await create("anna", draft(), conversation);
    expect(response.status).toBe(201);
    const body = await response.json() as { status: string; reply: string; feeKr: number };
    expect(body.status).toBe("approved");
    expect(body.reply).toContain("online på hjerterum.info");
    expect(body.reply).toContain(`Lejen bliver ${body.feeKr.toLocaleString("da-DK")} kr.`);
    expect(await booking()).toEqual({ title: "Yin yoga om aftenen", review_status: "approved", reviewed_by: "Saga", clerk_user_id: "anna", teacher_email: "anna@example.test", ticket_price_minor: 0, setup_minutes: 30, cleanup_minutes: 30 });
    // She remembers it in the conversation.
    const kept = await (await member("anna", undefined, `?conversation=${conversation}`)).json() as { messages: Array<{ text: string }> };
    expect(kept.messages.at(-1)!.text).toContain("online på hjerterum.info");
  });

  it("sends it to the board when she is not sure it fits - never rejects, never fails open", async () => {
    review = "board";
    const body = await (await create("anna", draft())).json() as { status: string; reply: string };
    expect(body.status).toBe("needs_board");
    expect(body.reply).toContain("bestyrelsen ser på det");
    expect((await booking())!.review_status).toBe("needs_board");
    await db.prepare("DELETE FROM room_bookings").run();
    review = "approve-unmet";
    expect((await (await create("anna", draft())).json() as { status: string }).status).toBe("needs_board");
  });

  it("says when the hall is taken, and creates nothing for someone without a membership", async () => {
    await create("anna", draft());
    const taken = await create("anna", { ...draft(), start: "20:00", end: "22:00" });
    expect(taken.status).toBe(409);
    expect((await taken.json() as { reply: string }).reply).toContain("optaget");
    expect((await create("bo", draft())).status).toBe(403);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM room_bookings").first<{ n: number }>())!.n).toBe(1);
  });
});
