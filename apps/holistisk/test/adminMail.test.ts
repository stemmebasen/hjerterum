import { beforeAll, describe, expect, it } from "vitest";
import { handle } from "../src/index.js";
import { hideSecrets, sendMail, type EmailBinding } from "../src/mail.js";
import { importFromResend, kindFromSubject, resendTime } from "../src/adminMail.js";
import type { Env } from "../src/env.js";
import { testDb } from "./d1.js";

const NOW = Date.parse("2026-11-24T20:00:00Z");
const ORIGIN = "https://portal.example";
type Sent = { to: string; subject: string; text: string };
const sent: Sent[] = [];
const binding: EmailBinding = { send: async m => { sent.push({ to: m.to, subject: m.subject, text: m.text }); return {}; } };
let env: Env;
let db: ReturnType<typeof testDb>;
let cookie = "";

type Res = { status: number; body: string; headers: Headers };
async function call(path: string, init: { form?: Record<string, string>; cookie?: string } = {}, now = NOW): Promise<Res> {
  const headers: Record<string, string> = {};
  if (init.cookie) headers.cookie = init.cookie;
  if (init.form) { headers.origin = ORIGIN; headers["content-type"] = "application/x-www-form-urlencoded"; }
  const r = await handle(new Request(ORIGIN + path, { method: init.form ? "POST" : "GET", headers, body: init.form ? new URLSearchParams(init.form) : null }), env, now);
  return { status: r.status, body: await r.text(), headers: r.headers };
}
const rows = () => db.raw.prepare("SELECT * FROM sent_mails ORDER BY created_at").all() as Array<Record<string, unknown>>;

beforeAll(async () => {
  db = testDb();
  env = { DB: db, ENVIRONMENT: "staging", ACTIVE_REGIONS: "ostjylland", EDITION: "portal", EMAIL: binding, ADMIN_EMAIL: "chef@example.dk" };
  await call("/admin/log-ind", { form: {} });
  const token = /\/admin\/link\?t=([A-Za-z0-9_-]+)/.exec(sent[0]!.text)![1]!;
  const used = await call("/admin/link", { form: { t: token } });
  cookie = /sk_admin=[^;]+/.exec(used.headers.get("set-cookie") ?? "")![0];
});

describe("Sendt post", () => {
  it("keeps every mail the site sends, with the login link hidden", async () => {
    const kept = rows();
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ kind: "login", to_email: "chef@example.dk", subject: "Log ind på Socialklubbens overblik", status: "sent", source: "app" });
    expect(String(kept[0]!.text)).toContain("/admin/link?t=skjult");
    expect(String(kept[0]!.html)).not.toMatch(/t=[A-Za-z0-9_-]{20,}/);
    expect(hideSecrets("https://x.dk/log-ind/link?t=abcdefghijklmnopqrstuvwxyz0123")).toBe("https://x.dk/log-ind/link?t=skjult");
  });

  it("keeps the contact form's mail and any other mail, also a failed one", async () => {
    const r = await call("/kontakt", { form: { emne: "andet", navn: "Mette", email: "mette@example.dk", besked: "Hej, jeg vil gerne høre mere om jer.", t: String(NOW - 60_000) } });
    expect(r.status).toBeLessThan(400);
    await sendMail({ ...env, EMAIL: { send: async () => { throw new Error("nede"); } } }, { to: "a@example.dk", subject: "Ny slags mail", text: "tekst", html: "<p>hej</p>", kind: "informationsmoede" }, fetch, NOW + 1000);
    const kinds = rows().map(m => `${m.kind}:${m.status}`);
    expect(kinds).toContain("informationsmoede:failed");
    expect(rows().some(m => m.kind === "kontakt" && m.reply_to === "mette@example.dk")).toBe(true);
  });

  it("is closed to everyone but the admin", async () => {
    const r = await call("/admin/post");
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/admin");
    const id = String(rows()[0]!.id);
    expect((await call(`/admin/post/${id}/vis`)).status).toBe(303);
  });

  it("lists the mails newest first, filters by kind and searches", async () => {
    const r = await call("/admin/post", { cookie });
    expect(r.status).toBe(200);
    expect(r.body).toContain("Sendt post");
    expect(r.body).toContain("Til chef@example.dk");
    expect(r.body).toContain("Ny slags mail");
    expect(r.body).toContain("Fejlede");
    expect(r.body.indexOf("Ny slags mail")).toBeLessThan(r.body.indexOf("Log ind på Socialklubbens overblik"));
    const login = await call("/admin/post?type=login", { cookie });
    expect(login.body).toContain("Log ind på Socialklubbens overblik");
    expect(login.body).not.toContain("Ny slags mail");
    const search = await call("/admin/post?q=mette", { cookie });
    expect(search.body).toContain("1 mail fundet");
    expect((await call("/admin", { cookie })).body).toContain('href="/admin/post"');
  });

  it("opens one mail, with its own HTML in a locked-down frame", async () => {
    const id = String(rows().find(m => m.kind === "login")!.id);
    const page = await call(`/admin/post/${id}`, { cookie });
    expect(page.status).toBe(200);
    expect(page.body).toContain(`src="/admin/post/${id}/vis"`);
    expect(page.body).toContain("sandbox=");
    expect(page.body).toContain("Tekstudgaven");
    const frame = await call(`/admin/post/${id}/vis`, { cookie });
    expect(frame.status).toBe(200);
    expect(frame.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(frame.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
    expect(frame.body).toContain('<base target="_blank">');
    expect(frame.body).toContain("Åbn overblikket");
    expect((await call("/admin/post/not-an-id", { cookie })).status).toBe(404);
  });

  it("fetches older mails from Resend once, skipping those it already has", async () => {
    const known = "11111111-aaaa-bbbb-cccc-000000000001";
    db.raw.prepare("UPDATE sent_mails SET provider_id = ? WHERE kind = 'kontakt'").run(known);
    let calls = 0;
    const fetcher = (async (input: string | URL | Request) => {
      calls++;
      const url = String(input);
      if (url.startsWith("https://api.resend.com/emails?")) return Response.json({ object: "list", has_more: false, data: [
        { id: known, to: ["mette@example.dk"], subject: "Kontakt: Mette", created_at: "2026-11-20 10:00:00.123456+00", last_event: "delivered" },
        { id: "22222222-aaaa-bbbb-cccc-000000000002", to: ["lone@example.dk"], subject: "Dit login-link til Socialklubben", created_at: "2026-11-18 09:30:00.5+00", last_event: "delivered" },
        { id: "33333333-aaaa-bbbb-cccc-000000000003", to: ["bo@example.dk"], subject: "Velkommen til Socialklubben", created_at: "2026-11-19 08:00:00+00", last_event: "bounced" }
      ] });
      const id = url.split("/").pop();
      return Response.json({ id, html: `<p>Log ind: <a href="https://socialklubben.dk/log-ind/link?t=abcdefghijklmnopqrstuvwxyz012345">her</a></p>`, text: "Log ind" });
    }) as typeof fetch;
    const before = rows().length;
    expect(await importFromResend(db, { ...env, RESEND_API_KEY: "re_test" }, fetcher)).toEqual({ added: 2, more: false });
    expect(calls).toBe(3);
    const imported = rows().filter(m => m.source === "resend");
    expect(imported).toHaveLength(2);
    expect(rows()).toHaveLength(before + 2);
    const lone = imported.find(m => m.to_email === "lone@example.dk")!;
    expect(lone).toMatchObject({ kind: "login", status: "sent", created_at: Date.parse("2026-11-18T09:30:00.500Z") });
    expect(String(lone.html)).toContain("t=skjult");
    expect(imported.find(m => m.to_email === "bo@example.dk")).toMatchObject({ status: "failed", error: "Resend: bounced" });
    expect(await importFromResend(db, { ...env, RESEND_API_KEY: "re_test" }, fetcher)).toEqual({ added: 0, more: false });
  });

  it("explains a Resend key that may only send", async () => {
    const r = await importFromResend(db, { ...env, RESEND_API_KEY: "re_test" }, (async () => new Response("{}", { status: 401 })) as typeof fetch);
    expect("error" in r && r.error).toContain("fuld adgang");
  });

  it("reads Resend's times and guesses old mails' kinds", () => {
    expect(resendTime("2026-11-20 18:04:11.123456+00")).toBe(Date.parse("2026-11-20T18:04:11.123Z"));
    expect(resendTime("nonsense")).toBeNull();
    expect(kindFromSubject("Arrangør: Dokk1")).toBe("kontakt");
    expect(kindFromSubject("Noget helt andet")).toBe("anden");
  });
});
