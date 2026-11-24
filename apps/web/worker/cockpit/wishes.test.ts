import { describe, expect, it } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { BOARD, deps, fakeServices, OWNER, personalCookie, sagaEnv, testDatabase, memberCookie } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";

// Asked (the chair, 24 Nov 2026): "Er det muligt han på en eller måde kan chatte med ai om ændringerne - og så ligger den endelig implementering og godkendelse
// stadig hos mig?" - "Ja".
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-11-24T10:00:00Z");

async function setup() {
  const db = testDatabase();
  for (const [i, [name, tid]] of ([["Jacob Hauge", OWNER], ["Lisbeth", "201"], ["Douglas Crawford", "202"]] as const).entries())
    await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: tid, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
  await db.prepare("INSERT INTO cockpit_login_links (token_hash, member, telegram_id, created_at_ms, expires_at_ms, code_hash, role) VALUES ('x', 'Douglas Crawford', '202', ?, ?, 'y', NULL)").bind(NOW - 1000, NOW + 1000).run();
  const asked: string[] = [];
  const services = fakeServices({ ai: (system, user) => {
    asked.push(`${system}\n${user}`);
    return asked.length === 1 ? '{"svar": "Which page were you on?", "oenske": null}'
      : '{"svar": "Here is the wish - change it if you like, or send it to Jacob.", "oenske": {"titel": "Bigger sign-up button on the event page", "beskrivelse": "On an event page the sign-up button is small. Douglas: \\"make it bigger\\"."}}';
  } });
  const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
  const call = (path: string, init: RequestInit & { cookie?: string } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
    ...init, redirect: "manual", headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, NOW));
  const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
  const session = ((await call("/login", { method: "POST", body: form({ password: "hjerte-2026" }) })).headers.get("set-cookie") ?? "").split(";")[0]!;
  return { db, call, form, services, asked, lisbeth: await memberCookie(session, "Lisbeth"), chair: await personalCookie("Jacob Hauge", NOW), douglas: await personalCookie("Douglas Crawford", NOW) };
}

describe("wishes and faults in admin", () => {
  it("lets Douglas talk a wish through with Saga and send it, and only the chair decides", async () => {
    const { db, call, form, services, asked, lisbeth, chair, douglas } = await setup();
    expect((await call("/oensker", { cookie: lisbeth })).status).toBe(403);
    expect(await (await call("/", { cookie: douglas })).text()).toContain("/oensker");

    const made = await call("/oensker/ny", { method: "POST", cookie: douglas });
    const at = made.headers.get("location")!;
    expect(at).toMatch(/\/oensker\/\d+$/);
    const id = at.split("/").pop()!;

    await call(`/oensker/${id}/besked`, { method: "POST", cookie: douglas, body: form({ text: "The sign-up button is too small" }) });
    expect(await (await call(`/oensker/${id}`, { cookie: douglas })).text()).toContain("Which page were you on?");
    // Not ready yet: nothing to send.
    await call(`/oensker/${id}/send`, { method: "POST", cookie: douglas });
    expect((await db.prepare("SELECT status FROM wishes WHERE id = ?").bind(id).first<{ status: string }>())!.status).toBe("open");

    await call(`/oensker/${id}/besked`, { method: "POST", cookie: douglas, body: form({ text: "The event page" }) });
    // Saga sees the whole conversation, and what she knows about the system.
    expect(asked[1]).toContain("Eventplanlæggeren");
    const page = await (await call(`/oensker/${id}`, { cookie: douglas })).text();
    expect(page).toContain("Bigger sign-up button on the event page");
    expect(page).toContain("Send ønsket til formanden");
    // Douglas cannot decide.
    expect((await call(`/oensker/${id}/afgoer`, { method: "POST", cookie: douglas, body: form({ svar: "godkend" }) })).status).toBe(403);

    await call(`/oensker/${id}/send`, { method: "POST", cookie: douglas });
    expect((await db.prepare("SELECT status FROM wishes WHERE id = ?").bind(id).first<{ status: string }>())!.status).toBe("sent");
    const told = services.telegram("sendMessage").map(c => JSON.stringify(c.body));
    expect(told.some(t => t.includes("har sendt et ønske") && t.includes("Bigger sign-up button"))).toBe(true);
    // The conversation is closed once it is sent.
    await call(`/oensker/${id}/besked`, { method: "POST", cookie: douglas, body: form({ text: "One more thing" }) });
    expect(asked).toHaveLength(2);

    expect(await (await call("/oensker", { cookie: chair })).text()).toContain("Venter på dig");
    await call(`/oensker/${id}/afgoer`, { method: "POST", cookie: chair, body: form({ svar: "godkend", note: "Good idea" }) });
    expect((await db.prepare("SELECT status, chair_note FROM wishes WHERE id = ?").bind(id).first())).toEqual({ status: "approved", chair_note: "Good idea" });
    expect(services.telegram("sendMessage").map(c => JSON.stringify(c.body)).some(t => t.includes("was approved") && t.includes("202"))).toBe(true);
    const list = await (await call("/oensker", { cookie: chair })).text();
    expect(list).toContain("Godkendte ønsker samlet");
    expect(list).toContain("Formandens note: Good idea");
    // Douglas does not get the chair's list.
    expect(await (await call("/oensker", { cookie: douglas })).text()).not.toContain("Godkendte ønsker samlet");

    await call(`/oensker/${id}/lavet`, { method: "POST", cookie: chair });
    expect((await db.prepare("SELECT status FROM wishes WHERE id = ?").bind(id).first<{ status: string }>())!.status).toBe("done");
  });
});
