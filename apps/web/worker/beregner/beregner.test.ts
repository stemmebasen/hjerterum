import { describe, expect, it } from "vitest";
import { connectTeamMail, type ImapOpener } from "../saga/teamMail.js";
import { deps, fakeServices, sagaEnv, testDatabase } from "../saga/test-support.js";
import { handleCalculatorRequest, isCalculatorRequest } from "./handler.js";

// Requested: "Vi skal have implementeret denne prisberegner i systemet - den skal også bruges som iframe" - and the booking
// request: "her og nu skal der bare lande en e-mail med alle oplysningerne i vores fællesmail team@holistisk.org".
const NOW = Date.parse("2026-10-05T10:00:00Z");
const ORIGIN = "https://admin.hjerterum.info";
const env = () => sagaEnv(testDatabase(), { SAGA_TELEGRAM_WEBHOOK_SECRET: "webhook-secret-0123456789" });
const price = (e: ReturnType<typeof env>, body: unknown) => handleCalculatorRequest(new Request(`${ORIGIN}/beregner/api/pris`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), e, deps(fakeServices().fetcher, NOW));

function mailbox() {
  const appended: string[] = [];
  const opener: ImapOpener = async () => ({ async open() { return { uidValidity: "1", uidNext: 1 }; }, async search() { return []; }, async fetch() { return []; },
    async append(raw) { appended.push(new TextDecoder().decode(raw)); }, async close() { /* */ } });
  return { appended, opener };
}
const decode = (raw: string) => [...raw.matchAll(/Content-Transfer-Encoding: base64\r\n(?:[^\r\n]+\r\n)*\r\n([A-Za-z0-9+/=\r\n]+)/g)].map(m => { try { return new TextDecoder().decode(Uint8Array.from(atob(m[1]!.replace(/\s+/g, "")), c => c.charCodeAt(0))); } catch { return ""; } }).join("\n");

describe("the price calculator", () => {
  it("answers on /beregner and /ny-beregner-2026 on every address, may be framed by Hjerterum's sites, in Danish and English", async () => {
    expect(isCalculatorRequest(new URL(`${ORIGIN}/beregner`))).toBe(true);
    expect(isCalculatorRequest(new URL("https://hjerterum.info/ny-beregner-2026"))).toBe(true);
    expect(isCalculatorRequest(new URL("https://beregner.hjerterum.info/"))).toBe(true);
    expect(isCalculatorRequest(new URL(`${ORIGIN}/`))).toBe(false);
    const page = await handleCalculatorRequest(new Request(`${ORIGIN}/beregner`), env(), deps(fakeServices().fetcher, NOW));
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'self' https://holistisk.org https://*.holistisk.org");
    expect(page.headers.get("x-frame-options")).toBeNull();
    const html = await page.text();
    for (const text of ["Udregn pris og send bookingforespørgsel", "Start med at<br>vælge tidspunkt", "Standardpris", "Reduceret pris", "Gratis leje", "Priser og regler", "Beregn pris"]) expect(html).toContain(text);
    expect(html).toContain('<option value="1" selected>Mandag</option>');
    expect(html).toContain("<option selected>10:00</option>");
    const en = await (await handleCalculatorRequest(new Request(`${ORIGIN}/ny-beregner-2026?lang=en`), env(), deps(fakeServices().fetcher, NOW))).text();
    expect(en).toContain("Calculate the price and send a booking request");
  });

  it("prices standard, reduced (with the A-time campaign) and free rent, and refuses a reduced booking across 18:30", async () => {
    const e = env();
    expect(await (await price(e, { day: 1, start: "10:00", hours: 3, type: "standard" })).json()).toMatchObject({ totalKr: 1080, band: "B", end: "13:00" });
    expect(await (await price(e, { day: 2, start: "17:00", hours: 3, type: "standard" })).json()).toMatchObject({ totalKr: 1080 });
    expect(await (await price(e, { day: 1, start: "10:00", hours: 3, type: "reduced" })).json()).toMatchObject({ band: "B", baseKr: 225, discountKr: 0, totalKr: 225, nonMemberPriceKr: null });
    expect(await (await price(e, { day: 3, start: "19:00", hours: 3, type: "reduced", memberPrice: 500 })).json())
      .toMatchObject({ band: "A", baseKr: 550, discountPercent: 25, discountKr: 138, totalKr: 412, memberPriceKr: 500, nonMemberPriceKr: 625, memberAdvantageKr: 125 });
    expect(await (await price(e, { day: 6, start: "10:00", hours: 2, type: "free" })).json()).toMatchObject({ band: "A", totalKr: 0, minimumNonMemberKr: 75 });
    expect((await price(e, { day: 2, start: "17:00", hours: 3, type: "reduced" })).status).toBe(422);
    expect((await price(e, { day: 6, start: "17:00", hours: 3, type: "free" })).status).toBe(200);
    expect((await price(e, { day: 1, start: "10:15", hours: 2, type: "standard" })).status).toBe(400);
    expect((await price(e, { day: 1, start: "10:00", hours: 11, type: "standard" })).status).toBe(400);
  });

  it("lays the booking request in team@'s inbox with all details and the picture, answered to the sender", async () => {
    const e = env(), box = mailbox();
    await connectTeamMail(e, e.DB!, { address: "team@holistisk.org", password: "pw", by: "Jacob Hauge", nowMs: NOW }, box.opener);
    const form = (fields: Record<string, string>, started = NOW - 60_000) => {
      const f = new FormData();
      for (const [k, v] of Object.entries({ day: "3", start: "19:00", hours: "3", type: "reduced", memberPrice: "500", started: String(started), eventName: "Yin yoga", dates: "2026-10-21",
        description: "En rolig aften med yin yoga.", name: "Mette Holm", email: "mette@example.dk", phone: "12345678", links: "https://instagram.com/mette", signup: "Online via Hjerterum", payment: "MobilePay", ...fields })) f.append(k, v);
      return f;
    };
    const send = (f: FormData, ip = "1.2.3.4") => handleCalculatorRequest(new Request(`${ORIGIN}/beregner/foresporgsel`, { method: "POST", body: f, headers: { "cf-connecting-ip": ip } }), e, deps(fakeServices().fetcher, NOW), box.opener);

    expect(await (await send(form({ email: "ikke-en-mail" }))).json()).toMatchObject({ error: "missing_fields", fields: ["email"] });
    const f = form({});
    f.append("dates", "2026-10-28");
    f.append("image", new File([new Uint8Array([137, 80, 78, 71])], "forside.png", { type: "image/png" }));
    expect(await (await send(f)).json()).toEqual({ ok: true });
    expect(box.appended).toHaveLength(1);
    const raw = box.appended[0]!;
    expect(raw).toContain("To: Hjerterum <team@holistisk.org>");
    expect(raw).toContain("Reply-To: Mette Holm <mette@example.dk>");
    expect(raw).toMatch(/Subject: =\?UTF-8\?B\?/);
    expect(raw).toContain('filename="forside.png"');
    const body = decode(raw);
    for (const text of ["Yin yoga", "onsdag den 21. oktober 2026", "onsdag den 28. oktober 2026", "Onsdag kl. 19:00-22:00 (A-tid)", "Reduceret pris", "Kampagnerabat: 25 %: -138 kr.",
      "Lejepris i alt: 412 kr.", "Medlemspris pr. deltager: 500 kr.", "Ikke-medlemmer mindst: 625 kr.", "Mette Holm", "mette@example.dk", "https://instagram.com/mette", "En rolig aften med yin yoga."]) expect(body).toContain(text);

    // A robot filling the hidden field, or a form sent within seconds, gets a thank-you and nothing is laid in the inbox.
    expect(await (await send(form({ website: "spam" }))).json()).toEqual({ ok: true });
    expect(await (await send(form({}, NOW - 1000))).json()).toEqual({ ok: true });
    expect(box.appended).toHaveLength(1);
    // A few an hour from one address.
    for (let i = 0; i < 5; i++) expect((await send(form({}), "9.9.9.9")).status).toBe(200);
    expect((await send(form({}), "9.9.9.9")).status).toBe(429);
  });

  // Requested (the chair, 5 October 2026): the calculator's form checked often, without a request landing in team@.
  it("answers a probe with the same validation and price, opens the mailbox, and writes nothing", async () => {
    const e = env(), box = mailbox();
    await connectTeamMail(e, e.DB!, { address: "team@holistisk.org", password: "pw", by: "Jacob Hauge", nowMs: NOW }, box.opener);
    const form = (fields: Record<string, string> = {}) => {
      const f = new FormData();
      for (const [k, v] of Object.entries({ probe: "1", day: "3", start: "19:00", hours: "3", type: "reduced", memberPrice: "500", eventName: "Kontroltjek", dates: "2026-10-21",
        description: "Automatisk kontroltjek.", name: "Kontroltjek", email: "kontroltjek@example.dk", ...fields })) f.append(k, v);
      return f;
    };
    const send = (f: FormData, auth = "Bearer liva-secret") => handleCalculatorRequest(new Request(`${ORIGIN}/beregner/foresporgsel`, { method: "POST", body: f, headers: { authorization: auth } }), e, deps(fakeServices().fetcher, NOW), box.opener);
    expect((await send(form(), "Bearer wrong")).status).toBe(401);
    expect(await (await send(form({ email: "nej" }))).json()).toMatchObject({ error: "missing_fields", fields: ["email"] });
    const answer = await (await send(form())).json() as { ok: boolean; probe: boolean; totalKr: number };
    expect(answer).toMatchObject({ ok: true, probe: true });
    expect(answer.totalKr).toBeGreaterThan(0);
    expect(box.appended).toEqual([]);
    // Ten probes in a row are not "too many": the limit is for people.
    for (let i = 0; i < 6; i++) expect((await send(form())).status).toBe(200);
  });
  it("says so when team@ is not connected - nothing is lost silently", async () => {
    const e = env();
    const f = new FormData();
    for (const [k, v] of Object.entries({ day: "1", start: "10:00", hours: "2", type: "standard", started: String(NOW - 60_000), eventName: "X", dates: "2026-10-21", description: "Y", name: "Z", email: "z@example.dk" })) f.append(k, v);
    const response = await handleCalculatorRequest(new Request(`${ORIGIN}/beregner/foresporgsel`, { method: "POST", body: f }), e, deps(fakeServices().fetcher, NOW));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "not_delivered" });
  });
});
