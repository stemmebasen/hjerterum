import type { SagaDeps, SagaEnv } from "./saga/env.js";
import { deliverToTeamInbox, type ImapOpener } from "./saga/teamMail.js";
import { buildMime } from "./beregner/mime.js";
import { tooMany } from "./beregner/handler.js";
import { countedPath } from "./site-stats.js";
import { ENQUIRY_HONEYPOT, ENQUIRY_LIMITS, ENQUIRY_MIN_FILL_MS, ENQUIRY_PATH, enquiryTopic, type EnquiryTopic } from "../site/enquiries.js";

/** Requested: "Hjerterum skal dog have flere henvendelsesformularer ligesom på stemmebasen.dk" (site/enquiries.ts). An
 * enquiry from the website is laid straight into team@'s inbox, as the price calculator's booking requests are, so it
 * waits in Posthus with the others and is answered to the sender. The website keeps nothing of it but the day, the topic
 * and the page, for the statistics (tracksEnquiries). */

export { ENQUIRY_PATH };
export const TEAM_ADDRESS = "team@holistisk.org";
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
const copenhagenDay = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(ms);
const text = (value: unknown, max: number) => typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim().slice(0, max) : "";
const line = (value: string) => value.replace(/\s+/g, " ");
const escHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type Enquiry = { topic: EnquiryTopic; name: string; email: string; phone: string; detail: string; message: string; callback: boolean; path: string; lang: "da" | "en" };

/** What a person sent, or the fields that are missing. */
export function readEnquiry(sent: Record<string, unknown>): { enquiry: Enquiry } | { missing: string[] } {
  const topic = enquiryTopic(text(sent.topic, 40));
  const enquiry: Enquiry = {
    topic: topic?.key ?? "generel", name: line(text(sent.name, ENQUIRY_LIMITS.name)), email: text(sent.email, ENQUIRY_LIMITS.email).toLowerCase(),
    phone: line(text(sent.phone, ENQUIRY_LIMITS.phone)), detail: topic?.detail ? line(text(sent.detail, ENQUIRY_LIMITS.detail)) : "",
    message: text(sent.message, ENQUIRY_LIMITS.message), callback: sent.callback === true, path: countedPath(sent.path) ?? "/", lang: sent.lang === "en" ? "en" : "da"
  };
  const missing = [!topic && "topic", !enquiry.name && "name", !EMAIL.test(enquiry.email) && "email", !enquiry.message && "message",
    enquiry.callback && !/\d{6,}/.test(enquiry.phone.replace(/\D/g, "")) && "phone"].filter((field): field is string => Boolean(field));
  return missing.length ? { missing } : { enquiry };
}

/** The mail's lines, in the order the team reads them. */
export function enquiryLines(enquiry: Enquiry, site: string): Array<[string, string]> {
  const topic = enquiryTopic(enquiry.topic)!;
  return [
    ["Emne", topic.label.da], ["Navn", enquiry.name], ["E-mail", enquiry.email], ["Telefon", enquiry.phone || "-"],
    ...(enquiry.callback ? [["Ring op", "Ja, vil gerne ringes op"] as [string, string]] : []),
    ...(topic.detail ? [[topic.detail.da, enquiry.detail || "-"] as [string, string]] : []),
    ["Sendt fra", `${site}${enquiry.path}${enquiry.lang === "en" ? " (engelsk)" : ""}`], ["Besked", enquiry.message]
  ];
}

export function enquiryMail(enquiry: Enquiry, site: string, now: Date): Uint8Array {
  const topic = enquiryTopic(enquiry.topic)!;
  const lines = enquiryLines(enquiry, site);
  const plain = `${topic.label.da} fra hjemmesiden\n\n${lines.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nSvar direkte på denne mail for at svare ${enquiry.name}.`;
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#2a2622">
<p><strong>${escHtml(topic.label.da)} fra hjemmesiden</strong></p><table cellpadding="6" style="border-collapse:collapse">${lines.map(([k, v]) =>
  `<tr><td style="vertical-align:top;color:#766d64;white-space:nowrap">${escHtml(k)}</td><td style="vertical-align:top;white-space:pre-wrap">${escHtml(v)}</td></tr>`).join("")}</table>
<p style="color:#766d64">Svar direkte på denne mail for at svare ${escHtml(enquiry.name)}.</p></body></html>`;
  return buildMime({ from: { name: `${enquiry.name} via hjemmesiden`, address: TEAM_ADDRESS }, to: { name: "Hjerterum", address: TEAM_ADDRESS },
    replyTo: { name: enquiry.name, address: enquiry.email }, subject: `${topic.label.da}: ${enquiry.name}`, text: plain, html, attachments: [], date: now,
    messageId: `${crypto.randomUUID()}@hjemmeside.hjerterum.info` });
}

/** POST /api/henvendelse from the website's forms (JSON). */
export async function handleEnquiry(request: Request, env: SagaEnv, deps: SagaDeps, opener?: ImapOpener): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (request.headers.get("origin") !== url.origin) return json({ error: "forbidden" }, 403);
  if (!env.DB) return json({ error: "unavailable" }, 503);
  const body = await request.text().catch(() => "");
  if (!body || body.length > 20_000) return json({ error: "invalid_form" }, 400);
  let sent: Record<string, unknown>;
  try { sent = JSON.parse(body) as Record<string, unknown>; } catch { return json({ error: "invalid_form" }, 400); }
  // A form filled by a person: the hidden field stays empty, and it takes a few seconds. A robot is told all went well.
  const started = Number(sent.started);
  if (text(sent[ENQUIRY_HONEYPOT], 200) || !Number.isFinite(started) || deps.now() - started < ENQUIRY_MIN_FILL_MS) return json({ ok: true });
  const read = readEnquiry(sent);
  if ("missing" in read) return json({ error: "missing_fields", fields: read.missing }, 400);
  const { enquiry } = read;
  if (await tooMany(env.DB, request, deps.now(), "henvendelse")) return json({ error: "too_many" }, 429);
  try {
    await deliverToTeamInbox(env, env.DB, enquiryMail(enquiry, url.origin, new Date(deps.now())), opener);
  } catch (error) {
    console.warn("enquiry_not_delivered", error instanceof Error ? error.message : error);
    return json({ error: "not_delivered" }, 503);
  }
  await env.DB.prepare("INSERT INTO site_enquiries (day, at_ms, topic, path) VALUES (?, ?, ?, ?)").bind(copenhagenDay(deps.now()), deps.now(), enquiry.topic, enquiry.path).run()
    .catch(error => console.warn("enquiry_count_failed", error instanceof Error ? error.message : error));
  return json({ ok: true });
}
