import { describe, expect, it } from "vitest";
import { handleCockpitRequest } from "./cockpit/handler.js";
import { grantMembership, linkMembershipWorks, memberById, memberTimeline, readMembershipWorksExport, saveMembershipWorksExport, statusText } from "./member-admin.js";
import { createBillingPortalUrl, getMemberByClerkUserId, processMemberStripeEvent } from "./members.js";
import { resolveActiveMembership } from "./membership-access.js";
import { deps, memberCookie, sagaEnv, testDatabase } from "./saga/test-support.js";
import type { D1Database } from "./db.js";

// Requested: "Hvad med "Medlemmer"-sektion i admin, hvor vi kan se medlemmer, profilinfo, status og historik?" - "Husk den
// skal lægge sig op ad hvad MembershipWorks gør med medlemmer" - "vi skal kun fokusere på vores eget systems medlemmer" -
// and the export: "Det er godt at have dette liggende, når og hvis medlemmet vælger at oprette sig i vores nye system".
// Everyone here is made up.

const NOW = Date.parse("2026-10-04T10:00:00Z");
const ADMIN = "https://admin.hjerterum.info";

/** A MembershipWorks account export as it comes: labels as columns, "Sep 20, 2026" dates, a BOM. */
const EXPORT = "﻿" + [
  "Admin note,Account Name,First Name,Last Name,Email,Telephone,Standard medlemskab - kr222 / md. eller kr2,310 / år (spar kr354),Free Membership,Reduceret pris medlemskab - kr111 /md. eller kr1,155 / år (spar kr177),Teacher,Hjerterum Team,Join Date,Renewal Date,Billing Method,Auto Billing ID,Account ID",
  ",Mette Holm,Mette,Holm,Mette@Example.dk,11223344,Standard medlemskab - kr222 / md. eller kr2,310 / år (spar kr354),,,Teacher,,\"Apr 28, 2025\",\"Nov 28, 2026\",Standard medlemskab - månedlig betaling,cus_TestMette01,680f5aae37f3c27dfd0f0001",
  ",Ole Berg,Ole,Berg,ole@example.dk,,,Free Membership,,,Hjerterum Team,\"Jan 5, 2024\",,,,680f5aae37f3c27dfd0f0002",
  ",Sara Lind,Sara,Lind,sara@example.dk,55667788,,,Reduceret pris medlemskab - kr111 /md. eller kr1,155 / år (spar kr177),,,\"Sep 1, 2026\",\"Aug 30, 2026\",Reduceret pris medlemskab - månedlig betaling,cus_TestSara02,680f5aae37f3c27dfd0f0003",
  ",Uden Mail,Uden,Mail,,,,,,,,\"Sep 1, 2026\",,,,680f5aae37f3c27dfd0f0004"
].map(line => line.replace(/Standard medlemskab - kr222 \/ md\. eller kr2,310 \/ år \(spar kr354\)/g, "\"Standard medlemskab - kr222 / md. eller kr2,310 / år (spar kr354)\"")
  .replace(/Reduceret pris medlemskab - kr111 \/md\. eller kr1,155 \/ år \(spar kr177\)/g, "\"Reduceret pris medlemskab - kr111 /md. eller kr1,155 / år (spar kr177)\"")).join("\r\n");

/** Clerk, faked: who has logged in at the member area. */
function clerk(users: Record<string, { id: string; first_name: string; last_name: string }>): typeof fetch {
  return async input => {
    const url = new URL(String(input));
    if (url.hostname !== "api.clerk.com") return new Response("{}", { status: 404 });
    const email = url.searchParams.get("email_address") ?? "";
    const user = users[email];
    return Response.json(user ? [{ ...user, email_addresses: [{ email_address: email, verification: { status: email.startsWith("ubekraeftet") ? "unverified" : "verified" } }] }] : []);
  };
}

async function stripeMember(db: D1Database, email = "nina@example.dk") {
  await processMemberStripeEvent(db, { id: "evt_join", type: "checkout.session.completed", created: NOW / 1000 - 86_400 * 30,
    data: { object: { customer: "cus_Nina", subscription: "sub_Nina", amount_total: 22_200, metadata: { clerk_user_id: "user_nina", tier: "standard", interval: "month", full_name: "Nina Dahl" },
      customer_details: { email, name: "Nina Dahl" } } } } as never);
  return (await getMemberByClerkUserId(db, "user_nina"))!;
}

describe("MembershipWorks' export, kept for reference", () => {
  it("reads labels, dates, billing and the Stripe customer, and skips rows without an email", () => {
    const { accounts, skipped } = readMembershipWorksExport(EXPORT);
    expect(skipped).toBe(1);
    expect(accounts.map(a => a.email)).toEqual(["mette@example.dk", "ole@example.dk", "sara@example.dk"]);
    expect(accounts[0]).toEqual({ email: "mette@example.dk", accountId: "680f5aae37f3c27dfd0f0001", fullName: "Mette Holm", phone: "11223344",
      plan: "Standard medlemskab - kr222 / md. eller kr2,310 / år (spar kr354)", tier: "standard", interval: "month", billing: "auto", joinedOn: "2025-04-28", renewsOn: "2026-11-28",
      stripeCustomerId: "cus_TestMette01", labels: ["Teacher"] });
    expect(accounts[1]).toMatchObject({ plan: "Free Membership", tier: null, billing: null, interval: null, labels: ["Hjerterum Team"], phone: null });
    expect(accounts[2]).toMatchObject({ tier: "reduceret", renewsOn: "2026-08-30" });
  });

  it("gives no one access", async () => {
    const db = testDatabase();
    await saveMembershipWorksExport(db, "export.csv", "Jacob Hauge", EXPORT, NOW);
    expect(await resolveActiveMembership(db, "user_mette", "clerk-key").catch(() => null)).toBeNull();
    expect(await db.prepare("SELECT COUNT(*) AS n FROM members").first<{ n: number }>()).toEqual({ n: 0 });
  });
});

describe("giving a membership, as MembershipWorks' manual billing", () => {
  it("gives a logged-in person a membership with access at once, and links what MembershipWorks knows", async () => {
    const db = testDatabase();
    await saveMembershipWorksExport(db, "export.csv", "Jacob Hauge", EXPORT, NOW);
    const env = sagaEnv(db, { CLERK_SECRET_KEY: "clerk-key" });
    const id = await grantMembership(db, env, deps(clerk({ "mette@example.dk": { id: "user_mette", first_name: "Mette", last_name: "Holm" } }), NOW),
      { email: "Mette@example.dk ", tier: "standard", note: "Frivillig i caféen", by: "Jacob Hauge" });
    const m = (await memberById(db, id))!;
    expect(m).toMatchObject({ fullName: "Mette Holm", email: "mette@example.dk", tier: "standard", status: "active", billing: "manual", joinedOn: "2025-04-28", phone: "11223344",
      isTeacher: true, membershipworksId: "680f5aae37f3c27dfd0f0001" });
    expect(await resolveActiveMembership(db, "user_mette", "clerk-key")).toMatchObject({ source: "hjerterum", fullName: "Mette Holm" });
    const timeline = await memberTimeline(db, m);
    expect(timeline.map(e => e.title)).toEqual(expect.arrayContaining(["Medlemskab givet: Standard medlemskab", "Fundet i MembershipWorks"]));
    expect(timeline.find(e => e.kind === "granted")).toMatchObject({ detail: "Frivillig i caféen", by: "Jacob Hauge" });
    expect(timeline.find(e => e.kind === "moved")!.detail).toContain("betaler stadig i MembershipWorks (næste træk 28. nov. 2026) - stop betalingen dér");
    // The member area shows it without card payments, and never sends it to Stripe.
    expect((await getMemberByClerkUserId(db, "user_mette"))!.billing).toBe("manual");
    await expect(createBillingPortalUrl(db, "sk_test", "https://medlem.hjerterum.info", "user_mette")).rejects.toThrow("membership_manual");
  });

  it("needs the person to have logged in once, and does not give twice", async () => {
    const db = testDatabase();
    const env = sagaEnv(db, { CLERK_SECRET_KEY: "clerk-key" });
    const d = deps(clerk({ "ks@example.dk": { id: "user_ks", first_name: "", last_name: "" } }), NOW);
    await expect(grantMembership(db, env, d, { email: "ny@example.dk", tier: "standard", note: "", by: "Jacob" })).rejects.toThrow("no_account");
    const unverified = deps(clerk({ "ubekraeftet@example.dk": { id: "user_x", first_name: "X", last_name: "" } }), NOW);
    await expect(grantMembership(db, env, unverified, { email: "ubekraeftet@example.dk", tier: "standard", note: "", by: "Jacob" })).rejects.toThrow("no_account");
    await expect(grantMembership(db, env, d, { email: "ks@example.dk", tier: "guld", note: "", by: "Jacob" })).rejects.toThrow("invalid_tier");
    const id = await grantMembership(db, env, d, { email: "ks@example.dk", tier: "support", note: "", by: "Jacob" });
    expect((await memberById(db, id))!.fullName).toBe("ks");
    await expect(grantMembership(db, env, d, { email: "ks@example.dk", tier: "standard", note: "", by: "Jacob" })).rejects.toThrow("already_member");
    await expect(grantMembership(db, sagaEnv(db), d, { email: "ks@example.dk", tier: "standard", note: "", by: "Jacob" })).rejects.toThrow("clerk_not_configured");
  });
});

describe("the timeline from Stripe", () => {
  it("writes joining, payments, failed payments and status changes once each, with how long a member has been past due", async () => {
    const db = testDatabase();
    let m = await stripeMember(db);
    const paid = { id: "evt_paid", type: "invoice.paid", created: NOW / 1000 - 86_400 * 30, data: { object: { customer: "cus_Nina", amount_paid: 22_200, billing_reason: "subscription_create" } } };
    await processMemberStripeEvent(db, paid as never);
    await processMemberStripeEvent(db, paid as never);
    await processMemberStripeEvent(db, { id: "evt_fail", type: "invoice.payment_failed", created: NOW / 1000 - 86_400 * 5, data: { object: { customer: "cus_Nina", amount_due: 22_200, attempt_count: 2 } } } as never);
    m = (await getMemberByClerkUserId(db, "user_nina"))!;
    const admin = (await memberById(db, m.id))!;
    expect(admin.status).toBe("past_due");
    expect(statusText(admin, NOW)).toBe("I restance 5 dage");
    await processMemberStripeEvent(db, { id: "evt_back", type: "customer.subscription.updated", created: NOW / 1000 - 86_400, data: { object: { id: "sub_Nina", status: "active" } } } as never);
    await processMemberStripeEvent(db, { id: "evt_end", type: "customer.subscription.deleted", created: NOW / 1000, data: { object: { id: "sub_Nina" } } } as never);
    const timeline = await memberTimeline(db, (await memberById(db, m.id))!);
    expect(timeline.map(e => [e.title, e.amountMinor, e.detail])).toEqual([
      ["Medlemskab opsagt", null, null],
      ["Status: I restance → Aktiv", null, null],
      ["Status: Aktiv → I restance", null, null],
      ["Betaling mislykkedes", 22_200, "Forsøg 2"],
      ["Betaling", 22_200, "Første betaling"],
      ["Blev medlem: Standard medlemskab", 22_200, "Månedlig betaling med kort"]
    ]);
  });
});

describe("admin → Medlemmer", () => {
  async function setup() {
    const db = testDatabase();
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026", CLERK_SECRET_KEY: "clerk-key" });
    const fetcher = clerk({ "mette@example.dk": { id: "user_mette", first_name: "Mette", last_name: "Holm" } });
    const call = (path: string, init: RequestInit = {}) => handleCockpitRequest(new Request(ADMIN + path, { ...init, headers: { origin: ADMIN, ...(init.headers ?? {}) } }), env, deps(fetcher, NOW));
    const form = new FormData(); form.append("password", "hjerte-2026");
    const session = ((await call("/login", { method: "POST", body: form })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const cookie = await memberCookie(session, "Jacob Hauge");
    const post = (path: string, fields: Record<string, string | Blob>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return call(path, { method: "POST", body: f, headers: { cookie } }); };
    return { db, env, call, cookie, post };
  }

  it("is for the board only", async () => {
    const { call } = await setup();
    expect((await call("/medlemmer")).status).toBe(401);
  });

  it("lists the members with their status, and finds them by name, email and status", async () => {
    const { db, call, cookie } = await setup();
    await stripeMember(db);
    await processMemberStripeEvent(db, { id: "evt_fail", type: "invoice.payment_failed", created: NOW / 1000 - 86_400 * 35, data: { object: { customer: "cus_Nina", amount_due: 22_200 } } } as never);
    const page = await (await call("/medlemmer", { headers: { cookie } })).text();
    expect(page).toContain("Nina Dahl");
    expect(page).toContain("I restance 35 dage");
    expect(page).toContain('href="/medlemmer" class="on"');
    expect(page).not.toContain("Ingen medlemmer i det nye system endnu.");
    expect(await (await call("/medlemmer?q=nina%40example", { headers: { cookie } })).text()).toContain("Nina Dahl");
    expect(await (await call("/medlemmer?status=aktive", { headers: { cookie } })).text()).toContain("Ingen medlemmer matcher søgningen.");
    // MembershipWorks' figures from a screenshot moved under Medlemmer.
    expect(await (await call("/medlemmer/tal", { headers: { cookie } })).text()).toContain("<h1>Tal fra MembershipWorks</h1>");
  });

  it("gives a membership, keeps the export, and shows a member as MembershipWorks does", async () => {
    const { db, call, cookie, post } = await setup();
    const upload = await post("/medlemmer/membershipworks", { fil: new File([EXPORT], "export.csv", { type: "text/csv" }) });
    expect(upload.headers.get("location")).toBe("/medlemmer?besked=eksport-3");
    expect(await (await call("/medlemmer?besked=eksport-3", { headers: { cookie } })).text()).toContain("MembershipWorks-eksporten er gemt: 3 konti.");
    const missing = await post("/medlemmer/giv", { email: "nobody@example.dk", tier: "standard", note: "" });
    expect(missing.headers.get("location")).toBe("/medlemmer?fejl=no_account#giv");
    const given = await post("/medlemmer/giv", { email: "mette@example.dk", tier: "standard", note: "" });
    const at = given.headers.get("location")!;
    expect(at).toMatch(/^\/medlemmer\/\d+\?besked=givet$/);
    const id = Number(/\/medlemmer\/(\d+)/.exec(at)![1]);

    const membership = await (await call(`/medlemmer/${id}`, { headers: { cookie } })).text();
    for (const text of ["<h1>Mette Holm</h1>", "Standard medlemskab", "Aktiv", "Manuel betaling - givet af Hjerterum", "Medlem siden 28. apr. 2025", "Underviser", "Fra MembershipWorks",
      "Betaler stadig i MembershipWorks", "https://membershipworks.com/admin/#!biz/id/680f5aae37f3c27dfd0f0001", 'aria-current="page">Medlemskab']) expect(membership).toContain(text);
    const contact = await (await call(`/medlemmer/${id}?fane=kontakt`, { headers: { cookie } })).text();
    expect(contact).toContain('href="tel:11223344"');
    expect(contact).toContain('href="mailto:mette@example.dk"');

    await post(`/medlemmer/${id}/note`, { note: "Ringede om at flytte sit kort." });
    await post(`/medlemmer/${id}/adgang`, { blocked: "1" });
    await post(`/medlemmer/${id}/medlemskab`, { tier: "reduceret" });
    await post(`/medlemmer/${id}/afslut`, {});
    const timeline = await (await call(`/medlemmer/${id}?fane=tidslinje`, { headers: { cookie } })).text();
    for (const text of ["Ringede om at flytte sit kort.", "Adgang blokeret", "Medlemskab ændret: Standard medlemskab → Reduceret pris medlemskab", "Medlemskab afsluttet",
      "Medlemskab givet: Standard medlemskab", "Fundet i MembershipWorks", "Jacob Hauge"]) expect(timeline).toContain(text);
    expect((await memberById(db, id))).toMatchObject({ status: "canceled", tier: "reduceret", accessBlocked: true });

    // Events: what they created here and in the calendar, and what they signed up for.
    await db.prepare(`INSERT INTO room_bookings (id, clerk_user_id, teacher_name, teacher_email, title, starts_at_ms, ends_at_ms, created_at_ms, updated_at_ms)
      VALUES (1, 'user_mette', 'Mette Holm', 'mette@example.dk', 'Yin yoga', ?, ?, ?, ?), (2, 'user_other', 'Ole Berg', 'ole@example.dk', 'Lydbad', ?, ?, ?, ?)`)
      .bind(NOW + 86_400_000, NOW + 90_000_000, NOW, NOW, NOW + 2 * 86_400_000, NOW + 2 * 86_400_000 + 3_600_000, NOW, NOW).run();
    await db.prepare("INSERT INTO room_booking_attendees (room_booking_id, clerk_user_id, member_name, member_email, created_at_ms) VALUES (2, 'user_mette', 'Mette Holm', 'mette@example.dk', ?)").bind(NOW).run();
    await db.prepare("INSERT INTO house_events (id, title, starts_at_ms, host, content_hash, updated_at_ms) VALUES ('e1', 'Satsanga', ?, 'Mette Holm', 'h', ?)").bind(NOW - 86_400_000, NOW).run();
    const events = await (await call(`/medlemmer/${id}?fane=events`, { headers: { cookie } })).text();
    for (const text of ["Har oprettet <span class=\"pill\">2</span>", "Yin yoga", "Satsanga", "Hjerterums kalender", "Tilmeldt <span class=\"pill\">1</span>", "Lydbad"]) expect(events).toContain(text);
  });
});

it("links a member who joins later to their MembershipWorks account", async () => {
  const db = testDatabase();
  const m = await stripeMember(db, "sara@example.dk");
  await saveMembershipWorksExport(db, "export.csv", "Jacob Hauge", EXPORT, NOW);
  const linked = (await memberById(db, m.id))!;
  expect(linked).toMatchObject({ membershipworksId: "680f5aae37f3c27dfd0f0003", joinedOn: "2026-09-01", phone: "55667788", isTeacher: false });
  // Their renewal date has passed: no reminder about paying twice.
  expect((await memberTimeline(db, linked)).find(e => e.kind === "moved")!.detail).not.toContain("betaler stadig");
  await linkMembershipWorks(db, m.id, NOW);
  expect((await memberTimeline(db, linked)).filter(e => e.kind === "moved")).toHaveLength(1);
});
