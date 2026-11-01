import type { D1Database } from "./db.js";
import { isPartnerEvent } from "../partner-events.js";
import { membershipWorksListUrl, parseMembershipWorksList, type MembershipWorksList } from "./external-events.js";
import { completeAs } from "./saga/ai.js";
import type { SagaDeps, SagaEnv } from "./saga/env.js";
import { designUrl } from "./event-designs.js";

/** Requested (the chair, 1 Nov 2026, with the November mail as a PDF): "this is how the newsletter should be designed and compiled
 * each month, sent out on the first". The monthly mail "Månedens events":
 * - a header (three of the month's pictures beside "<Måned> i Hjerterum · Månedens events"), a short greeting from Hjerterum,
 * - "Fremhævet i <måned>": two or three events Saga picks and writes about, each with its picture,
 * - "Resten af <måned>": every event in the house that month, week by week, the morning programme marked "Mornings",
 * - "Se alle events her", the Mornings banner and Mailchimp's footer.
 * From the 20th Saga writes next month's issue as a draft; the board reads it, may change the words, and approves it under
 * Events → Nyhedsbrev. An approved issue is sent through Mailchimp on the 1st at 19.00 to those who chose "Månedens events".
 * Nothing is sent without that approval - Saga never sends mail of her own accord. The list is read from the calendar when the
 * issue is shown or sent, so an event added after the draft is still in it. */

const TZ = "Europe/Copenhagen";
export const SITE = "https://www.hjerterum.info";
export const SEND_HOUR = 19;
export const DRAFT_FROM_DAY = 20;
const MONTHS = ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober", "november", "december"];
const DAYS = ["SØN.", "MAN.", "TIRS.", "ONS.", "TORS.", "FRE.", "LØR."];

export type NewsletterEvent = { key: string; title: string; startsMs: number; endsMs: number | null; host: string | null; category: string | null;
  imageUrl: string | null; link: string; description: string; mornings: boolean };
export type Highlight = { heading: string; byline: string; text: string; image: string | null; link: string };
export type Issue = { month: string; subject: string; preheader: string; intro: string; highlights: Highlight[]; titles: Record<string, string>;
  status: "draft" | "approved" | "sent" | "failed"; approved_by: string | null; approved_at_ms: number | null; campaign_id: string | null;
  sent_at_ms: number | null; error: string | null; created_at_ms: number; updated_at_ms: number };

// ---- Time ----

const parts = (ms: number) => Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false })
  .formatToParts(ms).map(p => [p.type, p.value])) as Record<string, string>;
/** "2026-12" for the month a moment lies in (Danish time). */
export const monthOf = (ms: number) => { const p = parts(ms); return `${p.year}-${p.month}`; };
export const nextMonth = (month: string) => { const [y, m] = month.split("-").map(Number) as [number, number]; return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };
export const monthName = (month: string) => MONTHS[Number(month.slice(5)) - 1]!;
export const Cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** The first moment of a month in Danish time, as ms (the offset is +1 or +2). */
export function monthStart(month: string): number {
  for (const offset of [1, 2]) {
    const ms = Date.parse(`${month}-01T00:00:00+0${offset}:00`);
    const p = parts(ms);
    if (p.day === "01" && p.hour === "00") return ms;
  }
  return Date.parse(`${month}-01T00:00:00Z`);
}
/** The moment the month's issue goes out: the 1st at 19.00 Danish time. */
export const sendTime = (month: string) => monthStart(month) + SEND_HOUR * 3_600_000;

const clock = (ms: number) => { const p = parts(ms); return `${Number(p.hour)}.${p.minute}`; };
const dayMonth = (ms: number) => { const p = parts(ms); return `${Number(p.day)}/${Number(p.month)}`; };
/** "SØN. 1/11 · 9.00" */
export const dateLabel = (ms: number) => `${DAYS[new Date(Date.parse(`${parts(ms).year}-${parts(ms).month}-${parts(ms).day}T12:00:00Z`)).getUTCDay()]} ${dayMonth(ms)} · ${clock(ms)}`;
/** The ISO week number of a moment's Danish date. */
export function isoWeek(ms: number): number {
  const p = parts(ms);
  const d = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

// ---- The month's events ----

const absolute = (url: string | null) => !url ? null : url.startsWith("/") ? SITE + url : url;
const plain = (html: string | null) => (html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
/** Hjerterum Mornings: the house's own morning programme, said so in its title or text. */
const isMornings = (title: string, description: string) => /\bmornings\b/i.test(`${title} ${description}`);

/** Every event in the house that month: the calendar's (not the partner houses') and the members' approved ones (not CIRKLER's meetings).
 * The calendar is read as the website reads it: MembershipWorks' list for the month (it has events the RSS feed and so house_events
 * lack - "Fri morgendans", "Fællesspisning", a talk), with the text and teacher from house_events, or else from the event's own page. */
export async function monthEvents(db: D1Database, month: string, fetcher?: typeof fetch): Promise<NewsletterEvent[]> {
  const from = monthStart(month), to = monthStart(nextMonth(month));
  type Row = { id: string; title: string; starts_at_ms: number; ends_at_ms: number | null; host: string | null; category: string | null; location: string | null; image_url: string | null; link: string | null; description: string | null };
  const stored = await db.prepare(`SELECT id, title, starts_at_ms, ends_at_ms, host, category, location, image_url, link, description FROM house_events
      WHERE starts_at_ms >= ? AND starts_at_ms < ? AND removed_at_ms IS NULL ORDER BY starts_at_ms`).bind(from, to).all<Row>().then(r => r.results ?? []).catch(() => [] as Row[]);
  const listed = fetcher ? await fetcher(membershipWorksListUrl(from, to), { headers: { accept: "application/json" } })
    .then(async r => r.ok ? parseMembershipWorksList(await r.json() as MembershipWorksList) : []).catch(() => []) : [];
  const byId = new Map(stored.map(r => [r.id, r] as const));
  // Without the list (MembershipWorks not answering), the stored calendar.
  const calendar: Row[] = listed.length ? listed.filter(e => Date.parse(e.startsAt) >= from && Date.parse(e.startsAt) < to).map(e => {
    const known = byId.get(e.id);
    return { id: e.id, title: e.title, starts_at_ms: Date.parse(e.startsAt), ends_at_ms: e.endsAt ? Date.parse(e.endsAt) : null, host: known?.host ?? null, category: e.category ?? known?.category ?? null,
      location: known?.location ?? null, image_url: known?.image_url ?? e.imageUrl, link: e.link ?? known?.link ?? null, description: known?.description ?? null };
  }) : stored;
  // The text of an event only the list has, from its own page (a few at a time).
  const missing = calendar.filter(r => !r.description && /^SF[0-9a-f]{24}$/.test(r.id)).slice(0, 40);
  if (fetcher) for (let i = 0; i < missing.length; i += 8) await Promise.all(missing.slice(i, i + 8).map(async r => {
    r.description = await fetcher(`https://api.membershipworks.com/v2/event?eid=${r.id.slice(2)}&org=22308`, { headers: { accept: "application/json" } })
      .then(async res => res.ok ? ((await res.json()) as { dtl?: string }).dtl ?? null : null).catch(() => null);
  }));
  const house = calendar.filter(e => !isPartnerEvent(e));
  const own = await db.prepare(`SELECT b.id, b.title, b.teacher_name, b.description, b.starts_at_ms, b.ends_at_ms,
      (SELECT f.id FROM room_booking_files f WHERE f.room_booking_id = b.id AND f.kind = 'cover' LIMIT 1) AS cover_id,
      (SELECT d.created_at_ms FROM room_booking_designs d WHERE d.room_booking_id = b.id) AS design_at
    FROM room_bookings b WHERE b.status = 'scheduled' AND COALESCE(b.review_status, 'approved') = 'approved' AND b.cirkler_meeting_id IS NULL
      AND b.starts_at_ms >= ? AND b.starts_at_ms < ? ORDER BY b.starts_at_ms`).bind(from, to)
    .all<{ id: number; title: string; teacher_name: string; description: string | null; starts_at_ms: number; ends_at_ms: number; cover_id: number | null; design_at: number | null }>()
    .then(r => r.results ?? []).catch(() => []);
  const events: NewsletterEvent[] = [
    ...house.map(e => {
      const hex = /^SF([0-9a-f]{24})$/.exec(e.id)?.[1];
      const description = plain(e.description);
      const host = e.host ?? /(?:^|\s)(?:Underviser|Undervisere|Facilitator|Teacher)\s*:\s*([^\n]{2,60}?)(?:\s{2,}|\s(?=[A-ZÆØÅ][a-zæøå]+:)|$)/.exec(description)?.[1]?.trim() ?? null;
      return { key: `mw:${e.id}`, title: e.title, startsMs: e.starts_at_ms, endsMs: e.ends_at_ms, host, category: e.category, imageUrl: absolute(e.image_url),
        link: hex ? `${SITE}/events/${hex}` : e.link ?? `${SITE}/events`, description, mornings: isMornings(e.title, description) };
    }),
    ...own.map(b => {
      const description = plain(b.description);
      return { key: `hr:${b.id}`, title: b.title, startsMs: b.starts_at_ms, endsMs: b.ends_at_ms, host: b.teacher_name, category: null,
        imageUrl: absolute(b.design_at ? designUrl(b.id, b.design_at) : b.cover_id ? `/api/event-files/${b.cover_id}` : null),
        link: `${SITE}/events`, description, mornings: isMornings(b.title, description) };
    })
  ];
  return events.sort((a, b) => a.startsMs - b.startsMs);
}

/** A title as the list shows it, when Saga has not given a shorter one: the part before "|", without brackets and "Hjerterum" in front. */
export function listTitle(title: string): string {
  const t = (title.split(/\s+\|\s+/)[0] ?? title).replace(/\s*\([^)]*\)/g, "").replace(/^Hjerterum\s+/i, "").replace(/\bwith\b/g, "med")
    .replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();
  return t ? Cap(t) : title.trim();
}

// ---- Saga's draft ----

const SYSTEM = `Du skriver Hjerterums månedlige nyhedsbrev "Månedens events" (Hjerterum er en forening og et hus i Aarhus for meditation, yoga, personlig udvikling og fællesskab).
Du får månedens events med en reference (E1, E2 ...). Svar KUN med JSON:
{"emneord": "...", "intro": "...", "fremhaevet": [{"overskrift": "...", "linje": "...", "tekst": "...", "billede": "E?", "events": ["E?"]}], "titler": {"E1": "..."}}

- "emneord": tre ord eller korte udtryk fra de fremhævede events til emnelinjen, fx "Tegning, kys og guidekontakt" (små bogstaver efter det første, "og" før det sidste).
- "intro": to korte afsnit adskilt af en tom linje, højst 60 ord i alt. Første afsnit: "Her er <måned>s overblik over alt, det der sker i Hjerterum ..." og at vi håber, det gør det nemt at finde det, der kalder på dig. Andet afsnit: hvad måneden byder på (nævn bredden, ingen navne) og "Vi glæder os til at se dig."
- "fremhaevet": 2 eller 3 events, der fortjener at blive set: workshops, kurser, foredrag eller ceremonier med en underviser - ALDRIG Mornings, faste ugentlige hold, medlemscaféen eller fællesspisning. Har en underviser flere events i måneden, så saml dem i ét. Vælg helst events med billede.
  - "overskrift": fx "Guidekontakt & shamanismens rødder med Rie Jespersen".
  - "linje": underviser og datoer, fx "Rie Jespersen · 8/11 og 10/11".
  - "tekst": 45-80 ord, varm og konkret, kun ud fra beskrivelserne - opfind intet. Skriv eventets titel som et link i formatet [titel](E?) første gang, den nævnes. Nævn praktiske ting, der står i beskrivelsen (fx "Ingen erfaring nødvendig", "Tag din kyssepartner med").
  - "billede": referencen på det event, hvis billede skal vises (et med billede). "events": alle de events, teksten handler om.
- "titler": en kort titel til listen for HVER reference: delen før "|" uden parenteser, datoer og "Hjerterum" foran; leder en navngiven underviser eventet, så "<titel> med <Fornavn Efternavn>". Mornings-events får ingen underviser på. Ret ikke stavningen af navne.
Skriv på dansk. Ingen emojis og ingen udråbstegn i teksterne.`;

type Draft = { emneord?: unknown; intro?: unknown; fremhaevet?: unknown; titler?: unknown };

export function readDraft(answer: string, refs: Map<string, NewsletterEvent>): { words: string; intro: string; highlights: Highlight[]; titles: Record<string, string> } | null {
  let data: Draft | null = null;
  try { data = JSON.parse(/\{[\s\S]*\}/.exec(answer)?.[0] ?? "null") as Draft | null; } catch { data = null; }
  if (!data || typeof data.intro !== "string" || !Array.isArray(data.fremhaevet)) return null;
  const titles: Record<string, string> = {};
  if (data.titler && typeof data.titler === "object") for (const [ref, title] of Object.entries(data.titler as Record<string, unknown>)) {
    const event = refs.get(ref);
    if (event && typeof title === "string" && title.trim()) titles[event.key] = title.trim().slice(0, 140);
  }
  const highlights = (data.fremhaevet as Array<Record<string, unknown>>).slice(0, 3).map(h => {
    const events = (Array.isArray(h.events) ? h.events : []).map(r => refs.get(String(r))).filter((e): e is NewsletterEvent => !!e);
    const pictured = refs.get(String(h.billede)) ?? events.find(e => e.imageUrl) ?? null;
    // [Titel](E5) becomes a link to that event's page; a reference that is not there is left as plain words.
    const text = String(h.tekst ?? "").replace(/\[([^\]]+)\]\((E\d+)\)/g, (_all, label: string, ref: string) => refs.has(ref) ? `[${label}](${refs.get(ref)!.link})` : label).trim();
    return { heading: String(h.overskrift ?? "").trim().slice(0, 140), byline: String(h.linje ?? "").trim().slice(0, 140), text: text.slice(0, 1500),
      image: pictured?.imageUrl ?? null, link: (events[0] ?? pictured)?.link ?? `${SITE}/events` };
  }).filter(h => h.heading && h.text);
  if (!highlights.length) return null;
  return { words: typeof data.emneord === "string" ? data.emneord.trim().replace(/[.!]+$/, "").slice(0, 80) : "", intro: data.intro.trim().slice(0, 1200), highlights, titles };
}

export const subjectOf = (month: string, words: string) => `${Cap(monthName(month))} i Hjerterum${words ? `: ${words}` : ""} 🤍`;

/** Saga writes the month's issue (one call to the main model) and keeps it as a draft - replacing an earlier draft, never an approved or sent one. */
export async function writeIssue(env: SagaEnv, deps: SagaDeps, db: D1Database, month: string): Promise<Issue | null> {
  if (!env.AI_API_KEY || !env.AI_MODEL) return null;
  const events = await monthEvents(db, month, deps.fetcher);
  if (!events.length) return null;
  const refs = new Map(events.map((e, i) => [`E${i + 1}`, e] as const));
  const list = [...refs].map(([ref, e]) => ({ ref, dato: dateLabel(e.startsMs), titel: e.title, underviser: e.host, kategori: e.category, mornings: e.mornings,
    billede: Boolean(e.imageUrl), beskrivelse: e.description.slice(0, e.mornings ? 120 : 600) }));
  const answer = await completeAs("nyhedsbrev", false, 5000)(env, deps, [{ role: "system", content: SYSTEM },
    { role: "user", content: JSON.stringify({ maaned: monthName(month), events: list }) }]);
  const draft = readDraft(answer, refs);
  if (!draft) return null;
  const now = deps.now();
  const preheader = (draft.intro.split(/\n\s*\n/)[0] ?? "").replace(/\s+/g, " ").slice(0, 140);
  await db.prepare(`INSERT INTO newsletter_issues (month, subject, preheader, intro, highlights, titles, status, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)
    ON CONFLICT(month) DO UPDATE SET subject = excluded.subject, preheader = excluded.preheader, intro = excluded.intro, highlights = excluded.highlights,
      titles = excluded.titles, error = NULL, updated_at_ms = excluded.updated_at_ms WHERE newsletter_issues.status IN ('draft', 'failed')`)
    .bind(month, subjectOf(month, draft.words), preheader, draft.intro, JSON.stringify(draft.highlights), JSON.stringify(draft.titles), now, now).run();
  return getIssue(db, month);
}

export async function getIssue(db: D1Database, month: string): Promise<Issue | null> {
  const row = await db.prepare("SELECT * FROM newsletter_issues WHERE month = ?").bind(month).first<Omit<Issue, "highlights" | "titles"> & { highlights: string; titles: string }>().catch(() => null);
  if (!row) return null;
  const json = <T>(raw: string, fallback: T): T => { try { return JSON.parse(raw) as T; } catch { return fallback; } };
  return { ...row, highlights: json<Highlight[]>(row.highlights, []), titles: json<Record<string, string>>(row.titles, {}) };
}

// ---- The mail ----

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Words with [label](https://...) links, as safe HTML. */
const withLinks = (s: string) => esc(s).replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_all, label: string, href: string) =>
  `<a href="${href}" style="color:#2a2622;text-decoration:underline"><em>${label}</em></a>`);
const paragraphs = (s: string) => s.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif";
const SANS = "Lato, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO = "'Space Mono', 'Courier New', monospace";
const INK = "#2a2622", CREAM = "#F4F1EB", CARAMEL = "#CD9D76", MUTED = "#6b5d52";

/** The whole mail as HTML for Mailchimp (its merge tags fill in the footer's links). */
export function newsletterHtml(issue: Pick<Issue, "month" | "subject" | "preheader" | "intro" | "highlights" | "titles">, events: NewsletterEvent[]): string {
  const name = Cap(monthName(issue.month));
  const pictures = [...issue.highlights.map(h => h.image), ...events.filter(e => !e.mornings).map(e => e.imageUrl)].filter((u): u is string => Boolean(u))
    .filter((u, i, all) => all.indexOf(u) === i).slice(0, 3);
  const rule = `<tr><td style="padding:0 24px"><div style="border-top:2px solid ${INK};font-size:0;line-height:0">&nbsp;</div></td></tr>`;
  const header = `<tr><td style="padding:0 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM}"><tr>
<td width="44%" style="padding:12px 0 12px 40px;vertical-align:middle">${pictures.map(src => `<img src="${esc(src)}" alt="" width="210" style="display:block;width:210px;max-width:100%;height:92px;object-fit:cover;margin:0 0 4px">`).join("")}</td>
<td style="padding:24px 12px 24px 24px;vertical-align:middle">
<div style="font:700 11px/1 ${MONO};letter-spacing:3px;color:${INK}">HJERTERUM</div>
<div style="font:400 50px/1.05 ${SERIF};color:${INK};margin-top:22px">${esc(name)}</div>
<div style="font:italic 400 28px/1.2 ${SERIF};color:${INK};margin-top:6px">i Hjerterum</div>
<div style="width:56px;height:4px;background:${CARAMEL};margin:22px 0 18px;font-size:0;line-height:0">&nbsp;</div>
<div style="font:700 11px/1 ${MONO};letter-spacing:3px;color:${INK}">MÅNEDENS EVENTS</div></td>
<td width="18" style="background:${CARAMEL};font-size:0">&nbsp;</td></tr></table></td></tr>`;
  const greeting = `<tr><td style="padding:28px 24px 8px;font:400 17px/1.6 ${SANS};color:${INK}">
<p style="margin:0 0 20px"><strong>Kære ven af Hjerterum</strong></p>
${paragraphs(issue.intro).map(p => `<p style="margin:0 0 20px">${withLinks(p)}</p>`).join("")}
<p style="margin:0 0 24px">Kærlig hilsen<br>Hjerterum</p>
<p style="margin:0 0 28px;font-style:italic">Har du ikke lyst til at få den månedlige mail, kan du fjerne krydset ved “Månedens events” her: <a href="*|UPDATE_PROFILE|*" style="color:${INK};text-decoration:underline">Opdater dine valg.</a> Du får stadig vores almindelige nyheder.</p></td></tr>`;
  const highlights = issue.highlights.length ? `${rule}<tr><td style="padding:24px 24px 8px;text-align:center;font:italic 700 30px/1.2 ${SERIF};color:${INK}">Fremhævet i ${esc(name)}</td></tr>`
    + issue.highlights.map((h, i) => `${i ? rule : ""}<tr><td style="padding:20px 24px 28px">
<div style="text-align:center;font:700 21px/1.3 ${SERIF};color:${INK};margin:0 0 22px">${esc(h.heading)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="48%" style="vertical-align:top;text-align:center">${h.image ? `<a href="${esc(h.link)}"><img src="${esc(h.image)}" alt="" width="270" style="display:block;width:100%;max-width:270px;height:auto;margin:0 auto 18px"></a>` : ""}
<a href="${esc(h.link)}" style="font:400 16px/1.4 ${SANS};color:${INK};text-decoration:underline">Læs mere her →</a></td>
<td width="4%"></td>
<td style="vertical-align:top;font:400 16px/1.6 ${SANS};color:${INK}">${h.byline ? `<strong>${esc(h.byline)}</strong><br>` : ""}${paragraphs(h.text).map(withLinks).join("<br>")}</td>
</tr></table></td></tr>`).join("") : "";
  // Week by week, as on the calendar.
  const weeks = new Map<number, NewsletterEvent[]>();
  for (const e of events) { const w = isoWeek(e.startsMs); weeks.set(w, [...(weeks.get(w) ?? []), e]); }
  const rest = `${rule}<tr><td style="padding:24px 24px 4px;text-align:center;font:italic 700 30px/1.2 ${SERIF};color:${INK}">Resten af ${esc(name)}</td></tr>
<tr><td style="padding:8px 24px 8px">${[...weeks].map(([week, list]) => `<div style="font:700 13px/1 ${SANS};letter-spacing:3px;color:${MUTED};padding:22px 0 10px;border-bottom:1px solid ${CARAMEL};margin-bottom:12px">UGE ${week}</div>
${list.map(e => `<div style="margin:0 0 12px"><div style="font:700 13px/1.3 ${SANS};color:${MUTED}">${esc(dateLabel(e.startsMs))}</div>
<div style="font:400 17px/1.35 ${SANS};color:${INK}"><a href="${esc(e.link)}" style="color:${INK};text-decoration:none">${esc(issue.titles[e.key] ?? listTitle(e.title))}</a>${e.mornings ? ` <span style="font:italic 400 13px ${SANS};color:${MUTED}">· Mornings</span>` : ""}</div></div>`).join("")}`).join("")}</td></tr>
<tr><td style="padding:16px 24px 28px;text-align:center"><a href="${SITE}/events" style="display:inline-block;background:#000;color:#fff;font:400 17px/1 Arial,sans-serif;padding:20px 32px;text-decoration:none">Se alle events her</a></td></tr>`;
  const mornings = `${rule}<tr><td style="padding:24px 24px 0"><a href="${SITE}/events"><img src="${SITE}/brand/nyhedsbrev-mornings.jpg" alt="Hjerterum Mornings - hver hverdag kl. 10.30-11.30, nogle dage kl. 9-10. Gratis for medlemmer, 50 kr. for andre." width="552" style="display:block;width:100%;height:auto"></a></td></tr>`;
  const footer = `<tr><td style="padding:28px 24px 0"><div style="border-top:2px solid ${INK};font-size:0;line-height:0">&nbsp;</div></td></tr>
<tr><td style="padding:28px 24px 36px;text-align:center;font:400 14px/1.5 ${SANS};color:${INK}">
<img src="${SITE}/brand/hjerterum-ordmaerke.png" alt="Hjerterum" width="148" style="display:inline-block;width:148px;height:auto;margin-bottom:18px"><br>
<em>Copyright (C) *|CURRENT_YEAR|* Hjerterum F.M.B.A. All rights reserved.</em><br>*|IF:REWARDS|* *|REWARDS|* *|END:IF|*
Du får denne mail, fordi du har tilmeldt dig via vores hjemmeside.<br><br>Hjerterum F.M.B.A · Guldsmedgade 26B, st. · 8000 Aarhus C<br><br>
<a href="*|UPDATE_PROFILE|*" style="color:${INK}">Opdater dine valg</a> eller <a href="*|UNSUB|*" style="color:${INK}">afmeld</a></td></tr>`;
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(issue.subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Lato:wght@400;700&family=Playfair+Display:ital,wght@0,400;0,700;1,400;1,700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#f2f2f2"><div style="display:none;max-height:0;overflow:hidden">${esc(issue.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2"><tr><td align="center" style="padding:24px 0">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff">
<tr><td style="padding:40px 24px 30px;text-align:center"><img src="${SITE}/brand/hjerterum-ordmaerke.png" alt="Hjerterum" width="148" style="display:inline-block;width:148px;height:auto"></td></tr>
${header}${greeting}${highlights}${rest}${mornings}${footer}
</table></td></tr></table></body></html>`;
}
