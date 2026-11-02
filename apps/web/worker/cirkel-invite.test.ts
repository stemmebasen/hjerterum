import { describe, expect, it, vi } from "vitest";
import { handleCirklerIntegrationRequest, sharedEvent } from "./cirkler-integration.js";

// The signed-in member: member number 7, with benefits.
vi.mock("./membership-access.js", () => ({ resolveActiveMembership: async (_db: unknown, userId: string) => userId === "user_1"
  ? { source: "hjerterum", fullName: "Lise", email: "lise@x.dk", member: { id: 7, tier: "standard", status: "active" } } : null }));
import { testDatabase } from "./saga/test-support.js";

// Requested (2 November 2026): "Inviter din CIRKEL med" under every event in the hall; the message lands in the circle's chat in CIRKLER.
describe("inviting one's circle to an event", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");
  async function own(db: ReturnType<typeof testDatabase>, startsAt: number, review = "approved") {
    const r = await db.prepare(`INSERT INTO room_bookings (clerk_user_id, teacher_name, teacher_email, title, description, starts_at_ms, ends_at_ms, review_status, status, created_at_ms, updated_at_ms)
      VALUES ('t', 'Anna', 'a@x.dk', 'Lydbad med gongs', 'En rolig aften med gongs og krystalskåle.', ?, ?, ?, 'scheduled', 1, 1)`).bind(startsAt, startsAt + 7_200_000, review).run();
    return Number(r.meta!.last_row_id);
  }

  it("reads the event from Hjerterum's own calendar - coming and approved only", async () => {
    const db = testDatabase();
    const id = await own(db, now + 86_400_000);
    expect(await sharedEvent(db, `h${id}`, fetch, now)).toEqual({ title: "Lydbad med gongs", url: `https://www.hjerterum.info/events/h${id}`, image_url: null,
      summary: "En rolig aften med gongs og krystalskåle.", starts_at: new Date(now + 86_400_000).toISOString() });
    expect(await sharedEvent(db, `h${await own(db, now - 86_400_000)}`, fetch, now)).toBeNull();
    expect(await sharedEvent(db, `h${await own(db, now + 86_400_000, "pending")}`, fetch, now)).toBeNull();
    expect(await sharedEvent(db, "javascript:alert(1)", fetch, now)).toBeNull();
  });

  it("sends the member's words and the event to CIRKLER in their name, and says when they are not in a circle", async () => {
    const db = testDatabase();
    const id = await own(db, Date.now() + 86_400_000);
    const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
    let answer = { status: 201, body: { circle: "Solsikken" } as Record<string, unknown> };
    const cirkler: typeof fetch = async (input, init) => { sent.push({ url: String(input), body: JSON.parse(String(init?.body)) }); return new Response(JSON.stringify(answer.body), { status: answer.status }); };
    const env = { DB: db, CLERK_SECRET_KEY: "sk", CIRKLER_SERVICE_KEY: "shared", CIRKLER_BASE_URL: "https://cirkler.test" };
    const deps = { now: () => Date.now(), authenticate: async () => ({ userId: "user_1" }), fetcher: cirkler };
    const post = (body: unknown) => handleCirklerIntegrationRequest(new Request("https://medlem.hjerterum.info/api/integrations/cirkler/invite", { method: "POST", body: JSON.stringify(body) }), env as never, deps as never);
    const ok = await post({ event: `h${id}`, message: "Skal vi tage med?" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, circle: "Solsikken" });
    expect(sent[0]!.url).toBe("https://cirkler.test/api/hjerterum/circle-invite");
    expect(sent[0]!.body).toMatchObject({ ref: "HR-7", message: "Skal vi tage med?", event: { title: "Lydbad med gongs", url: `https://www.hjerterum.info/events/h${id}` } });
    answer = { status: 409, body: { error: "no_circle" } };
    const none = await post({ event: `h${id}`, message: "" });
    expect(none.status).toBe(409);
    expect(await none.json()).toEqual({ error: "no_circle" });
    expect((await post({ event: "h999999", message: "" })).status).toBe(404);
    expect((await post({ event: `h${id}`, message: "x".repeat(1201) })).status).toBe(400);
  });
});
