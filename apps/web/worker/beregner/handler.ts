import type { D1Database } from "../db.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { deliverToTeamInbox, type ImapOpener } from "../saga/teamMail.js";
import { buildMime } from "./mime.js";
import { calculatorPage, type Lang } from "./page.js";
import { calculate, crossesBand, DAYS_DA, parseCalcInput, type CalcResult } from "./quote.js";

/** Requested: "Vi skal have implementeret denne prisberegner i systemet - den skal også bruges som iframe" (the blueprint
 * "Hjerterums prisberegner"). The calculator answers on /beregner and /ny-beregner-2026 on every address the platform has
 * (and on / of a beregner.* address); it may be framed by Hjerterum's own sites. The booking request: "her og nu skal der
 * bare lande en e-mail med alle oplysningerne i vores fællesmail team@holistisk.org" - laid straight into team@'s inbox. */

const PAGES = new Set(["/beregner", "/beregner/", "/ny-beregner-2026", "/ny-beregner-2026/"]);
export const isCalculatorRequest = (url: URL) => /^beregner\./i.test(url.hostname) ? true
  : PAGES.has(url.pathname) || url.pathname.startsWith("/beregner/");

const FRAME = "frame-ancestors 'self' https://holistisk.org https://*.holistisk.org https://hjerterum.info https://*.hjerterum.info";
const headers = (type: string) => ({ "content-type": type, "cache-control": "no-store", "content-security-policy": FRAME, "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin" });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: headers("application/json; charset=utf-8") });

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const PER_HOUR = 5;
const MIN_FILL_MS = 4_000;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export type BookingRequest = {
  eventName: string; dates: string[]; maxParticipants: string; payment: string; description: string; notes: string; signup: string;
  name: string; email: string; phone: string; links: string;
};

async function sha(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** A few requests an hour from one address; the website's enquiry forms share it with their own scope (worker/enquiries.ts). */
export async function tooMany(db: D1Database, request: Request, nowMs: number, scope = "beregner"): Promise<boolean> {
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown";
  const hash = await sha(`${scope}:${ip}`);
  const row = await db.prepare("SELECT COUNT(*) AS n FROM calculator_requests WHERE ip_hash = ? AND at_ms > ?").bind(hash, nowMs - 3_600_000).first<{ n: number }>().catch(() => null);
  if ((row?.n ?? 0) >= PER_HOUR) return true;
  await db.prepare("INSERT INTO calculator_requests (ip_hash, at_ms) VALUES (?, ?)").bind(hash, nowMs).run().catch(() => undefined);
  await db.prepare("DELETE FROM calculator_requests WHERE at_ms < ?").bind(nowMs - 86_400_000).run().catch(() => undefined);
  return false;
}

const kr = (n: number | null) => n === null ? "-" : `${n.toLocaleString("da-DK")} kr.`;
const TYPE_DA: Record<string, string> = { standard: "Standardpris", reduced: "Reduceret pris", free: "Gratis leje" };
const hoursDa = (h: number) => `${String(h).replace(".", ",")} timer`;
const escHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const dayDa = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`)) : iso;

/** The mail's lines: what Hjerterum needs to answer the request, in the order it is read. */
export function bookingLines(req: BookingRequest, calc: CalcResult): Array<[string, string]> {
  const price: Array<[string, string]> = calc.type === "standard"
    ? [["Lejepris (pakkepris)", kr(calc.totalKr)], ["Vises på Hjerterums hjemmeside og SoMe", "Inkluderet"]]
    : calc.type === "reduced"
      ? [["Leje", `${kr(calc.firstTwoKr)} for de første 2 timer${calc.extraHours ? ` + ${String(calc.extraHours).replace(".", ",")} × ${kr(calc.extraRateKr)}` : ""} = ${kr(calc.baseKr)}`],
        ...(calc.discountKr ? [["Kampagnerabat", `${calc.discountPercent} %: -${kr(calc.discountKr)}`] as [string, string]] : []),
        ["Lejepris i alt", kr(calc.totalKr)], ["Medlemspris pr. deltager", kr(calc.memberPriceKr)], ["Ikke-medlemmer mindst", kr(calc.nonMemberPriceKr)],
        ["Vises på Hjerterums hjemmeside og SoMe", "Inkluderet"]]
      : [["Lejepris", "0 kr. (gratis leje - kun for betalende medlemmer)"], ["Medlemmer", "Deltager gratis"], ["Ikke-medlemmer mindst", kr(calc.minimumNonMemberKr)],
        ["Deltagerbetaling", "Opkræves af underviseren selv"]];
  return [
    ["Event", req.eventName], ["Datoer", req.dates.map(dayDa).join(", ")],
    ["Tidspunkt", `${DAYS_DA[calc.day]} kl. ${calc.start}-${calc.end} (${calc.band}-tid${calc.weekend ? ", weekend" : ""})`], ["Antal timer", hoursDa(calc.hours)],
    ["Bookingtype", TYPE_DA[calc.type] ?? calc.type], ...price,
    ["Maks. deltagere", req.maxParticipants || "-"], ["Betaling", req.payment || "-"], ["Tilmelding", req.signup || "-"],
    ["Navn", req.name], ["E-mail", req.email], ["Telefon", req.phone || "-"], ["Links", req.links || "-"],
    ["Beskrivelse", req.description], ["Bemærkninger", req.notes || "-"],
  ];
}

export function bookingMail(req: BookingRequest, calc: CalcResult, to: string, image: { filename: string; contentType: string; bytes: Uint8Array } | null, now: Date): Uint8Array {
  const lines = bookingLines(req, calc);
  const text = `Bookingforespørgsel fra prisberegneren\n\n${lines.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${image ? "Forsidebilledet er vedhæftet.\n" : ""}Svar direkte på denne mail for at svare ${req.name}.`;
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#16202e">
<p><strong>Bookingforespørgsel fra prisberegneren</strong></p><table cellpadding="6" style="border-collapse:collapse">${lines.map(([k, v]) =>
  `<tr><td style="vertical-align:top;color:#5a6675;white-space:nowrap">${escHtml(k)}</td><td style="vertical-align:top;white-space:pre-wrap">${escHtml(v)}</td></tr>`).join("")}</table>
<p style="color:#5a6675">${image ? "Forsidebilledet er vedhæftet. " : ""}Svar direkte på denne mail for at svare ${escHtml(req.name)}.</p></body></html>`;
  const dates = req.dates.length > 1 ? `${req.dates.length} datoer` : dayDa(req.dates[0] ?? "");
  return buildMime({ from: { name: `${req.name} via prisberegneren`, address: to }, to: { name: "Hjerterum", address: to }, replyTo: { name: req.name, address: req.email },
    subject: `Bookingforespørgsel: ${req.eventName} (${dates})`, text, html, attachments: image ? [image] : [], date: now, messageId: `${crypto.randomUUID()}@beregner.hjerterum.info` });
}

const field = (form: FormData, name: string, max: number) => String(form.get(name) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);

export async function handleCalculatorRequest(request: Request, env: SagaEnv, deps: SagaDeps, opener?: ImapOpener): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const lang: Lang = url.searchParams.get("lang") === "en" ? "en" : "da";

  if (path === "/beregner/api/pris" && request.method === "POST") {
    const input = parseCalcInput(await request.json().catch(() => ({})) as Record<string, unknown>);
    if (!input) return json({ error: "invalid_input" }, 400);
    if (crossesBand(input)) return json({ error: "crosses_1830" }, 422);
    return json(calculate(input));
  }

  if (path === "/beregner/foresporgsel" && request.method === "POST") {
    if (!env.DB) return json({ error: "unavailable" }, 503);
    const form = await request.formData().catch(() => null);
    if (!form) return json({ error: "invalid_form" }, 400);
    // A form filled by a person: the hidden field stays empty, and it takes a few seconds.
    const started = Number(form.get("started"));
    if (field(form, "website", 200) || !Number.isFinite(started) || deps.now() - started < MIN_FILL_MS) return json({ ok: true });
    const input = parseCalcInput(Object.fromEntries(["day", "start", "hours", "type", "memberPrice"].map(k => [k, form.get(k)])));
    if (!input || crossesBand(input)) return json({ error: "invalid_calculation" }, 400);
    const req: BookingRequest = {
      eventName: field(form, "eventName", 160), dates: form.getAll("dates").map(d => String(d)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 30),
      maxParticipants: field(form, "maxParticipants", 10), payment: field(form, "payment", 120), description: field(form, "description", 5000),
      notes: field(form, "notes", 3000), signup: field(form, "signup", 160), name: field(form, "name", 120), email: field(form, "email", 200).toLowerCase(),
      phone: field(form, "phone", 40), links: field(form, "links", 1500),
    };
    const missing = [!req.eventName && "eventName", !req.dates.length && "dates", !req.description && "description", !req.name && "name", !EMAIL.test(req.email) && "email"].filter(Boolean);
    if (missing.length) return json({ error: "missing_fields", fields: missing }, 400);
    const file = form.get("image");
    let image: { filename: string; contentType: string; bytes: Uint8Array } | null = null;
    if (file && typeof file === "object" && "arrayBuffer" in file && (file as File).size > 0) {
      const f = file as File;
      if (f.size > MAX_IMAGE_BYTES) return json({ error: "image_too_large" }, 413);
      if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type)) return json({ error: "image_type" }, 415);
      image = { filename: f.name || "forsidebillede", contentType: f.type, bytes: new Uint8Array(await f.arrayBuffer()) };
    }
    if (await tooMany(env.DB, request, deps.now())) return json({ error: "too_many" }, 429);
    try {
      const calc = calculate(input);
      await deliverToTeamInbox(env, env.DB, bookingMail(req, calc, "team@holistisk.org", image, new Date(deps.now())), opener);
      return json({ ok: true });
    } catch (error) {
      console.warn("calculator_request_failed", error instanceof Error ? error.message : error);
      return json({ error: "not_delivered" }, 503);
    }
  }

  if (request.method === "GET" && (PAGES.has(url.pathname) || (/^beregner\./i.test(url.hostname) && path === "/"))) {
    return new Response(calculatorPage(lang, deps.now()), { headers: headers("text/html; charset=utf-8") });
  }
  return new Response("Not found", { status: 404, headers: headers("text/plain; charset=utf-8") });
}
