import type { D1Database } from "../db.js";
import { siteLive, toPublicSite } from "../public-site.js";
import { complete } from "../saga/ai.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { clock, dateOf, dayName } from "./plan.js";
import { firstName, instagramEventText, instagramShareText, type SocialPost } from "./social.js";

/** Requested (the chair, 5 Nov 2026): "Jeg vil gerne have en mulighed for, at AI kan komme med et forslag til delingsteksten. Det skal være en meget moderne
 * sprogmodel, der skriver på en moderne måde, som passer til de forskellige medier, til hjerterums stil og gerne på nye spændende og kærlige måder - ikke
 * kliche". A proposal on a press, in the newest writer model (AI_WRITER_MODEL, else Claude Opus 5.5 in the EU - Sonnet behind it): Facebook's words and
 * Instagram's, each for its medium. Nothing is saved: the words land in the fields, and the chair reads, changes and approves as always. */

export const WRITER_MODEL = "vertex/claude-opus-5-5@eu";

const WRITER_SYSTEM = `Du er Hjerterums tekstforfatter. Hjerterum er en forening og et hus i Guldsmedgade i Aarhus for meditation, yoga, lyd, krop, personlig udvikling og fællesskab - drevet af frivillige, med plads til alle.

Hjerterums stemme: varm, nærværende, jordnær og lidt poetisk uden at blive svævende. Vi taler til én person ad gangen ("du"), som en ven, der har prøvet det selv. Vi er nysgerrige og kærlige, aldrig sælgende.

Skriv nyt hver gang. Find én konkret, sanselig detalje eller et uventet, ømt perspektiv i det, du får - lyden af gongen, den første langsomme vejrtrækning, tæppet over benene, at man må komme træt - og byg teksten op om den. Lad rytmen veksle: korte sætninger og en enkelt længere.

Undgå klicheer og tomme ord. Brug aldrig: "rejse indad", "find din indre ro", "giv dig selv en gave", "unik mulighed", "lad dig forkæle", "magisk", "transformerende", "sjælen", "healende rejse", "Oplev ...", "Glæd dig til ...", "Kom og vær med", "Vi glæder os til at se dig", "noget helt særligt", "i trygge rammer", "tid til dig selv". Ingen helbredsløfter. Find aldrig på fakta, der ikke står i det, du får (ingen priser, materialer eller oplevelser, der ikke er nævnt).

Dansk som en dansk tekstforfatter skriver det, aldrig oversat engelsk: sammensatte ord i ét ord (lydhealing, yogaforløb), hele sætninger med udsagnsord, dansk kommatering, kun underviserens fornavn, tid som "lørdag kl. 13.00".

Emojis (formanden, 6. nov. 2026: "må i øvrigt meget gerne komme med passende emojis, og gerne nogle, der er baseret i naturen eller begejstring og kærlighed"): brug dem gerne, men med omtanke - hver emoji skal passe til netop dette event. Vælg fra naturen (🌿 🍃 🌱 🌸 🌾 🍂 🌊 🌙 ☀️ 🌳 🪷 🕊️) eller begejstring og kærlighed (🤍 💛 🧡 ✨ 🙌 🥰 💫). Sæt dem ved en sætnings slutning eller som en lille markør, aldrig midt i et ord eller flere i træk.

Hvert medie sin form:
- "facebook": 2-4 korte sætninger, højst 60 ord. Første sætning skal kunne stå alene i feedet. Sig hvad, hvem og hvornår, så det er til at handle på. Ingen hashtags, ingen links (linket sættes på af systemet), 1-2 emojis.
- "instagram": en første linje på højst 8 ord, der får én til at stoppe med at scrolle (den vises før "mere"). Derefter 2-4 luftige korte afsnit med en tom linje imellem. Hvem, hvad og hvornår skal stå der. 2-4 emojis fordelt i teksten. Slut med 2-4 præcise hashtags på sidste linje (fx #aarhus og et for emnet), ingen generiske som #love. Skriv ikke "link i bio" og ingen adresse - det sættes på af systemet.
Facebook og Instagram må gerne være forskellige: samme sandhed, hver sin vinkel.

Svar KUN med JSON: {"facebook": "...", "instagram": "..."}`;

const SHARE_RULES = `Det her er en deling: en underviser eller en anden har lavet opslaget og tagget Hjerterum. Hjerterums ord sættes over delingen.
- "facebook": 1-2 korte sætninger, højst 30 ord: et kærligt, konkret skulderklap til personen (fornavn) og hvad opslaget handler om.
- "instagram": det samme i Instagrams form, højst 40 ord, gerne en første linje, der fanger. Ingen hashtags her: "Foto: @navn" sættes på af systemet.`;

const longDay = (ms: number) => { const [, m, d] = dateOf(ms).split("-"); return `${dayName(ms)} d. ${Number(d)}. ${["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober", "november", "december"][Number(m) - 1]} kl. ${clock(ms)}`; };

/** The event's own description - from the calendar or the house's own booking. */
async function description(db: D1Database, key: string | undefined): Promise<string> {
  if (!key) return "";
  const row = key.startsWith("mw:")
    ? await db.prepare("SELECT description, category FROM house_events WHERE id = ?").bind(key.slice(3)).first<{ description: string | null; category: string | null }>().catch(() => null)
    : key.startsWith("hr:") ? await db.prepare("SELECT description, NULL AS category FROM room_bookings WHERE id = ?").bind(Number(key.slice(3))).first<{ description: string | null; category: string | null }>().catch(() => null) : null;
  const text = (row?.description ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  // The teacher's own words from a PR mail linked to the event (cockpit/mailMaterial.ts).
  const own = await db.prepare("SELECT text FROM event_material WHERE event_key = ? AND kind = 'text' ORDER BY id DESC LIMIT 1").bind(key).first<{ text: string }>().catch(() => null);
  return [row?.category ? `Kategori: ${row.category}.` : "", text.slice(0, 1500), own?.text ? `Underviserens egen tekst (fra deres mail): ${own.text.replace(/\s+/g, " ").slice(0, 1200)}` : ""].filter(Boolean).join(" ");
}

/** Where to sign up goes above the hashtags, which end the post. */
export function withSignUp(text: string): string {
  const lines = text.trim().split("\n");
  const tags = lines.length > 1 && /^#/.test(lines[lines.length - 1]!.trim()) ? lines.pop()!.trim() : "";
  const body = instagramEventText(lines.join("\n"));
  return tags ? `${body}\n\n${tags}` : body;
}

export type Proposal = { text: string; instagramText: string };

/** Saga's proposal for a post's words (an event's post or a share); null when the AI is not set up or does not answer. */
export async function proposeWords(env: SagaEnv, deps: SagaDeps, db: D1Database, post: SocialPost, wish = ""): Promise<Proposal | null> {
  if (!env.AI_API_KEY || !env.AI_MODEL || (post.kind !== "event" && post.kind !== "share")) return null;
  const s = post.source;
  const facts = post.kind === "event"
    ? { event: s.title, underviser: s.host ? firstName(s.host) : null, hvornaar: s.startsMs ? longDay(s.startsMs) : null, beskrivelse: await description(db, s.key) || null }
    : { fra: s.author, netvaerk: s.network, deres_tekst: (s.text ?? "").slice(0, 1500) };
  const user = [
    JSON.stringify(facts),
    `Det nuværende udkast (gentag ikke formuleringerne, skriv noget nyt):\nFacebook: ${post.text}\nInstagram: ${s.instagramText ?? ""}`,
    wish.trim() ? `Formandens ønske til denne version: ${wish.trim().slice(0, 300)}` : "",
  ].filter(Boolean).join("\n\n");
  const raw = await complete(env, deps, [{ role: "system", content: post.kind === "share" ? `${WRITER_SYSTEM}\n\n${SHARE_RULES}` : WRITER_SYSTEM }, { role: "user", content: user }],
    { purpose: "social-writer", model: env.AI_WRITER_MODEL || WRITER_MODEL, maxTokens: 6000 }).catch(() => "");
  const json = /\{[\s\S]*\}/.exec(raw)?.[0];
  let data: { facebook?: unknown; instagram?: unknown } = {};
  try { data = json ? JSON.parse(json) as typeof data : {}; } catch { /* no proposal */ }
  const clean = (v: unknown, max: number) => typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max) : "";
  const facebook = clean(data.facebook, 1200), instagram = clean(data.instagram, 1800);
  if (!facebook) return null;
  // Instagram's ending is the house's own (where to sign up; whose post it is) - as when Saga first wrote the post.
  const live = await siteLive(db);
  const instagramText = post.kind === "event" ? await toPublicSite(db, withSignUp(instagram || facebook), live)
    : instagramShareText(instagram || facebook, s.author ?? null, "", s.network === "facebook" ? "facebook" : "instagram");
  return { text: facebook, instagramText };
}
