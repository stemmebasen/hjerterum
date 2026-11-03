import { describe, expect, it } from "vitest";
import type { D1Database, D1PreparedStatement } from "./db.js";
import { membershipFromUpload, resolveActiveMembership } from "./membership-access.js";
import { testDatabase } from "./saga/test-support.js";

class MemberStatement implements D1PreparedStatement {
  constructor(private readonly row: Record<string, unknown> | null) {}
  bind(..._values: unknown[]): D1PreparedStatement { return this; }
  async first<T = Record<string, unknown>>(): Promise<T | null> { return this.row as T | null; }
  async all<T = Record<string, unknown>>() { return { results: [] as T[] }; }
  async run<T = unknown>() { return { success: true, results: [] as T[] }; }
}

class MemberDatabase implements D1Database {
  constructor(private readonly row: Record<string, unknown> | null) {}
  prepare(_query: string): D1PreparedStatement { return new MemberStatement(this.row); }
}

const activeMember = {
  id: 1,
  clerk_user_id: "user_1",
  stripe_customer_id: "cus_1",
  stripe_subscription_id: "sub_1",
  tier: "standard",
  interval: "month",
  status: "active",
  full_name: "Anna",
  email: "anna@example.dk",
  phone: null,
  street_address: null,
  is_teacher: 0,
  access_blocked: 0
};

describe("active membership resolution", () => {
  it("allows generous members to use member benefits", async () => {
    const result = await resolveActiveMembership(new MemberDatabase({ ...activeMember, tier: "generoest" }), "user_1");
    expect(result).toMatchObject({ source: "hjerterum" });
  });

  it("denies member benefits to support members but lets them manage their own membership", async () => {
    const db = new MemberDatabase({ ...activeMember, tier: "support" });
    expect(await resolveActiveMembership(db, "user_1")).toBeNull();
    expect(await resolveActiveMembership(db, "user_1", undefined, false)).toMatchObject({ source: "hjerterum" });
  });

  it("returns a native active member", async () => {
    const result = await resolveActiveMembership(new MemberDatabase(activeMember), "user_1");
    expect(result).toMatchObject({ source: "hjerterum", fullName: "Anna", email: "anna@example.dk" });
  });

  it("denies an administratively blocked member", async () => {
    const result = await resolveActiveMembership(
      new MemberDatabase({ ...activeMember, access_blocked: 1 }),
      "user_1"
    );
    expect(result).toBeNull();
  });

  it("denies an inactive native member without falling through to an external identity", async () => {
    const result = await resolveActiveMembership(
      new MemberDatabase({ ...activeMember, status: "canceled" }),
      "user_1"
    );
    expect(result).toBeNull();
  });

  // Reported: "Hvorfor kan Frederik ikke oprette en bruger" - he is in the MembershipWorks export uploaded in admin, which the login did not read.
  it("finds a member in the uploaded MembershipWorks export, and keeps support members out of the benefits", async () => {
    const db = testDatabase();
    await db.prepare("INSERT INTO membershipworks_uploads (filename, uploaded_by, accounts, uploaded_at_ms) VALUES ('x.csv', 'Jacob', 2, 1)").run();
    const add = (email: string, name: string, tier: string | null) => db.prepare(`INSERT INTO membershipworks_accounts (email, full_name, tier, row_json, upload_id) VALUES (?, ?, ?, '{}', 1)`).bind(email, name, tier).run();
    await add("frederik@example.dk", "Frederik", "standard");
    await add("stoette@example.dk", "Støtte", "support");
    expect(await membershipFromUpload(db, " Frederik@Example.dk ")).toMatchObject({ source: "membershipworks", fullName: "Frederik", membershipLevel: "standard", externalId: 1_000_001 });
    expect(await membershipFromUpload(db, "stoette@example.dk")).toBeNull();
    expect(await membershipFromUpload(db, "stoette@example.dk", false)).toMatchObject({ fullName: "Støtte" });
    expect(await membershipFromUpload(db, "ukendt@example.dk")).toBeNull();
  });

  // Security review (3 Nov 2026), point 3: a cancelled membership that has run out, or an account with no membership, is not a member.
  it("keeps cancelled, lapsed and plan-less accounts from the export out", async () => {
    const db = testDatabase();
    const now = Date.parse("2026-11-03T10:00:00Z");
    await db.prepare("INSERT INTO membershipworks_uploads (filename, uploaded_by, accounts, uploaded_at_ms) VALUES ('x.csv', 'Jacob', 6, 1)").run();
    const add = (email: string, plan: string | null, tier: string | null, renews: string | null, cancelled = false) => db.prepare(`INSERT INTO membershipworks_accounts (email, full_name, plan, tier, renews_on, row_json, upload_id)
      VALUES (?, ?, ?, ?, ?, ?, 1)`).bind(email, email, plan, tier, renews, JSON.stringify({ cancelled })).run();
    await add("aktiv@x.dk", "Standard medlemskab", "standard", "2026-12-01");
    await add("opsagt-loeber@x.dk", "Standard medlemskab", "standard", "2026-11-20", true);
    await add("opsagt-udloebet@x.dk", "Standard medlemskab", "standard", "2026-10-01", true);
    await add("kun-opsagt@x.dk", "Membership Payment Cancelled", null, null, true);
    await add("ubetalt@x.dk", "Standard medlemskab", "standard", "2026-09-01");
    await add("intet@x.dk", null, null, null);
    await add("gratis@x.dk", "Free Membership", null, null);
    const member = async (email: string) => Boolean(await membershipFromUpload(db, email, true, now));
    expect(await member("aktiv@x.dk")).toBe(true);
    expect(await member("opsagt-loeber@x.dk")).toBe(true);
    expect(await member("opsagt-udloebet@x.dk")).toBe(false);
    expect(await member("kun-opsagt@x.dk")).toBe(false);
    expect(await member("ubetalt@x.dk")).toBe(false);
    expect(await member("intet@x.dk")).toBe(false);
    expect(await member("gratis@x.dk")).toBe(true);
  });
});
