import { describe, expect, it } from "vitest";
import { allowedEmails, cockpitAdmins, memberAreaAdmins, stateOf } from "./admins.js";
import { BOARD, deps, fakeServices, OWNER, sagaEnv, testDatabase } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";

// Requested by the chair as super admin: "what active admin members are there".

const NOW = Date.parse("2026-10-06T12:00:00Z");
const DAY = 86_400_000;

async function board() {
  const db = testDatabase();
  const env = sagaEnv(db, { ALLOWED_EMAILS: "jacob@example.dk, Lisbeth@Example.dk,ikke-en-mail, jacob@example.dk, ny@example.dk", CLERK_SECRET_KEY: "sk_test" });
  for (const [i, [name, id]] of ([["Jacob Hauge", OWNER], ["Lisbeth", "201"], ["Gitta", "202"], ["Douglas", "203"]] as const).entries()) {
    await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: id, text: "Hej", sentAtMs: NOW - 40 * DAY, fromAssistant: false });
  }
  return { db, env };
}

describe("the state of an admin", () => {
  it("is active within 30 days, quiet after, never without a trace, and closed when access was closed", () => {
    expect(stateOf(NOW - 29 * DAY, null, NOW)).toBe("active");
    expect(stateOf(NOW - 31 * DAY, null, NOW)).toBe("quiet");
    expect(stateOf(null, null, NOW)).toBe("never");
    expect(stateOf(NOW - DAY, NOW - 2 * DAY, NOW)).toBe("closed");
  });
});

describe("the board in the cockpit", () => {
  it("lists everyone from the board's group, the chair first, with when each was last seen", async () => {
    const { db, env } = await board();
    await db.prepare("INSERT INTO cockpit_login_links (token_hash, member, telegram_id, created_at_ms, expires_at_ms, used_at_ms) VALUES ('a', 'Lisbeth', '201', ?, ?, ?)").bind(NOW - 3 * DAY, NOW - 3 * DAY + 900_000, NOW - 3 * DAY).run();
    await db.prepare("INSERT INTO cockpit_questions (asked_by, question, answer, created_at_ms) VALUES ('Gitta', 'Hvad er budgettet?', 'x', ?)").bind(NOW - 45 * DAY).run();
    await db.prepare("INSERT INTO cockpit_todos (owner, text, created_by, created_at_ms, done_at_ms) VALUES ('Jacob Hauge', 'Ring', 'Jacob Hauge', ?, ?)").bind(NOW - 5 * DAY, NOW - DAY).run();
    const list = await cockpitAdmins(env, db, NOW);
    expect(list.map(a => [a.name, a.chair, a.state])).toEqual([
      ["Jacob Hauge", true, "active"], ["Lisbeth", false, "active"], ["Gitta", false, "quiet"], ["Douglas", false, "never"]
    ]);
    expect(list[0]!.lastSeenMs).toBe(NOW - DAY);
    expect(list[3]!.lastSeenMs).toBeNull();
  });

  it("marks a member whose access the chair closed, until a new personal link is used", async () => {
    const { db, env } = await board();
    await db.prepare("INSERT INTO cockpit_login_links (token_hash, member, telegram_id, created_at_ms, expires_at_ms, used_at_ms) VALUES ('a', 'Lisbeth', '201', ?, ?, ?)").bind(NOW - 3 * DAY, NOW, NOW - 3 * DAY).run();
    await db.prepare("INSERT INTO cockpit_signouts (member, after_ms) VALUES ('Lisbeth', ?)").bind(NOW - DAY).run();
    expect((await cockpitAdmins(env, db, NOW)).find(a => a.name === "Lisbeth")).toMatchObject({ state: "closed", closedMs: NOW - DAY });
    await db.prepare("INSERT INTO cockpit_login_links (token_hash, member, telegram_id, created_at_ms, expires_at_ms, used_at_ms) VALUES ('b', 'Lisbeth', '201', ?, ?, ?)").bind(NOW - 3600_000, NOW, NOW - 3600_000).run();
    expect((await cockpitAdmins(env, db, NOW)).find(a => a.name === "Lisbeth")).toMatchObject({ state: "active", closedMs: null });
  });
});

describe("the admin e-mails of the member area", () => {
  it("reads the list once, in lower case, without what is not an e-mail", () => {
    expect(allowedEmails("jacob@example.dk, Lisbeth@Example.dk,ikke-en-mail, jacob@example.dk")).toEqual(["jacob@example.dk", "lisbeth@example.dk"]);
    expect(allowedEmails(undefined)).toEqual([]);
  });

  it("looks each one up at Clerk for a name and the last sign-in, and says so when the lookup fails", async () => {
    const { env } = await board();
    const clerk = (email: string, extra: Record<string, unknown> = {}) => ({ id: `user_${email[0]}`, first_name: "Jacob", last_name: "Hauge", ...extra, email_addresses: [{ email_address: email, verification: { status: "verified" } }] });
    const calls: string[] = [];
    const fetcher: typeof fetch = async input => {
      const url = new URL(String(input));
      const email = url.searchParams.get("email_address")!;
      calls.push(email);
      if (email === "jacob@example.dk") return Response.json([clerk(email, { last_sign_in_at: NOW - 2 * DAY, last_active_at: NOW - DAY })]);
      if (email === "lisbeth@example.dk") return Response.json([clerk(email, { first_name: "Lisbeth", last_name: "", last_sign_in_at: NOW - 60 * DAY })]);
      if (email === "ny@example.dk") return Response.json([]);
      return new Response("nej", { status: 500 });
    };
    const list = await memberAreaAdmins(env, deps(fetcher, NOW), NOW);
    expect(calls.sort()).toEqual(["jacob@example.dk", "lisbeth@example.dk", "ny@example.dk"]);
    expect(list.map(a => [a.email, a.name, a.state])).toEqual([["jacob@example.dk", "Jacob Hauge", "active"], ["lisbeth@example.dk", "Lisbeth", "quiet"], ["ny@example.dk", null, "never"]]);
    expect(list[0]!.lastSeenMs).toBe(NOW - DAY);

    const broken = await memberAreaAdmins(env, deps(async () => new Response("nej", { status: 500 }), NOW), NOW);
    expect(broken.every(a => a.state === "unknown" && a.note)).toBe(true);
    const noKey = await memberAreaAdmins({ ...env, CLERK_SECRET_KEY: "" }, deps(fakeServices().fetcher, NOW), NOW);
    expect(noKey[0]).toMatchObject({ state: "unknown", note: expect.stringContaining("Clerk er ikke koblet") });
  });
});
