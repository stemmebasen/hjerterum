/** Requested: "hvad vil være en smart gengivelse af telegram gruppechatten?" - "Ja!" - "Men vi skal
 * også have lavet en lignende analyse af dokumentet - f.eks. beslutninger, foreslag, opgaver. Måske
 * skal vi samle ét sted med spørgsmål og todos til mig drager ud af både telegram og doc og mail".
 * The overview's one AI call answers with this picture as JSON; it is checked field by field here,
 * and anything that does not fit is dropped rather than shown. */
export type TopicStatus = "besluttet" | "drøftes" | "afventer" | "på vej";
export type Source = "telegram" | "dokument" | "mail";
export type BoardPicture = {
  summary: string;
  temperature: { level: string; why: string } | null;
  topics: Array<{ title: string; status: TopicStatus; who: string[]; waitsOnJacob: boolean; note: string }>;
  document: {
    decisions: Array<{ text: string; date: string }>;
    proposals: Array<{ text: string; by: string }>;
    tasks: Array<{ who: string; what: string; due: string }>;
  };
  forJacob: Array<{ key: string; kind: "spørgsmål" | "opgave"; text: string; source: Source; from: string }>;
};

const STATUSES: readonly TopicStatus[] = ["besluttet", "drøftes", "afventer", "på vej"];
const SOURCES: readonly Source[] = ["telegram", "dokument", "mail"];
const str = (value: unknown, max: number) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
const list = (value: unknown, max: number) => (Array.isArray(value) ? value : []).slice(0, max).filter(x => x && typeof x === "object") as Array<Record<string, unknown>>;

/** A stable key for an item for the chair, so "Klaret" holds when the same item comes again. */
export function itemKey(text: string): string {
  const normal = text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  let hash = 2166136261;
  for (let i = 0; i < normal.length; i++) { hash ^= normal.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}

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
      decisions: list(doc.decisions, 15).map(d => ({ text: str(d.text, 300), date: str(d.date, 40) })).filter(d => d.text),
      proposals: list(doc.proposals, 15).map(p => ({ text: str(p.text, 300), by: str(p.by, 60) })).filter(p => p.text),
      tasks: list(doc.tasks, 20).map(t => ({ who: str(t.who, 60), what: str(t.what, 300), due: str(t.due, 40) })).filter(t => t.what)
    },
    forJacob: list(data.forJacob, 15).map(f => ({
      key: "", kind: f.kind === "spørgsmål" ? "spørgsmål" as const : "opgave" as const, text: str(f.text, 300),
      source: SOURCES.includes(f.source as Source) ? f.source as Source : "telegram", from: str(f.from, 60)
    })).filter(f => f.text).map(f => ({ ...f, key: itemKey(f.text) })).filter(f => !seen.has(f.key) && seen.add(f.key))
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
