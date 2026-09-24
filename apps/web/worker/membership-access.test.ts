import { describe, expect, it } from "vitest";
import type { D1Database, D1PreparedStatement } from "./db.js";
import { resolveActiveMembership } from "./membership-access.js";

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
});
