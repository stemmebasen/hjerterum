/** Requested: "hvad vil være en smart gengivelse af telegram gruppechatten?" - "Ja!" - "Men vi skal
 * også have lavet en lignende analyse af dokumentet - f.eks. beslutninger, foreslag, opgaver. Måske
 * skal vi samle ét sted med spørgsmål og todos til mig drager ud af både telegram og doc og mail".
 * The overview's one AI call answers with this picture as JSON; it is checked field by field here,
 * and anything that does not fit is dropped rather than shown. */
export type TopicStatus = "besluttet" | "drøftes" | "afventer" | "på vej";
export type Source = "telegram" | "dokument" | "mail";
export type ThreadStatus = "udsat" | "afventer" | "ingen opfølgning";
export type BoardPicture = {
  summary: string;
  temperature: { level: string; why: string } | null;
  topics: Array<{ title: string; status: TopicStatus; who: string[]; waitsOnJacob: boolean; note: string }>;
  document: {
    latestMeeting: string;
    missingMinutes: string[];
    dates: Array<{ date: string; what: string }>;
    figures: Array<{ label: string; value: string; date: string; previous: string }>;
    decisions: Array<{ topic: string; text: string; date: string; replaces: string }>;
    openThreads: Array<{ text: string; since: string; status: ThreadStatus }>;
    proposals: Array<{ text: string; by: string }>;
    tasks: Array<{ who: string; what: string; due: string; since: string }>;
    nextAgenda: string[];
  };
  forJacob: Array<{ key: string; kind: "spørgsmål" | "opgave"; text: string; source: Source; from: string; since: string }>;
  /** Requested ("Hvorfor får de andre ikke denne besked?"): what concerns other board members - or all of them ("alle") - by the
   * responsibilities each has written. `to` holds first names, or "alle". */
  forMembers: Array<{ key: string; to: string[]; kind: "spørgsmål" | "opgave"; text: string; source: Source; from: string; since: string }>;
};

/** Whether an item written for these names concerns the member: everyone ("alle"), or the member's first name. */
export function addressedTo(to: string[], member: string): boolean {
  const first = (name: string) => name.trim().split(/\s+/)[0]?.toLocaleLowerCase("da-DK") ?? "";
  return to.some(name => first(name) === "alle" || first(name) === first(member));
}

const STATUSES: readonly TopicStatus[] = ["besluttet", "drøftes", "afventer", "på vej"];
const SOURCES: readonly Source[] = ["telegram", "dokument", "mail"];
const THREAD_STATUSES: readonly ThreadStatus[] = ["udsat", "afventer", "ingen opfølgning"];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const str = (value: unknown, max: number) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
const list = (value: unknown, max: number) => (Array.isArray(value) ? value : []).slice(0, max).filter(x => x && typeof x === "object") as Array<Record<string, unknown>>;

/** A stable key for an item for the chair, so "Klaret" holds when the same item comes again. */
export function itemKey(text: string): string {
  const normal = text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  let hash = 2166136261;
  for (let i = 0; i < normal.length; i++) { hash ^= normal.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}

/** Requested: "Saga skal være meget sikker, hvis hun putter en opgave på - og det skal primært være fra referatet."
 * A task (not a question) comes from the minutes; from the group chat or a mail it is kept only when Saga marked it sure -
 * somebody plainly asked this person to do it, or it was agreed. */
const certain = (f: { kind: string; source: string; sure: boolean }) => f.kind !== "opgave" || f.source === "dokument" || f.sure;

/** The JSON object in the AI's answer (it may be wrapped in a code fence), or null. */
function jsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { const parsed = JSON.parse(text.slice(start, end + 1)) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null; }
  catch { return null; }
}

/** The picture in the AI's answer; null when it is not the JSON asked for (then the answer is kept as plain text). */
export function parsePicture(answer: string): BoardPicture | null {
  const data = jsonObject(answer);
  const summary = data ? (typeof data.summary === "string" ? data.summary.trim().slice(0, 6000) : "") : "";
  if (!data || !summary) return null;
  const doc = data.document && typeof data.document === "object" ? data.document as Record<string, unknown> : {};
  const temperature = data.temperature && typeof data.temperature === "object" ? data.temperature as Record<string, unknown> : null;
  const seen = new Set<string>();
  return {
    summary,
    temperature: temperature && str(temperature.level, 40) ? { level: str(temperature.level, 40), why: str(temperature.why, 300) } : null,
    topics: list(data.topics, 12).map(t => ({
      title: str(t.title, 160), status: STATUSES.includes(t.status as TopicStatus) ? t.status as TopicStatus : "drøftes",
      who: (Array.isArray(t.who) ? t.who : []).map(w => str(w, 60)).filter(Boolean).slice(0, 6), waitsOnJacob: t.waitsOnJacob === true, note: str(t.note, 300)
    })).filter(t => t.title),
    document: {
      latestMeeting: str(doc.latestMeeting, 40),
      missingMinutes: (Array.isArray(doc.missingMinutes) ? doc.missingMinutes : []).map(d => str(d, 40)).filter(Boolean).slice(0, 6),
      // Only real days; the page sorts and drops the ones that have passed.
      dates: list(doc.dates, 12).map(d => ({ date: str(d.date, 10), what: str(d.what, 200) })).filter(d => ISO_DAY.test(d.date) && d.what),
      figures: list(doc.figures, 8).map(f => ({ label: str(f.label, 60), value: str(f.value, 80), date: str(f.date, 40), previous: str(f.previous, 120) })).filter(f => f.label && f.value),
      decisions: list(doc.decisions, 15).map(d => ({ topic: str(d.topic, 80), text: str(d.text, 300), date: str(d.date, 40), replaces: str(d.replaces, 200) })).filter(d => d.text),
      openThreads: list(doc.openThreads, 12).map(t => ({ text: str(t.text, 300), since: str(t.since, 40),
        status: THREAD_STATUSES.includes(t.status as ThreadStatus) ? t.status as ThreadStatus : "afventer" })).filter(t => t.text),
      proposals: list(doc.proposals, 15).map(p => ({ text: str(p.text, 300), by: str(p.by, 60) })).filter(p => p.text),
      tasks: list(doc.tasks, 25).map(t => ({ who: str(t.who, 60), what: str(t.what, 300), due: str(t.due, 40), since: str(t.since, 40) })).filter(t => t.what),
      nextAgenda: (Array.isArray(doc.nextAgenda) ? doc.nextAgenda : []).map(a => str(a, 200)).filter(Boolean).slice(0, 8)
    },
    forJacob: list(data.forJacob, 15).map(f => ({
      key: "", kind: f.kind === "spørgsmål" ? "spørgsmål" as const : "opgave" as const, text: str(f.text, 300),
      source: SOURCES.includes(f.source as Source) ? f.source as Source : "telegram", from: str(f.from, 60), since: str(f.since, 40), sure: f.sure === true
    })).filter(f => f.text && certain(f)).map(({ sure: _sure, ...f }) => ({ ...f, key: itemKey(f.text) })).filter(f => !seen.has(f.key) && seen.add(f.key)),
    forMembers: list(data.forMembers, 15).map(f => ({
      key: "", to: (Array.isArray(f.to) ? f.to : typeof f.to === "string" ? [f.to] : []).map(n => str(n, 60)).filter(Boolean).slice(0, 8),
      kind: f.kind === "spørgsmål" ? "spørgsmål" as const : "opgave" as const, text: str(f.text, 300),
      source: SOURCES.includes(f.source as Source) ? f.source as Source : "telegram", from: str(f.from, 60), since: str(f.since, 40), sure: f.sure === true
    })).filter(f => f.text && f.to.length && certain(f)).map(({ sure: _sure, ...f }) => ({ ...f, key: itemKey(f.text) })).filter(f => !seen.has(f.key) && seen.add(f.key))
  };
}

/** The group's activity, counted without AI: this week against the week before, and who wrote. */
export function groupActivity(messages: Array<{ author_name: string; sent_at_ms: number; from_assistant: number }>, now: number) {
  const week = 7 * 86_400_000, people = messages.filter(m => !m.from_assistant);
  const thisWeek = people.filter(m => m.sent_at_ms >= now - week), lastWeek = people.filter(m => m.sent_at_ms < now - week && m.sent_at_ms >= now - 2 * week);
  const counts = new Map<string, number>();
  for (const m of thisWeek) counts.set(m.author_name, (counts.get(m.author_name) ?? 0) + 1);
  return { thisWeek: thisWeek.length, lastWeek: lastWeek.length, members: [...counts].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })) };
}

/** A link into the group: only a supergroup (-100…) has t.me/c/ links, and only members can open them. */
export function telegramLink(chatId: string, messageId?: number | null): string | null {
  const match = /^-100(\d+)$/.exec(chatId);
  return match ? `https://t.me/c/${match[1]}${messageId ? `/${messageId}` : ""}` : null;
}

/** A short fingerprint of the minutes document, so a changed document gives a new overview. */
export async function docHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest).slice(0, 8)].map(b => b.toString(16).padStart(2, "0")).join("");
}

const MONTHS: Record<string, number> = { januar: 1, februar: 2, marts: 3, april: 4, maj: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, december: 12 };
/** Where a meeting starts in the minutes document: the board's own "Dato for møde: 17/9/ 2026", or
 * the heading of minutes Saga added ("Referat - bestyrelsesmøde 1. oktober 2026"). */
const MEETING = /Dato for møde(?::|\s+d\.)\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/?\s*(\d{4})|Referat - bestyrelsesmøde\s+(\d{1,2})\.\s*([a-zæøå]+)\s+(\d{4})/giu;

/** The minutes document cut into its meetings, newest first: each with its day (YYYY-MM-DD), a short
 * label and its own text. The board cockpit's archive shows the historical minutes this way. */
export function splitMinutesDoc(text: string): Array<{ date: number; day: string; label: string; text: string }> {
  const starts = [...text.matchAll(MEETING)].map(m => {
    const [day, month, year] = m[1] ? [Number(m[1]), Number(m[2]), Number(m[3])] : [Number(m[4]), MONTHS[m[5]!.toLowerCase()] ?? 0, Number(m[6])];
    return { at: m.index ?? 0, date: year * 10_000 + month * 100 + day, day: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, label: `${day}/${month} ${year}` };
  }).filter(s => s.date % 10_000 > 100 && s.date % 100 >= 1 && s.date % 100 <= 31);
  return starts.map((s, i) => ({ date: s.date, day: s.day, label: s.label, text: text.slice(s.at, starts[i + 1]?.at ?? text.length).trim() })).sort((a, b) => b.date - a.date);
}

/** The minutes document for the AI, newest meetings first, as many whole meetings as fit. The
 * board writes its newest meeting at the top and Saga adds hers at the end, so the document is cut
 * into meetings by their dates rather than by where they stand. Without dates: its start and its
 * newest end, as before. */
export function trimMinutesDoc(text: string, max: number): string {
  const meetings = splitMinutesDoc(text);
  if (meetings.length < 2) return text.length <= max ? text : `${text.slice(0, Math.floor(max * 0.25))}\n[…]\n${text.slice(-Math.floor(max * 0.75))}`;
  const kept: string[] = [], left: string[] = [];
  let used = 0;
  for (const meeting of meetings) {
    if (used + meeting.text.length <= max) { kept.push(meeting.text); used += meeting.text.length + 2; }
    else if (!kept.length) { kept.push(`${meeting.text.slice(0, max)}\n[…]`); used = max; }
    else left.push(meeting.label);
  }
  return kept.join("\n\n") + (left.length ? `\n\n[Ældre møder ikke medtaget: ${left.join(", ")}]` : "");
}
