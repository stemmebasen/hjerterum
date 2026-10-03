import { describe, expect, it } from "vitest";
import config from "./config-entry.js";
import { composeMail, handleLoginMail, svixSignature } from "./login-mail.js";

// Requested: "Ok, så lad os gøre med begge" - Clerk keeps the login, Resend sends its emails from Hjerterum's address.

const SECRET = "whsec_" + btoa("hjerterum-test-secret-0123456789");
const NOW = Date.parse("2026-10-03T22:00:00Z");
const ENV = { CLERK_WEBHOOK_SECRET: SECRET, RESEND_API_KEY: "re_test", RESEND_FROM_EMAIL: "Hjerterum <login@hjerterum.info>" };

const codeEmail = (extra: Record<string, unknown> = {}) => ({ type: "email.created", data: {
  slug: "verification_code", to_email_address: "medlem@example.dk", subject: "123456 is your verification code",
  body: "<p>Clerk's own</p>", body_plain: "Clerk's own", delivered_by_clerk: false, data: { otp_code: "123456" }, ...extra } });

async function signed(payload: unknown, options: { id?: string; at?: number; secret?: string } = {}) {
  const body = JSON.stringify(payload), id = options.id ?? "msg_1", timestamp = String(Math.floor((options.at ?? NOW) / 1000));
  const signature = await svixSignature(options.secret ?? SECRET, id, timestamp, body);
  return new Request("https://medlem.hjerterum.info/api/clerk/email", { method: "POST", body,
    headers: { "content-type": "application/json", "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` } });
}

function resend(status = 200) {
  const calls: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
  const fetcher = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ id: "email_1" }), { status });
  };
  return { calls, fetcher };
}

describe("login emails through Resend", () => {
  it("sends the login code from Hjerterum's address, in Danish, once per Clerk message", async () => {
    const { calls, fetcher } = resend();
    const response = await handleLoginMail(await signed(codeEmail(), { id: "msg_42" }), ENV, { fetcher, now: () => NOW });
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get("authorization")).toBe("Bearer re_test");
    expect(headers.get("idempotency-key")).toBe("clerk-email/msg_42");
    expect(calls[0]!.body).toMatchObject({ from: "Hjerterum <login@hjerterum.info>", to: ["medlem@example.dk"], subject: "123456 er din kode til Hjerterum" });
    expect(calls[0]!.body.text).toContain("Din kode til at logge ind hos Hjerterum er 123456.");
    expect(calls[0]!.body.html).toContain("123456");
    expect(calls[0]!.body.html).not.toContain("Clerk's own");
  });

  it("says what the code is for when it resets a password", () => {
    expect(composeMail({ slug: "reset_password_code", data: { otp_code: "654321" } })!.text).toContain("nulstille din adgangskode");
  });

  it("passes other emails on as Clerk wrote them", async () => {
    const { calls, fetcher } = resend();
    const invitation = { type: "email.created", data: { slug: "invitation", to_email_address: "ny@example.dk", subject: "Du er inviteret", body: "<p>Invitation</p>", body_plain: "Invitation", delivered_by_clerk: false } };
    expect((await handleLoginMail(await signed(invitation), ENV, { fetcher, now: () => NOW })).status).toBe(200);
    expect(calls[0]!.body).toMatchObject({ subject: "Du er inviteret", html: "<p>Invitation</p>", text: "Invitation" });
  });

  it("never sends an email twice: not one Clerk delivered itself, and not other events", async () => {
    const { calls, fetcher } = resend();
    expect((await handleLoginMail(await signed(codeEmail({ delivered_by_clerk: true })), ENV, { fetcher, now: () => NOW })).status).toBe(204);
    expect((await handleLoginMail(await signed({ type: "user.created", data: {} }), ENV, { fetcher, now: () => NOW })).status).toBe(204);
    expect(calls).toHaveLength(0);
  });

  it("refuses anything Clerk did not sign, or signed long ago", async () => {
    const { calls, fetcher } = resend();
    const other = "whsec_" + btoa("someone-else-entirely-0123456789");
    expect((await handleLoginMail(await signed(codeEmail(), { secret: other }), ENV, { fetcher, now: () => NOW })).status).toBe(401);
    expect((await handleLoginMail(await signed(codeEmail(), { at: NOW - 10 * 60_000 }), ENV, { fetcher, now: () => NOW })).status).toBe(401);
    const tampered = await signed(codeEmail());
    const forged = new Request(tampered.url, { method: "POST", headers: tampered.headers, body: JSON.stringify(codeEmail({ to_email_address: "angriber@example.com" })) });
    expect((await handleLoginMail(forged, ENV, { fetcher, now: () => NOW })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("answers with an error when it cannot send, so Clerk tries again", async () => {
    const failing = resend(403);
    expect((await handleLoginMail(await signed(codeEmail()), ENV, { fetcher: failing.fetcher, now: () => NOW })).status).toBe(502);
    const unset = resend();
    expect((await handleLoginMail(await signed(codeEmail()), { CLERK_WEBHOOK_SECRET: SECRET }, { fetcher: unset.fetcher, now: () => NOW })).status).toBe(503);
    expect(unset.calls).toHaveLength(0);
  });

  it("is reachable on the platform's addresses and closed until it is set up", async () => {
    const response = await config.fetch(new Request("https://medlem.hjerterum.info/api/clerk/email", { method: "POST", body: "{}" }), {} as never);
    expect(response.status).toBe(503);
    expect((await config.fetch(new Request("https://medlem.hjerterum.info/api/clerk/email"), { CLERK_WEBHOOK_SECRET: SECRET } as never)).status).toBe(405);
  });
});
