import type { D1Database } from "../db.js";
import { esc, layout } from "./page.js";
import { contactsByName, type TeacherRow } from "./teachers.js";

/** Requested: "Ja" to - after "Hvordan finder systemet ikke selv e-mails?" - looking through the mails to team@ and the member lists for
 * the mail and phone number of the teachers the system has no contact for, and letting the board accept each suggestion before it is saved.
 *
 * A teacher is matched by first and last name, ignoring capitals, accents (Karítas = Karitas, Søren = Soren) and middle initials (Karítas E. Langkjær =
 * Karitas Langkjær). That is looser than the exact name the contact lookup uses, so nothing found here is saved by itself: it is a suggestion,
 * with where it came from, and the board says Brug or Nej tak. Nothing is invented - every value is one that stands in the sender's address,
 * in the member lists or (a phone number) in the text of a mail that the teacher wrote. */

export type Suggestion = { key: string; name: string; kind: "mail" | "telefon"; value: string; from: string };

/** First and last name, lower-case, without accents and initials. Empty when there is no first and last name to compare. */
export const looseKey = (name: string): string => {
  const parts = name.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("da-DK").replace(/ø/g, "o").replace(/æ/g, "ae").replace(/ß/g, "ss").split(/[^\p{L}]+/u).filter(p => p.length > 1);
  return parts.length >= 2 ? `${parts[0]} ${parts[parts.length - 1]}` : "";
};

/** "Name <address>", "\"Name\" <address>" or a bare address -> name and address. */
const parseSender = (sender: string): { name: string; address: string | null } => {
  const address = /<([^>\s]+@[^>\s]+)>/.exec(sender)?.[1] ?? (/^\S+@\S+$/.test(sender.trim()) ? sender.trim() : null);
  return { name: sender.replace(/<[^>]*>/, "").replace(/"/g, "").trim(), address };
};

/** Danish numbers written in groups: +45 12 34 56 78, 12 34 56 78, 1234 5678, +4512345678. */
const PHONE = /(?<![\d+])(?:\+45[\s-]?|0045[\s-]?)?(?:\d{2}[\s.-]\d{2}[\s.-]\d{2}[\s.-]\d{2}|\d{4}[\s.-]\d{4})(?!\d)|\+45\d{8}(?!\d)/g;
export const phonesIn = (text: string): string[] => [...new Set([...text.matchAll(PHONE)].map(m => m[0].trim()))];

const WHEN = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", day: "numeric", month: "short", year: "numeric" });
const PER_KIND = 3;

/** Suggestions for the mail or phone number a teacher lacks (nothing known and nothing saved), newest source first. A teacher whose first and last name
 * another teacher shares is left out - it cannot be told whose mail it is. */
export async function contactSuggestions(db: D1Database, teachers: TeacherRow[]): Promise<Suggestion[]> {
  const sameName = new Map<string, TeacherRow[]>();
  for (const t of teachers) { const loose = looseKey(t.name); if (loose) sameName.set(loose, [...(sameName.get(loose) ?? []), t]); }
  const teacherFor = (name: string) => { const list = sameName.get(looseKey(name)); return list?.length === 1 ? list[0]! : null; };

  const [known, saved, mails, register, members, imported, declined] = await Promise.all([
    contactsByName(db),
    db.prepare("SELECT key, email, phone FROM cockpit_teachers").all<{ key: string; email: string | null; phone: string | null }>().then(r => r.results ?? []).catch(() => []),
    db.prepare("SELECT id, sender, subject, received_at_ms FROM board_mail ORDER BY received_at_ms DESC LIMIT 5000").all<{ id: number; sender: string; subject: string; received_at_ms: number }>().then(r => r.results ?? []).catch(() => []),
    db.prepare("SELECT name, email, phone FROM teachers").all<{ name: string; email: string | null; phone: string | null }>().then(r => r.results ?? []).catch(() => []),
    db.prepare("SELECT full_name AS name, email, phone FROM members").all<{ name: string; email: string | null; phone: string | null }>().then(r => r.results ?? []).catch(() => []),
    db.prepare("SELECT full_name AS name, normalized_email AS email FROM external_memberships").all<{ name: string; email: string | null }>().then(r => r.results ?? []).catch(() => []),
    db.prepare("SELECT key, kind, value FROM cockpit_teacher_declined").all<{ key: string; kind: string; value: string }>().then(r => r.results ?? []).catch(() => [])
  ]);
  const record = new Map(saved.map(r => [r.key, r]));
  const has = (t: TeacherRow, kind: Suggestion["kind"]) => (known.get(t.key) ?? []).some(c => c.kind === kind) || Boolean(kind === "mail" ? record.get(t.key)?.email : record.get(t.key)?.phone);
  const turnedDown = new Set(declined.map(d => `${d.key}|${d.kind}|${d.value.toLowerCase()}`));

  const found: Suggestion[] = [];
  const add = (t: TeacherRow | null, kind: Suggestion["kind"], value: string | null | undefined, from: string) => {
    const v = (value ?? "").trim();
    if (!t || !v || has(t, kind) || turnedDown.has(`${t.key}|${kind}|${v.toLowerCase()}`)) return;
    if (found.some(s => s.key === t.key && s.kind === kind && s.value.toLowerCase() === v.toLowerCase())) return;
    if (found.filter(s => s.key === t.key && s.kind === kind).length >= PER_KIND) return;
    found.push({ key: t.key, name: t.name, kind, value: v, from });
  };

  const fromTeacher: Array<{ id: number; t: TeacherRow; address: string | null; sender: string; subject: string; at: number }> = [];
  for (const m of mails) {
    const { name, address } = parseSender(m.sender), t = teacherFor(name);
    if (t) fromTeacher.push({ id: m.id, t, address, sender: name, subject: m.subject, at: m.received_at_ms });
  }
  for (const m of fromTeacher) add(m.t, "mail", m.address, `skrev til team@ den ${WHEN.format(m.at)} som »${m.sender}« (»${m.subject.slice(0, 60)}«)`);
  // A phone number only from the text of mails the teacher wrote - the newest few.
  const recent = fromTeacher.slice(0, 20);
  if (recent.length) {
    const previews = await db.prepare(`SELECT id, preview FROM board_mail WHERE id IN (${recent.map(() => "?").join(",")})`).bind(...recent.map(m => m.id))
      .all<{ id: number; preview: string }>().then(r => r.results ?? []).catch(() => []);
    const text = new Map(previews.map(p => [p.id, p.preview]));
    for (const m of recent) for (const phone of phonesIn(text.get(m.id) ?? "")) add(m.t, "telefon", phone, `står i mailen fra »${m.sender}« den ${WHEN.format(m.at)}`);
  }
  for (const r of register) { const t = teacherFor(r.name); add(t, "mail", r.email, `hjemmesidens underviserregister (»${r.name}«)`); add(t, "telefon", r.phone, `hjemmesidens underviserregister (»${r.name}«)`); }
  for (const m of members) { const t = teacherFor(m.name); add(t, "mail", m.email, `medlem på hjemmesiden (»${m.name}«)`); add(t, "telefon", m.phone, `medlem på hjemmesiden (»${m.name}«)`); }
  for (const m of imported) add(teacherFor(m.name), "mail", m.email, `medlem i MembershipWorks (»${m.name}«)`);
  return found.sort((a, b) => a.name.localeCompare(b.name, "da") || (a.kind === b.kind ? 0 : a.kind === "mail" ? -1 : 1));
}

/** The board says Brug: the value becomes the teacher's saved contact - only where nothing is saved yet. */
export async function acceptSuggestion(db: D1Database, teacher: { key: string; name: string }, kind: string, value: string, who: string, nowMs: number): Promise<boolean> {
  const v = value.trim().slice(0, 320);
  if (kind === "mail" ? !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v) : kind !== "telefon" || !v) return false;
  await db.prepare(`INSERT INTO cockpit_teachers (key, name, email, phone, updated_by, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET email = COALESCE(NULLIF(cockpit_teachers.email, ''), excluded.email), phone = COALESCE(NULLIF(cockpit_teachers.phone, ''), excluded.phone),
      updated_by = excluded.updated_by, updated_at_ms = excluded.updated_at_ms`)
    .bind(teacher.key, teacher.name.trim(), kind === "mail" ? v.toLowerCase() : null, kind === "telefon" ? v.slice(0, 40) : null, who, nowMs).run();
  return true;
}

/** The board says Nej tak: the same suggestion does not come back. */
export async function declineSuggestion(db: D1Database, key: string, kind: string, value: string, who: string, nowMs: number): Promise<boolean> {
  const v = value.trim().slice(0, 320);
  if ((kind !== "mail" && kind !== "telefon") || !v) return false;
  await db.prepare("INSERT OR IGNORE INTO cockpit_teacher_declined (key, kind, value, declined_by, declined_at_ms) VALUES (?, ?, ?, ?, ?)").bind(key, kind, v.toLowerCase(), who, nowMs).run();
  return true;
}

const STYLE = `
.sug{list-style:none;margin:0;padding:0;display:grid}.sug li{display:grid;grid-template-columns:1fr auto;gap:4px 14px;align-items:center;padding:12px 0;border-top:1px solid var(--line)}.sug li:first-child{border-top:0}
.sug .what{font-weight:600}.sug .why{grid-column:1;font-size:13px;color:var(--muted)}.sug .acts{grid-row:1/span 2;grid-column:2;display:flex;gap:8px}.sug form{margin:0}
@media(max-width:560px){.sug li{grid-template-columns:1fr}.sug .acts{grid-row:auto;grid-column:1}}`;

export function suggestionsPage(base: string, data: { suggestions: Suggestion[]; missing: number; notice: string; who: string | null }): string {
  const byTeacher = new Map<string, Suggestion[]>();
  for (const s of data.suggestions) byTeacher.set(s.key, [...(byTeacher.get(s.key) ?? []), s]);
  const button = (s: Suggestion, action: "accept" | "decline", label: string, cls = "") => `<form method="post" action="${base}/arrangementer/undervisere/forslag"><input type="hidden" name="key" value="${esc(s.key)}"><input type="hidden" name="kind" value="${s.kind}"><input type="hidden" name="value" value="${esc(s.value)}"><button name="action" value="${action}" class="${cls}">${label}</button></form>`;
  const cards = [...byTeacher.values()].map(list => `<div class="card"><h2><a href="${base}/arrangementer/undervisere/${encodeURIComponent(list[0]!.key)}">${esc(list[0]!.name)}</a></h2><ul class="sug">${list.map(s => `<li><span class="what">${s.kind === "mail" ? "Mail" : "Telefon"}: ${esc(s.value)}</span><span class="why">Fundet: ${esc(s.from)}</span><span class="acts">${button(s, "accept", "Brug")}${button(s, "decline", "Nej tak", "ghost")}</span></li>`).join("")}</ul></div>`).join("");
  return layout(base, "Forslag til kontakt", `<main><p class="small"><a href="${base}/arrangementer/undervisere">← Undervisere</a></p><h1>Forslag til kontakt</h1>
${data.notice ? `<p class="notice">${esc(data.notice)}</p>` : ""}
<p class="muted">Systemet har ledt efter den mail eller det telefonnummer, en underviser mangler, i mails til team@, hjemmesidens underviserregister og medlemslisterne. Det matcher på for- og efternavn og ser bort fra store bogstaver, accenter og mellemnavne - så intet gemmes, før I har sagt <strong>Brug</strong>. <strong>Nej tak</strong> betyder, at forslaget ikke kommer igen.</p>
${cards || `<div class="card"><p class="muted" style="margin:0">${data.missing ? `Ingen forslag lige nu. ${data.missing} undervisere mangler stadig al kontakt - de står ikke i mails til team@ eller medlemslisterne under samme for- og efternavn. Skriv kontakten ind på underviserens side, når I får den.` : "Ingen forslag lige nu - alle undervisere har en kontakt."}</p></div>`}</main>`,
  { section: "/arrangementer", who: data.who, style: STYLE });
}
