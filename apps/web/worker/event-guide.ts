/** "Opret med Saga" (src/saga-event-guide.tsx), held together by code, not by the model's memory. Reported: "Hun har allerede foreslået
 * en titel, som jeg har sagt ja til, og så kommer hun alligevel med et nyt forslag senere" and "Det er alt for uorganiseret, og hun vender
 * tilbage til spørgsmål, hun har stillet tidligere". So the answers live here as facts: what is known is locked and shown to her as
 * known, the order of the questions is decided here (nextStep), and she is asked about one step at a time. At the end she only writes
 * the description; the draft is put together from the facts. */

export const STEPS = ["titel", "indhold", "tid", "pris", "sociale", "billeder"] as const;
export type Step = (typeof STEPS)[number] | "forslag";

export type EventFacts = {
  title: string | null;
  content: string | null; leader: string | null; audience: string | null; bring: string | null;
  date: string | null; start: string | null; end: string | null;
  member_price_kr: number | null; non_member_price_kr: number | null; max_attendees: number | null;
  social: boolean | null;
  photo: "ok" | "skipped" | null;
  description: string | null;
};

export const NO_FACTS: EventFacts = { title: null, content: null, leader: null, audience: null, bring: null, date: null, start: null, end: null,
  member_price_kr: null, non_member_price_kr: null, max_attendees: null, social: null, photo: null, description: null };

/** The facts each step settles; the first is what makes it done. */
const STEP_KEYS: Record<(typeof STEPS)[number], Array<keyof EventFacts>> = {
  titel: ["title"],
  indhold: ["content", "leader", "audience", "bring"],
  tid: ["date", "start", "end"],
  pris: ["member_price_kr", "non_member_price_kr", "max_attendees"],
  sociale: ["social"],
  billeder: ["photo"]
};

export function stepDone(step: (typeof STEPS)[number], f: EventFacts): boolean {
  switch (step) {
    case "titel": return Boolean(f.title);
    case "indhold": return Boolean(f.content);
    case "tid": return Boolean(f.date && f.start && f.end);
    case "pris": return f.member_price_kr !== null;
    case "sociale": return f.social !== null;
    case "billeder": return f.photo !== null;
  }
}

export const nextStep = (f: EventFacts): Step => STEPS.find(step => !stepDone(step, f)) ?? "forslag";

const text = (v: unknown, max: number) => typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, max) : null;
const kr = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100_000 ? Math.round(v) : null;
const date = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
const clock = (v: unknown) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null;

/** Facts from the browser or the model, each checked; anything odd is left out. */
export function readFacts(value: unknown): Partial<EventFacts> {
  if (!value || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  const out: Partial<EventFacts> = {};
  const set = <K extends keyof EventFacts>(key: K, read: EventFacts[K] | null) => { if (read !== null && read !== undefined) out[key] = read as EventFacts[K]; };
  set("title", text(v.title, 120)); set("content", text(v.content, 1200)); set("leader", text(v.leader, 120)); set("audience", text(v.audience, 200)); set("bring", text(v.bring, 200));
  set("date", date(v.date)); set("start", clock(v.start)); set("end", clock(v.end));
  set("member_price_kr", kr(v.member_price_kr)); set("non_member_price_kr", kr(v.non_member_price_kr));
  const max = kr(v.max_attendees); if (max !== null && max > 0) out.max_attendees = max;
  if (typeof v.social === "boolean") out.social = v.social;
  if (v.photo === "ok" || v.photo === "skipped") out.photo = v.photo;
  set("description", text(v.description, 4000));
  return out;
}

/** What the model learned joins the known facts - but a known fact is locked: only the step being asked about may change its own
 * facts (the member answered it just now), and anything not yet known may be filled in from what the member said. A photo is "ok"
 * only when the code approved it, never because the model says so. */
export function mergeFacts(known: EventFacts, learned: Partial<EventFacts>, step: Step): EventFacts {
  const open = new Set<keyof EventFacts>(step === "forslag" ? [] : STEP_KEYS[step]);
  const out = { ...known };
  for (const [key, value] of Object.entries(learned) as Array<[keyof EventFacts, EventFacts[keyof EventFacts]]>) {
    if (value === null || value === undefined || key === "description") continue;
    if (key === "photo" && value === "ok") continue;
    if (known[key] === null || open.has(key)) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** Members free and others paying: free rent; members paying less: reduced; else standard (worker/member-saga.ts REGLER FOR LEJE). */
export function bookingTypeOf(f: Pick<EventFacts, "member_price_kr" | "non_member_price_kr">): "standard" | "reduced" | "free" {
  const member = f.member_price_kr ?? 0, other = f.non_member_price_kr ?? member;
  if (member === 0 && other > 0) return "free";
  if (member < other) return "reduced";
  return "standard";
}

export type GuidedDraft = { title: string; description: string; date: string; start: string; end: string; booking_type: "standard" | "reduced" | "free";
  max_attendees: number | null; member_price_kr: number | null; non_member_price_kr: number | null };

export function draftFrom(f: EventFacts): GuidedDraft | null {
  if (!f.title || !f.date || !f.start || !f.end || !f.description) return null;
  return { title: f.title, description: f.description, date: f.date, start: f.start, end: f.end, booking_type: bookingTypeOf(f),
    max_attendees: f.max_attendees, member_price_kr: f.member_price_kr, non_member_price_kr: f.non_member_price_kr };
}

const ASK: Record<(typeof STEPS)[number], string> = {
  titel: "TITLEN. Foreslå én kort, varm titel ud fra brief'et og spørg, om den er god. suggestions: 4-5 forskellige titelforslag.",
  indhold: "INDHOLDET - i ét spørgsmål: hvad sker der (forløbet), hvem leder det, for hvem, og hvad man medbringer. suggestions: 4-5 konkrete dele, der kan kombineres (forløbets dele, leder, målgruppe, hvad man medbringer).",
  tid: "TIDSPUNKTET: dato, start og slut. Brug KALENDEREN og foreslå kun ledige tider. suggestions: 4-5 konkrete ledige tider med ugedag og dato, fx \"Søndag 8/11 kl. 14-16\".",
  pris: "PRIS OG PLADSER: pris for medlemmer og for ikke-medlemmer (gratis er fint) og evt. maks. deltagere - sig, hvad lejen bliver. suggestions: 4-5 realistiske kombinationer, fx \"Gratis for medlemmer, 100 kr. for andre\", \"Maks. 20 deltagere\".",
  sociale: "SOCIALE MEDIER: skal Hjerterum dele eventet på Instagram og Facebook? Ja betyder, at vi laver opslag ud fra titel, tid og eventfoto. suggestions: \"Ja, del det\", \"Nej tak\" og evt. 2 andre korte svar.",
  billeder: "EVENTFOTO: bed om et foto i bredformat (det beskæres til 1920 × 1005 px) - medlemmet trykker \"Tilføj foto\". Det kan springes over. suggestions: \"Spring over\", \"Jeg sender et foto nu\" og 2-3 andre korte svar."
};

const label = (f: EventFacts) => JSON.stringify(Object.fromEntries(Object.entries(f).filter(([key, value]) => value !== null && key !== "description")));

/** The instruction for one turn: what is known (locked), and the one step to ask about now. */
export function guidedPrompt(f: EventFacts, step: Step): string {
  if (step === "forslag") return "";
  return `

GUIDET OPRETTELSE (gælder nu - følg det præcist)
Medlemmet opretter et event sammen med dig, ét punkt ad gangen. Rækkefølgen styres af systemet, ikke af dig.
KENDTE OPLYSNINGER (låst - spørg ALDRIG om dem igen, foreslå ALDRIG noget nyt til dem, og gentag dem ikke): ${label(f)}
SPØRG NU KUN OM: ${ASK[step]}
Tag det, medlemmet lige har svaret, ind i "facts" - og alt andet nyt, medlemmet har sagt (fx en dato i brief'et), også selv om det hører til et senere punkt. Bekræft kort (højst én sætning), og stil så dit ene spørgsmål. Ingen udkast ("draft": null).
"facts" bruger disse nøgler (kun dem, du har fået at vide nu): title, content, leader, audience, bring, date (ÅÅÅÅ-MM-DD), start (TT:MM), end (TT:MM), member_price_kr, non_member_price_kr, max_attendees, social (true/false), photo ("skipped" hvis medlemmet vil springe fotoet over).
"suggestions": ALTID 4-5 korte svar (højst ca. 70 tegn), medlemmet kan trykke på - og vælge flere af.
Svar KUN med JSON: {"reply":"...","draft":null,"photo_ok":null,"facts":{...},"suggestions":["...","...","...","..."]}`;
}

/** The last call: only the description, from the member's own content - the rest of the draft comes from the facts. */
export const DESCRIBE = (f: EventFacts) => `Du er Saga, Hjerterums assistent. Skriv eventbeskrivelsen til Hjerterums kalender ud fra medlemmets egne oplysninger - find ikke på nyt.
Hjerterums tone: varm, nærværende og konkret, 2-4 korte afsnit: hvad sker der, for hvem, hvem leder det, hvad man medbringer, og hvad det koster (medlemmer/andre). Ingen helbredsløfter, intet råberi, ingen emojis. Titlen står allerede over teksten - gentag den ikke.
Oplysninger: ${label(f)}
Svar KUN med JSON: {"description":"...","reply":"én kort sætning til medlemmet om, at forslaget er klar"}`;

export type GuidedAnswer = { reply: string; learned: Partial<EventFacts>; suggestions: string[] };

/** Reported: Saga's raw JSON on the page ({"reply":"Tak for billedet ...","progress":{...,"bill) - an answer cut off at its length
 * limit is no JSON. Her "reply" is still read out of it; the raw text is never shown. */
export function replyFromBrokenJson(answer: string): string | null {
  const m = /"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(answer);
  if (!m) return null;
  try { return (JSON.parse(`"${m[1]}"`) as string).trim() || null; } catch { return m[1]!.replace(/\\n/g, "\n").replace(/\\"/g, '"').trim() || null; }
}

export function parseGuided(answer: string): GuidedAnswer {
  let data: Record<string, unknown> | null = null;
  try { data = JSON.parse(/\{[\s\S]*\}/.exec(answer)?.[0] ?? "null") as Record<string, unknown> | null; } catch { data = null; }
  const suggestions = Array.isArray(data?.suggestions) ? (data!.suggestions as unknown[]).filter((x): x is string => typeof x === "string" && x.trim().length > 0).map(x => x.trim().slice(0, 90)).slice(0, 5) : [];
  const reply = typeof data?.reply === "string" && data.reply.trim() ? data.reply.trim().slice(0, 1200)
    : replyFromBrokenJson(answer)?.slice(0, 1200) ?? (data || /^\s*\{/.test(answer) ? "Undskyld, det fangede jeg ikke helt. Prøv at svare igen?" : answer.trim().slice(0, 1200) || "Fortæl mig lidt mere?");
  const learned = readFacts(data?.facts);
  delete learned.description;
  return { reply, learned, suggestions };
}
