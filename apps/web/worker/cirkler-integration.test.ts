import { describe, expect, it } from "vitest";
import type { D1Database, D1PreparedStatement } from "./db.js";
import {
  HANDOFF_TTL_SECONDS,
  checkEligibility,
  circlesEntitlementGateway,
  handleCirklerIntegrationRequest,
  type CirklerIntegrationEnv
} from "./cirkler-integration.js";

type Rows = {
  membersById?: Record<number, Record<string, unknown>>;
  membersByClerk?: Record<string, Record<string, unknown>>;
  membersByEmail?: Record<string, Record<string, unknown>>;
  external?: Record<number, Record<string, unknown>>;
};

class Statement implements D1PreparedStatement {
  private values: unknown[] = [];
  constructor(private readonly query: string, private readonly rows: Rows) {}
  bind(...values: unknown[]): D1PreparedStatement { this.values = values; return this; }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const key = this.values[0];
    if (this.query.includes("FROM members WHERE id")) return (this.rows.membersById?.[key as number] ?? null) as T | null;
    if (this.query.includes("FROM members WHERE clerk_user_id")) return (this.rows.membersByClerk?.[key as string] ?? null) as T | null;
    if (this.query.includes("lower(email)")) return (this.rows.membersByEmail?.[key as string] ?? null) as T | null;
    if (this.query.includes("external_memberships")) return (this.rows.external?.[key as number] ?? null) as T | null;
    return null;
  }
  async all<T = Record<string, unknown>>() { return { results: [] as T[] }; }
  async run<T = unknown>() { return { success: true, results: [] as T[] }; }
}

class FakeDatabase implements D1Database {
  constructor(private readonly rows: Rows) {}
  prepare(query: string): D1PreparedStatement { return new Statement(query, this.rows); }
}

const nativeRow = (overrides: Record<string, unknown> = {}) => ({ level: "standard", status: "active", blocked: 0, ...overrides });

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}

async function keyPair() {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  return { privateKey: btoa(String.fromCharCode(...pkcs8)), publicKey: pair.publicKey };
}

describe("CIRKLER eligibility", () => {
  it("accepts members with member benefits and rejects support members", async () => {
    const db = new FakeDatabase({ membersById: { 1: nativeRow(), 2: nativeRow({ level: "reduceret" }), 3: nativeRow({ level: "support" }) } });
    expect(await checkEligibility(db, "HR-1")).toEqual({ ref: "HR-1", eligible: true });
    expect(await checkEligibility(db, "HR-2")).toEqual({ ref: "HR-2", eligible: true });
    expect(await checkEligibility(db, "HR-3")).toEqual({ ref: "HR-3", eligible: false, reason: "no_member_benefits" });
  });

  it("rejects inactive, blocked, unknown and malformed references", async () => {
    const db = new FakeDatabase({ membersById: { 1: nativeRow({ status: "canceled" }), 2: nativeRow({ blocked: 1 }) } });
    expect(await checkEligibility(db, "HR-1")).toMatchObject({ eligible: false, reason: "inactive" });
    expect(await checkEligibility(db, "HR-2")).toMatchObject({ eligible: false, reason: "blocked" });
    expect(await checkEligibility(db, "HR-9")).toMatchObject({ eligible: false, reason: "not_found" });
    expect(await checkEligibility(db, "anna@example.dk")).toMatchObject({ eligible: false, reason: "not_found" });
  });

  it("keeps a MembershipWorks member eligible after they move to the new platform", async () => {
    const db = new FakeDatabase({
      external: { 5: { level: "Standard medlemskab", status: "expired", blocked: 0, email: "anna@example.dk" } },
      membersByEmail: { "anna@example.dk": nativeRow() }
    });
    expect(await checkEligibility(db, "MW-5")).toEqual({ ref: "MW-5", eligible: true });
    expect(await circlesEntitlementGateway(db).getEligibility("MW-5")).toEqual({ eligible: true });
  });
});

describe("CIRKLER endpoints", () => {
  const member = {
    id: 7, clerk_user_id: "user_7", stripe_customer_id: "cus_7", stripe_subscription_id: null, tier: "standard",
    interval: "month", status: "active", full_name: "Anna Hansen", email: "anna@example.dk", phone: "12345678",
    street_address: null, is_teacher: 0, access_blocked: 0
  };

  it("signs a handoff ticket for an active member", async () => {
    const keys = await keyPair();
    const env: CirklerIntegrationEnv = {
      DB: new FakeDatabase({ membersByClerk: { user_7: member } }),
      CLERK_SECRET_KEY: "sk_test",
      CIRKLER_HANDOFF_PRIVATE_KEY: keys.privateKey,
      CIRKLER_BASE_URL: "https://cirkler.example/"
    };
    const response = await handleCirklerIntegrationRequest(
      new Request("https://hjerterum.example/api/integrations/cirkler/handoff", { method: "POST" }),
      env,
      { now: () => 1_000_000, authenticate: async () => ({ userId: "user_7" }), primaryEmail: async () => "anna@example.dk" }
    );
    expect(response.status).toBe(200);
    const { url } = await response.json() as { url: string };
    expect(url.startsWith("https://cirkler.example/hjerterum#token=")).toBe(true);
    const token = decodeURIComponent(url.split("#token=")[1] ?? "");
    const [header, payload, signature] = token.split(".");
    const valid = await crypto.subtle.verify({ name: "Ed25519" }, keys.publicKey, decodeBase64Url(signature ?? ""), new TextEncoder().encode(`${header}.${payload}`));
    expect(valid).toBe(true);
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload ?? "")));
    expect(claims).toMatchObject({ iss: "hjerterum", aud: "cirkler", sub: "HR-7", email: "anna@example.dk", name: "Anna Hansen", phone: "12345678", iat: 1000, exp: 1000 + HANDOFF_TTL_SECONDS });
  });

  it("refuses a handoff without an active membership", async () => {
    const keys = await keyPair();
    const response = await handleCirklerIntegrationRequest(
      new Request("https://hjerterum.example/api/integrations/cirkler/handoff", { method: "POST" }),
      { DB: new FakeDatabase({ membersByClerk: { user_7: { ...member, tier: "support" } } }), CLERK_SECRET_KEY: "sk", CIRKLER_HANDOFF_PRIVATE_KEY: keys.privateKey },
      { now: () => 0, authenticate: async () => ({ userId: "user_7" }), primaryEmail: async () => "anna@example.dk" }
    );
    expect(response.status).toBe(403);
  });

  it("answers the eligibility check only with the service key", async () => {
    const env: CirklerIntegrationEnv = { DB: new FakeDatabase({ membersById: { 7: nativeRow() } }), CIRKLER_SERVICE_KEY: "secret-key" };
    const request = (key: string) => new Request("https://hjerterum.example/api/integrations/cirkler/eligibility", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ refs: ["HR-7", "HR-8"] })
    });
    expect((await handleCirklerIntegrationRequest(request("wrong"), env, { now: () => 0 })).status).toBe(401);
    const response = await handleCirklerIntegrationRequest(request("secret-key"), env, { now: () => 0 });
    expect(response.status).toBe(200);
    const body = await response.json() as { results: unknown[] };
    expect(body.results).toEqual([{ ref: "HR-7", eligible: true }, { ref: "HR-8", eligible: false, reason: "not_found" }]);
  });
});
