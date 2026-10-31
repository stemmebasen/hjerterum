/** "Opret med Saga" (src/saga-event-guide.tsx), held together by code, not by the model's memory. Reported: "Hun har allerede foreslået
 * en titel, som jeg har sagt ja til, og så kommer hun alligevel med et nyt forslag senere" and "Det er alt for uorganiseret, og hun vender
 * tilbage til spørgsmål, hun har stillet tidligere". So the answers live here as facts: what is known is locked and shown to her as
 * known, the order of the questions is decided here (nextStep), and she is asked about one step at a time. At the end she only writes
 * the description; the draft is put together from the facts. */

/** Reported: "Er det meningen hun stiller to spørgsmål men kun giver svarmuligheder til det ene?" and "Det virker underligt at blande
 * tingene sammen på den måde": one fact per step, one question per step - asked in the code's words, with her suggestions for it. */
import { FREE_RENT_MIN_NON_MEMBER_KR } from "../../../packages/core/src/legacy-room-pricing.js";
import { GUIDE_CHOICES, isFixedStep } from "../site/guide-choices.js";

export const STEPS = ["titel", "indhold", "leder", "kontakt", "medbring", "tid", "pris", "pladser", "sociale", "billeder"] as const;
export type Step = (typeof STEPS)[number] | "forslag";

export type EventFacts = {
  title: string | null;
  content: string | null; leader: string | null; audience: string | null; bring: string | null;
  /** May those interested contact the leader: by e-mail, phone, both - or "none". */
  contact: "email" | "phone" | "both" | "none" | null;
  date: string | null; start: string | null; end: string | null;
  member_price_kr: number | null; non_member_price_kr: number | null; max_attendees: number | null;
  social: boolean | null;
  photo: "ok" | "skipped" | null;
  description: string | null;
};

export const NO_FACTS: EventFacts = { title: null, content: null, leader: null, audience: null, bring: null, contact: null, date: null, start: null, end: null,
  member_price_kr: null, non_member_price_kr: null, max_attendees: null, social: null, photo: null, description: null };

/** The facts each step settles; the first is what makes it done. */
const STEP_KEYS: Record<(typeof STEPS)[number], Array<keyof EventFacts>> = {
  titel: ["title"],
  indhold: ["content", "audience"],
  leder: ["leader"],
  kontakt: ["contact"],
  medbring: ["bring"],
  tid: ["date", "start", "end"],
  pris: ["member_price_kr", "non_member_price_kr"],
  pladser: ["max_attendees"],
  sociale: ["social"],
  billeder: ["photo"]
};

export function stepDone(step: (typeof STEPS)[number], f: EventFacts): boolean {
  switch (step) {
    case "titel": return Boolean(f.title);
    case "indhold": return Boolean(f.content);
    case "leder": return Boolean(f.leader);
    case "kontakt": return f.contact !== null;
    case "medbring": return Boolean(f.bring);
    case "tid": return Boolean(f.date && f.start && f.end);
    case "pris": return f.member_price_kr !== null;
    case "pladser": return f.max_attendees !== null;
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
  // 0 means no limit - an answer, not a missing one.
  const max = kr(v.max_attendees); if (max !== null && max <= 1000) out.max_attendees = max;
  if (typeof v.social === "boolean") out.social = v.social;
  if (v.contact === "email" || v.contact === "phone" || v.contact === "both" || v.contact === "none") out.contact = v.contact;
  if (v.photo === "ok" || v.photo === "skipped") out.photo = v.photo;
  set("description", text(v.description, 4000));
  return out;
}

/** What the model learned joins the known facts. Reported: she set a date ("søn. 20. dec. kl. 14-15") nobody had given. So only the
 * member's brief - the first message - may fill in facts of any step; after that, only the step being asked about takes an answer,
 * and a known fact of another step is never touched. A photo is "ok" only when the code approved it, never on the model's word. */
export function mergeFacts(known: EventFacts, learned: Partial<EventFacts>, step: Step, brief = false): EventFacts {
  const open = new Set<keyof EventFacts>(step === "forslag" ? [] : STEP_KEYS[step]);
  const out = { ...known };
  for (const [key, value] of Object.entries(learned) as Array<[keyof EventFacts, EventFacts[keyof EventFacts]]>) {
    if (value === null || value === undefined || key === "description") continue;
    if (key === "photo" && value === "ok") continue;
    if (open.has(key) || (brief && known[key] === null)) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** A step with fixed buttons is answered by the code, not the model: "Ja tak"/"Nej tak" for sharing, "Spring over" for the photo.
 * Anything else typed there is left to the model. */
export function fixedAnswer(step: Step, message: string): Partial<EventFacts> | null {
  if (!isFixedStep(step)) return null;
  const said = message.trim().toLowerCase().replace(/[.!]+$/, "");
  if (step === "kontakt") {
    if (/^(e-?mail|mail)$/.test(said)) return { contact: "email" };
    if (/^(telefon|tlf|telefonnummer)$/.test(said)) return { contact: "phone" };
    if (/^(begge|begge dele|e-?mail og telefon)$/.test(said)) return { contact: "both" };
    if (/^(nej|nej tak)$/.test(said)) return { contact: "none" };
  }
  if (step === "sociale") {
    if (/^(ja|ja tak|ja,? del (det|den)|del (det|den))$/.test(said)) return { social: true };
    if (/^(nej|nej tak)$/.test(said)) return { social: false };
  }
  if (step === "billeder" && /^(spring( det)? over|nej|nej tak|ingen foto|intet foto)$/.test(said)) return { photo: "skipped" };
  return null;
}

/** The buttons for the next question: fixed ones where the step has them, else her suggestions when they were meant for it. */
export function choicesFor(next: Step, said: Pick<GuidedAnswer, "suggestions" | "suggestionsFor">): string[] {
  if (next === "forslag") return [];
  if (isFixedStep(next)) return [...GUIDE_CHOICES[next]];
  return said.suggestionsFor === next ? said.suggestions : [];
}

export const isBrief = (f: EventFacts) => Object.values(f).every(v => v === null);

/** Members free and others paying: free rent; members paying less: reduced; else standard (worker/member-saga.ts REGLER FOR LEJE). */
export function bookingTypeOf(f: Pick<EventFacts, "member_price_kr" | "non_member_price_kr">): "standard" | "reduced" | "free" {
  const member = f.member_price_kr ?? 0, other = f.non_member_price_kr ?? member;
  // Gratis leje: members free, non-members at least 75 kr. each (FREE_RENT_MIN_NON_MEMBER_KR). Free for everyone is standard rent.
  if (member === 0 && other >= FREE_RENT_MIN_NON_MEMBER_KR) return "free";
  if (member < other) return "reduced";
  return "standard";
}

export type GuidedDraft = { title: string; description: string; date: string; start: string; end: string; booking_type: "standard" | "reduced" | "free";
  max_attendees: number | null; member_price_kr: number | null; non_member_price_kr: number | null; contact_share: "email" | "phone" | "both" | null };

export function draftFrom(f: EventFacts): GuidedDraft | null {
  if (!f.title || !f.date || !f.start || !f.end || !f.description) return null;
  return { title: f.title, description: f.description, date: f.date, start: f.start, end: f.end, booking_type: bookingTypeOf(f),
    max_attendees: f.max_attendees || null, member_price_kr: f.member_price_kr, non_member_price_kr: f.non_member_price_kr,
    contact_share: f.contact === "none" ? null : f.contact };
}

/** The question for each step, in the code's words - exactly one, so her suggestions always answer it. */
export const QUESTION: Record<(typeof STEPS)[number], string> = {
  titel: "Hvad skal eventet hedde?",
  indhold: "Hvad kommer deltagerne til at opleve – og hvem er det for?",
  leder: "Hvem leder eventet?",
  kontakt: "Må interesserede kontakte underviseren – på e-mail, telefon eller begge dele?",
  medbring: "Skal deltagerne medbringe noget?",
  tid: "Hvornår skal det være?",
  pris: "Hvad skal det koste for medlemmer og for andre?",
  pladser: "Hvor mange kan være med?",
  sociale: "Skal Hjerterum dele eventet på de sociale medier?",
  billeder: "Upload dit eventfoto nu, hvis du har et – det beskæres til 1920 × 1005 px. Har du ikke et endnu, så spring over; du kan altid tilføje det senere ved at redigere eventet."
};

const HINT: Record<(typeof STEPS)[number], (member: string) => string> = {
  titel: () => "4-5 korte, varme titelforslag ud fra brief'et, forskellige i tonen.",
  indhold: () => "4-5 konkrete dele af forløbet og målgrupper, der kan kombineres (fx \"20 min. introduktion til åndedrættet\", \"45 min. guidet breathwork liggende\", \"For begyndere\").",
  leder: (member) => `4-5 svar: "${member}" først (medlemmet selv), så fx "${member} og en gæsteunderviser", "En gæsteunderviser – navn følger".`,
  medbring: () => "4-5 ting, der kan kombineres, og \"Intet – alt er i salen\" (fx \"Yogamåtte\", \"Tæppe\", \"Behageligt tøj\", \"Vandflaske\").",
  // Reported: "Hun skal ikke forslå et tidspunkt der ikke er ledigt" - the free times are worked out by the code (free-times.ts).
  tid: () => "Systemet viser selv de ledige tider som knapper - giv ingen forslag (\"suggestions\": []), og nævn ingen tider selv.",
  pris: () => "4-5 realistiske prispar for medlemmer og andre, der passer til eventet (fx \"Gratis for medlemmer, 100 kr. for andre\", \"80 kr. / 120 kr.\").",
  pladser: () => "4-5 svar: fx \"12\", \"20\", \"30\", \"Ingen grænse\".",
  kontakt: () => `Systemet viser selv knapperne ${GUIDE_CHOICES.kontakt.map(c => `"${c}"`).join(", ")} - giv ingen forslag ("suggestions": []).`,
  sociale: () => `Systemet viser selv knapperne ${GUIDE_CHOICES.sociale.map(c => `"${c}"`).join(" og ")} - giv ingen forslag ("suggestions": []).`,
  billeder: () => `Systemet viser selv knapperne ${GUIDE_CHOICES.billeder.map(c => `"${c}"`).join(" og ")} - giv ingen forslag ("suggestions": []).`
};

const label = (f: EventFacts) => JSON.stringify(Object.fromEntries(Object.entries(f).filter(([key, value]) => value !== null && key !== "description")));

/** The instruction for one turn: what is known (locked), the one step being answered, and what to give back. She does not ask the
 * question herself - the code adds it - so there is always exactly one, with suggestions for it. */
// Requested: "Er eventet upassende bør hun have sagt det tidligere" - she judges the content when she hears it, not after "Opret".
export function guidedPrompt(f: EventFacts, step: Step, member: string): string {
  if (step === "forslag") return "";
  const brief = isBrief(f);
  return `

GUIDET OPRETTELSE (gælder nu - følg det præcist)
Medlemmet opretter et event sammen med dig, ét punkt ad gangen. Rækkefølgen og spørgsmålene styres af systemet, ikke af dig.
KENDTE OPLYSNINGER (låst - spørg aldrig om dem, foreslå aldrig noget nyt til dem): ${label(f)}
${brief ? `Medlemmets første besked er et brief. Tag ALT, medlemmet selv har skrevet, ind i "facts" (titel, indhold, leder, tid, pris osv.) - men find ALDRIG selv på noget, der ikke står der (ingen dato, tid eller pris, medlemmet ikke har nævnt).` : `Medlemmets besked svarer på: "${QUESTION[step]}". Tag svaret ind i "facts" - KUN oplysninger til dette punkt.`}
"reply": højst én kort, varm sætning, der bekræfter det, medlemmet sagde. STIL INGEN SPØRGSMÅL - systemet stiller det næste spørgsmål selv.
Nævn ALDRIG leje, lokalepris eller regler for gratis leje her - det står i formularen, ikke i samtalen.
${brief || step === "indhold" ? `Vurder indholdet mod HJERTERUMS KRITERIER nu. Passer det tydeligt ikke, så sig det venligt og konkret i "reply" (højst to sætninger), og hvad der skal til - fx en tydeligere beskrivelse af forløbet. Ellers nævn ikke vurderingen.` : ""}
"suggestions": svarforslag til det NÆSTE spørgsmål, som systemet stiller bagefter (det næste punkt, der mangler, når dit svar er taget med). Forslagene til hvert punkt:
${STEPS.map(s => `- ${s} ("${QUESTION[s]}"): ${HINT[s](member)}`).join("\n")}
Højst ca. 70 tegn pr. forslag. Skriv forslagene, som medlemmet selv ville svare (fx "Jacob Hauge", ikke "Leder: jeg selv").
"next": navnet på det punkt, dine forslag hører til.
"facts" bruger nøglerne: title, content, audience, leader, bring, date (ÅÅÅÅ-MM-DD), start (TT:MM), end (TT:MM), member_price_kr, non_member_price_kr, max_attendees (0 = ingen grænse), contact ("email", "phone", "both" eller "none"), social (true/false), photo ("skipped" hvis medlemmet springer fotoet over).
Svar KUN med JSON: {"reply":"...","draft":null,"photo_ok":null,"facts":{...},"next":"...","suggestions":["...","...","...","..."]}`;
}

/** The last call: only the description, from the member's own content - the rest of the draft comes from the facts. */
export const DESCRIBE = (f: EventFacts) => `Du er Saga, Hjerterums assistent. Skriv eventbeskrivelsen til Hjerterums kalender ud fra medlemmets egne oplysninger - find ikke på nyt.
Hjerterums tone: varm, nærværende og konkret, 2-4 korte afsnit: hvad sker der, for hvem, hvem leder det (med navn), hvad man medbringer, og hvad det koster (medlemmer/andre). Ingen helbredsløfter, intet råberi, ingen emojis. Titlen står allerede over teksten - gentag den ikke.
Oplysninger: ${label(f)}
Svar KUN med JSON: {"description":"...","reply":"én kort sætning til medlemmet om, at forslaget er klar"}`;

export type GuidedAnswer = { reply: string; learned: Partial<EventFacts>; suggestions: string[]; suggestionsFor: Step | null };

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
  const suggestionsFor = typeof data?.next === "string" && ((STEPS as readonly string[]).includes(data.next) || data.next === "forslag") ? data.next as Step : null;
  // Her own words must not ask anything - the code asks; a question she slipped in is cut off.
  const cut = reply.split(/(?<=[.!])\s+/).filter(sentence => !/\?\s*$/.test(sentence)).join(" ").trim();
  return { reply: cut || "Tak.", learned, suggestions, suggestionsFor };
}
