import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { BOARD, deps, fakeServices, OWNER, personalCookie, sagaEnv, testDatabase, memberCookie } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";

// Requested: "Så jeg bliver i stand til at sende mails ud fra Board Admin til modtagerne?" - "Ja".
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-11-02T10:00:00Z");

describe("a mail to the list from admin", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is the chair's: written or drafted by Saga, tried on one address, sent once to all or to the members", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices({ ai: () => JSON.stringify({ subject: "Julefest i Hjerterum", preheader: "Fredag den 11. december", heading: "Julefest", body: "Kære ven\n\nVi holder julefest.\n\nKærlig hilsen\nHjerterum" }) });
    const mc: Array<{ method: string; path: string; body: unknown }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (!url.startsWith("https://us6.api.mailchimp.com/3.0")) return services.fetcher(input, init);
      const path = url.slice("https://us6.api.mailchimp.com/3.0".length), method = init?.method ?? "GET";
      mc.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (path === "/lists/0070dc72a9") return new Response(JSON.stringify({ stats: { member_count: 893 }, campaign_defaults: { from_name: "Hjerterum", from_email: "team@hjerterum.info" } }));
      if (path.startsWith("/lists/0070dc72a9/segments")) return new Response(JSON.stringify({ segments: [{ id: 77, name: "Medlem", member_count: 160 }] }));
      if (path === "/campaigns" && method === "POST") return new Response(JSON.stringify({ id: "camp1" }));
      return new Response("{}");
    };
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026", MAILCHIMP_API_KEY: "k-us6" } as never);
    const call = (path: string, init: RequestInit & { cookie?: string } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
      ...init, redirect: "manual", headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(fetcher, NOW));
    const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
    const session = ((await call("/login", { method: "POST", body: form({ password: "hjerte-2026" }) })).headers.get("set-cookie") ?? "").split(";")[0]!;
    for (const [i, [name, tid]] of ([["Jacob Hauge", OWNER], ["Lisbeth", "201"]] as const).entries())
      await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: tid, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });

    // Not the board's yet (docs/decisions/0007).
    const lisbeth = await memberCookie(session, "Lisbeth");
    expect((await call("/arrangementer/mail", { cookie: lisbeth })).status).toBe(403);
    expect(await (await call("/arrangementer", { cookie: lisbeth })).text()).not.toContain("/arrangementer/mail");

    const cookie = await personalCookie("Jacob Hauge", NOW);
    expect(await (await call("/arrangementer", { cookie })).text()).toContain('href="/arrangementer/mail"');
    const made = await call("/arrangementer/mail/ny", { method: "POST", cookie });
    const at = made.headers.get("location")!;
    expect(at).toMatch(/^\/arrangementer\/mail\/\d+$/);
    // Saga drafts from the chair's notes.
    expect((await call(`${at}/saga`, { method: "POST", cookie, body: form({ notes: "Julefest fredag den 11. december" }) })).headers.get("location")).toBe(`${at}?besked=skrevet`);
    let page = await (await call(at, { cookie })).text();
    expect(page).toContain('value="Julefest i Hjerterum"');
    expect(page).toContain("Send til 893 modtagere");
    expect(await (await call(`${at}/vis`, { cookie })).text()).toContain("Vi holder julefest.");
    // To the members only.
    await call(`${at}/gem`, { method: "POST", cookie, body: form({ subject: "Julefest i Hjerterum", preheader: "Fredag den 11. december", heading: "Julefest", body: "Kære ven\n\nVi holder julefest.", audience: "medlemmer" }) });
    expect(await (await call(at, { cookie })).text()).toContain("Send til 160 modtagere");
    // A test to one address.
    expect((await call(`${at}/test`, { method: "POST", cookie, body: form({ to: "jacob@example.dk" }) })).headers.get("location")).toContain("besked=proeve");
    expect(mc.find(c => c.path === "/campaigns" && c.method === "POST")!.body).toMatchObject({ recipients: { list_id: "0070dc72a9", segment_opts: { saved_segment_id: 77 } }, settings: { subject_line: "Julefest i Hjerterum" } });
    expect(mc.find(c => c.path === "/campaigns/camp1/actions/test")!.body).toEqual({ test_emails: ["jacob@example.dk"], send_type: "html" });
    expect(mc.filter(c => c.path === "/campaigns/camp1/actions/send")).toHaveLength(0);
    // Sent once; never twice.
    expect((await call(`${at}/send`, { method: "POST", cookie })).headers.get("location")).toBe(`${at}?besked=sendt`);
    expect(mc.filter(c => c.path === "/campaigns/camp1/actions/send")).toHaveLength(1);
    expect(mc.filter(c => c.path === "/campaigns" && c.method === "POST")).toHaveLength(1);
    expect((await call(`${at}/send`, { method: "POST", cookie })).headers.get("location")).toBe(`${at}?fejl=sendt`);
    expect(mc.filter(c => c.path === "/campaigns/camp1/actions/send")).toHaveLength(1);
    page = await (await call(at, { cookie })).text();
    expect(page).toContain("til 160 modtagere");
    expect(page).not.toContain(`action="${at}/send"`);
    expect(await db.prepare("SELECT status, sent_by, recipients FROM list_mails").first()).toEqual({ status: "sent", sent_by: "Jacob Hauge", recipients: 160 });
  });
});
