/** Requested: "Det er også vigtigt, at Saga løbende vurderer, at der ikke kommer for mange af samme type events i kalenderen" - and
 * "Ja" to the proposal: each event gets a type from its own words (no AI, so it costs nothing), at most 3 of a type in a week,
 * 1 on a day, and not two days in a row. The house's fixed morning programme (Hjerterum Mornings) is not counted. */
export const EVENT_TYPES = [
  { key: "cirkler", label: "cirkler", words: /\bcirk(el|ler)|\bcircle/i },
  { key: "breathwork", label: "breathwork", words: /breath ?work|åndedræt|vejrtrækning|rebirthing|pranayama|breathing/i },
  { key: "lyd", label: "lyd og musik", words: /lydbad|lydhealing|lydrejse|\bgong|\bkirtan|koncert|concert|\bmusik|\bmusic|\bsang\b|\bsing|sound ?bath|\bsound\b|\bklang/i },
  { key: "dans", label: "dans og bevægelse", words: /\bdans|\bdance|ecstatic|5 ?rytmer|5 ?rhythms|bevægelse|movement|stopdans/i },
  { key: "socialt", label: "socialt og café", words: /\bcaf[eé]|fællesspisning|medlemscaf|\bfest\b|\bhygge|potluck|social/i },
  { key: "healing", label: "healing og spiritualitet", words: /healing|\breiki|\btarot|guidekontakt|\bguider\b|clairvoy|\bshaman|ceremoni|ceremony|\bkakao|\bcacao|\bmedium|\bastrolog|energi/i },
  { key: "yoga", label: "yoga og meditation", words: /\byoga|\byin\b|hatha|vinyasa|dhyana|qi ?gong|tai ?chi|meditation|meditér|mindfulness|yoga ?nidra/i },
  { key: "foredrag", label: "foredrag og workshops", words: /foredrag|\btalk\b|oplæg|lecture|workshop|kursus|course|introduktion|introduction|seminar/i }
] as const;
export type EventType = (typeof EVENT_TYPES)[number]["key"] | "andet";

/** The event's type: the first that its title names, else its description, else "andet" (which is never limited). */
export function eventType(title: string, description?: string | null, category?: string | null): EventType {
  for (const text of [title, `${description ?? ""} ${category ?? ""}`]) {
    const hit = EVENT_TYPES.find(t => t.words.test(text));
    if (hit) return hit.key;
  }
  return "andet";
}
export const typeLabel = (type: EventType) => EVENT_TYPES.find(t => t.key === type)?.label ?? "andet";

/** Hjerterum Mornings: the house's own morning programme, not counted. */
export const isMornings = (title: string, description?: string | null) => /mornings/i.test(`${title} ${(description ?? "").slice(0, 200)}`);

export const VARIETY = { perWeek: 3, perDay: 1 } as const;
