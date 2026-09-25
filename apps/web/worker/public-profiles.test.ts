import { beforeEach, describe, expect, it, vi } from "vitest";
import type { D1Database } from "./db.js";
import { testDatabase } from "./saga/test-support.js";
import { ownPublicProfile, publicProfiles } from "./public-profiles.js";

vi.mock("./auth.js", () => ({ authenticateBearer: async (request: Request) => {
  const userId = request.headers.get("authorization");
  if (!userId) throw new Error("unauthorized");
  return { userId };
} }));
vi.mock("./admin-auth.js", () => ({ clerkPrimaryEmail: async () => "external@example.test" }));

const profile = { name: "Test underviser", title: "Yogalærer", bio: "En offentlig præsentation.", topics: "Yoga", teaching: true, treatment: false };
let db: D1Database;
const env = () => ({ DB: db, CLERK_SECRET_KEY: "test" });
const own = (body?: unknown, user = "owner") => ownPublicProfile(new Request("https://example.test/api/members/me/public-profile", {
  method: body ? "PUT" : "GET", headers: user ? { authorization: user } : {}, ...(body ? { body: JSON.stringify(body) } : {})
}), env());
const list = () => publicProfiles(new Request("https://example.test/api/public-profiles"), env());
const publish = (revision = 0) => own({ action: "publish", revision, profile, consent: true });
async function native(user = "owner") {
  await db.prepare(`INSERT INTO members (clerk_user_id, stripe_customer_id, tier, interval, status, full_name, email, created_at_ms, updated_at_ms)
    VALUES (?, ?, 'standard', 'month', 'active', 'Private name', 'private@example.test', 1, 1)`).bind(user, "customer-" + user).run();
}
beforeEach(async () => { db = testDatabase(); await native(); });

describe("public profile lifecycle with actual migrations", () => {
  it("publishes only explicitly supplied contact info and keeps contact edits private until publication", async () => {
    const contact = { ...profile, publicEmail: "hello@example.test", publicPhone: "+45 12 34 56 78", websiteUrl: "https://example.test/book", linkLabel: "Book en tid" };
    expect((await own({ action: "save", revision: 0, profile: contact })).status).toBe(200);
    expect(await (await list()).json()).toEqual([]);
    expect(await (await own()).json()).toMatchObject({ draft: contact });
    expect((await own({ action: "publish", revision: 1, profile: contact, consent: true })).status).toBe(200);
    expect(await (await list()).json()).toEqual([{ id: expect.any(String), ...contact }]);
    expect((await own({ action: "save", revision: 2, profile: { ...contact, publicEmail: "new@example.test" } })).status).toBe(200);
    expect(await (await list()).json()).toEqual([{ id: expect.any(String), ...contact }]);
    expect((await own({ action: "publish", revision: 3, profile: { ...profile, publicEmail: "", publicPhone: "", websiteUrl: "" }, consent: true })).status).toBe(200);
    expect(await (await list()).json()).toEqual([{ id: expect.any(String), ...profile }]);
  });
  it.each([
    { websiteUrl: "javascript:alert(1)" }, { websiteUrl: "data:text/html,test" },
    { websiteUrl: "https://user:password@example.test" }, { websiteUrl: "/relative" },
    { publicEmail: "a@example.test?bcc=private@example.test" }, { publicEmail: "not-an-email" },
    { publicPhone: "1234;phone-context=example.test" }, { publicPhone: 12345678 },
    { websiteUrl: "https://example.test", linkLabel: "Unapproved label" }
  ])("rejects invalid contact values: %j", async contact => {
    expect((await own({ action: "publish", revision: 0, profile: { ...profile, ...contact }, consent: true })).status).toBe(400);
    expect(await (await list()).json()).toEqual([]);
  });

  it("keeps drafts private, publishes only a consented snapshot, then hides it without losing the draft", async () => {
    expect((await own({ action: "save", revision: 0, profile })).status).toBe(200);
    expect(await (await list()).json()).toEqual([]);
    expect((await publish(1)).status).toBe(200);
    const published = await (await list()).json() as Array<Record<string, unknown>>;
    expect(published).toHaveLength(1);
    expect(published[0]).toEqual({ id: expect.any(String), ...profile });
    expect((await own({ action: "save", revision: 2, profile: { ...profile, bio: "Private draft" } })).status).toBe(200);
    expect(await (await list()).json()).toEqual(published);
    expect((await own({ action: "hide", revision: 3 })).status).toBe(200);
    expect(await (await list()).json()).toEqual([]);
    expect(await (await own()).json()).toMatchObject({ draft: { bio: "Private draft" }, published: null, revision: 4 });
  });
  it("requires authentication, consent and complete validated content", async () => {
    expect((await own(undefined, "")).status).toBe(401);
    expect((await own({ action: "publish", revision: 0, profile })).status).toBe(400);
    for (const invalid of [{ ...profile, name: "" }, { ...profile, teaching: false }, { ...profile, title: "x".repeat(121) }, { ...profile, email: "private" }]) {
      expect((await own({ action: "publish", revision: 0, profile: invalid, consent: true })).status).toBe(400);
    }
    expect(await (await list()).json()).toEqual([]);
  });
  it("uses only the authenticated owner and rejects stale revisions", async () => {
    await publish();
    await native("another");
    expect(await (await own(undefined, "another")).json()).toMatchObject({ draft: null, revision: 0 });
    expect((await own({ action: "hide", revision: 1 }, "another")).status).toBe(409);
    expect((await own({ action: "hide", revision: 1, clerk_user_id: "owner" }, "another")).status).toBe(400);
    expect((await own({ action: "save", revision: 0, profile })).status).toBe(409);
    expect((await own({ action: "hide", revision: 0 })).status).toBe(409);
    expect((await own({ action: "save", revision: 99, profile }, "another")).status).toBe(409);
    expect(await (await own()).json()).toMatchObject({ revision: 1, published: profile });
  });
  it.each(["status = 'canceled'", "access_blocked = 1", "tier = 'support'"])("removes ineligible profiles at read time (%s) but lets the owner hide them", async update => {
    await publish();
    await db.prepare("UPDATE members SET " + update + " WHERE clerk_user_id = 'owner'").run();
    expect(await (await list()).json()).toEqual([]);
    expect((await publish(1)).status).toBe(403);
    expect(await (await own()).json()).toMatchObject({ canPublish: false });
    expect((await own({ action: "hide", revision: 1 })).status).toBe(200);
  });
  it("rechecks imported membership and gives native access decisions precedence", async () => {
    await db.prepare(`INSERT INTO membership_import_batches (id, source, filename, imported_by_email, started_at_ms) VALUES (1, 'membershipworks', 'test.csv', 'admin@example.test', 1)`).run();
    await db.prepare(`INSERT INTO external_memberships (id, source, normalized_email, full_name, membership_level, status, raw_json, first_seen_at_ms, last_seen_at_ms, last_changed_at_ms, last_import_batch_id)
      VALUES (1, 'membershipworks', 'external@example.test', 'External private', 'standard', 'active', '{}', 1, 1, 1, 1)`).run();
    expect((await own({ action: "publish", revision: 0, profile, consent: true }, "external")).status).toBe(200);
    expect(await (await list()).json()).toHaveLength(1);
    await db.prepare("UPDATE external_memberships SET access_blocked = 1 WHERE id = 1").run();
    expect(await (await list()).json()).toEqual([]);
    await db.prepare("UPDATE external_memberships SET access_blocked = 0 WHERE id = 1").run();
    await native("external");
    await db.prepare("UPDATE members SET status = 'canceled' WHERE clerk_user_id = 'external'").run();
    expect(await (await list()).json()).toEqual([]);
  });
});
