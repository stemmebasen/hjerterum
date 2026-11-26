import type { D1Database } from "../db.js";
import { complete } from "../saga/ai.js";
import type { ChatPart, ChatMessage } from "../saga/ai.js";
import { currentSiteForSaga } from "../site-knowledge.js";
import { WRITER_MODEL } from "../social/writer.js";
import { ROOM_RENTAL_RULES } from "../../../../packages/core/src/legacy-room-pricing.js";
import { allDecisions, approvedMinutes, boardPicture } from "./data.js";
import { decisionKinds, withKinds } from "./decisionKinds.js";
import { membershipFacts } from "./membership.js";
import { POWERS } from "./authority.js";
import { MENU } from "./page.js";
import { RECENT_CHANGES } from "./recent-changes.generated.js";
import { SITE_PAGES } from "../../site/pages.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { telegramClient } from "../saga/telegram.js";
import { esc, layout } from "./page.js";

/** Asked (the chair, 24 Nov 2026): "Jeg får en masse feedback fra Douglas. Er det muligt han på en eller måde kan chatte med ai om ændringerne - og så
 * ligger den endelig implementering og godkendelse stadig hos mig?" - "Ja".
 *
 * Admin → Ønsker og fejl. Douglas (and the chair) talks a wish or a fault through with Saga, in his own words and language, with a screenshot if he
 * likes. Saga asks until it is clear and writes it as one wish; he sends it to the chair, who approves or turns it down with a note. Nothing on the
 * website changes from here: the approved wishes are what the chair hands on to be made (the list at the bottom), and the chair marks them done.
 * Saga answers questions about how things work from what she is told below - and says so when she does not know.
 *
 * Then (the chair, 24 Nov 2026): "Men tager hun blot imod diktat eller kan hun forstå hvad han forslår og lytte kritisk? Tænker bare det skal være en
 * chat som her" - "Ja": she is a critical sparring partner in the best model, knows the board's decisions, the website's words, the rules for renting
 * and membership, and reads a page of hjerterum.info that is named; the conversation is a live chat (no reload), and a wish can be dropped. */

export type WishStatus = "open" | "sent" | "approved" | "rejected" | "done" | "dropped";
export type Wish = { id: number; author: string; status: WishStatus; title: string | null; summary: string | null; chair_note: string | null; decided_by: string | null;
  decided_at_ms: number | null; sent_at_ms: number | null; done_at_ms: number | null; created_at_ms: number; updated_at_ms: number;
  /** Jewel's sorting: fejl, forbedring or ny funktion; her guess at the size; and when it is done, one point a line. */
  kind?: string | null; size?: string | null; done_when?: string | null };
export type WishMessage = { id: number; wish_id: number; role: "person" | "saga"; author: string | null; text: string; image_key: string | null; image_type: string | null; at_ms: number };

export const STATUS_TEXT: Record<WishStatus, string> = { open: "Under samtale", sent: "Venter på godkendelse", approved: "Godkendt", rejected: "Afvist", done: "Lavet", dropped: "Opgivet" };
const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TEXT = 4000;

export async function listWishes(db: D1Database): Promise<Wish[]> {
  return (await db.prepare("SELECT * FROM wishes ORDER BY CASE status WHEN 'sent' THEN 0 WHEN 'open' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END, updated_at_ms DESC LIMIT 300").all<Wish>()).results ?? [];
}
export async function wishById(db: D1Database, id: number): Promise<Wish | null> {
  return db.prepare("SELECT * FROM wishes WHERE id = ?").bind(id).first<Wish>();
}
export async function wishMessages(db: D1Database, id: number): Promise<WishMessage[]> {
  return (await db.prepare("SELECT * FROM wish_messages WHERE wish_id = ? ORDER BY id").bind(id).all<WishMessage>()).results ?? [];
}
/** A new conversation - or the person's own one that has not begun yet, so empty ones do not pile up. */
export async function newWish(db: D1Database, author: string, nowMs: number): Promise<number> {
  const empty = await db.prepare(`SELECT id FROM wishes w WHERE author = ? AND status = 'open' AND NOT EXISTS (SELECT 1 FROM wish_messages m WHERE m.wish_id = w.id)
    ORDER BY id DESC LIMIT 1`).bind(author).first<{ id: number }>();
  if (empty) return empty.id;
  const made = await db.prepare("INSERT INTO wishes (author, status, created_at_ms, updated_at_ms) VALUES (?, 'open', ?, ?)").bind(author, nowMs, nowMs).run();
  return Number(made.meta?.last_row_id);
}
async function addMessage(db: D1Database, wishId: number, role: "person" | "saga", author: string | null, text: string, nowMs: number, image?: { key: string; type: string }): Promise<number> {
  const made = await db.prepare("INSERT INTO wish_messages (wish_id, role, author, text, image_key, image_type, at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(wishId, role, author, text, image?.key ?? null, image?.type ?? null, nowMs).run();
  await db.prepare("UPDATE wishes SET updated_at_ms = ? WHERE id = ?").bind(nowMs, wishId).run();
  return Number(made.meta?.last_row_id);
}

/** What Jewel knows about the new system - kept short and true; what is not here she does not guess at. */
const KNOWLEDGE = `Hjerterums nye system (november 2026):
- Hjemmesiden www.hjerterum.info: forside, kalender og events, medlemskab (niveauer, fordele, vilkår), Brug Hjerterum (lejepriser og prisberegner), Om Hjerterum, Kontakt og Støt Hjerterum (donationer). "EN"-knappen oversætter siden med Google Oversæt - der er ingen egne engelske sider, så underlige engelske ord skyldes ofte Google.
- Medlemssiden medlem.hjerterum.info (Min side): profil, medlemskab, kalender med tilmelding (1-6 personer på én gang ved gratis events; betalte events én billet ad gangen), og "Mine events", hvor medlemmer selv opretter events.
- Eventplanlæggeren: en dato, tider i halve timer, klargøring og oprydning (0-60 min.) lejes med. Salen lejes 2-10 timer i træk med klargøring og oprydning, og alt skal være slut kl. 24. Et event kan vare op til 4 dage i træk med samme tider hver dag. Lejetyper: Standard (fast pris), Reduceret (medlemmer betaler mindre for at deltage) og Gratis leje (medlemmer deltager gratis). Med Reduceret eller Gratis må en booking på en hverdag ikke gå hen over kl. 18.30; i weekenden gælder aftentaksten hele dagen. Prikken i datovælgeren betyder, at der allerede er noget i kalenderen.
- Et medlems event vises først offentligt, når det er godkendt. Arrangøren får en mail ved hver tilmelding (kan slås fra) og kan skrive sin egen besked til deltagernes bekræftelse. Beskrivelsen skrives i et felt med fed, kursiv, punktlister, links og emojis.
- Gæster kan tilmelde sig gratis events uden login. Afmelding: medlemmer selv under Kalender; gæster skriver til arrangøren.
- Kortbetaling (Stripe) er ikke slået til endnu. Det, der venter på det: betaling for ikke-medlemmer ved events, indmeldelse og skift af medlemskab i det nye system, donation med kort. Indtil da sker indmeldelse i MembershipWorks, og donationer sker med MobilePay eller bankoverførsel.
- Overgangen fra MembershipWorks sker på én dag med knappen Overgang i admin: alle medlemmer flyttes på én gang, ingen skal selv gøre noget, og den, der betaler med kort, betaler videre i MembershipWorks til næste fornyelse. At det nye system overtager kortbetalingen, er endnu ikke bygget (kræver Stripe).
- Admin (admin.hjerterum.info): Medlemsoverblik (søgning på navn, e-mail, telefon og labels, filtre, eksport, medlemskort med historik, labels og fornyelsesdato), Medlemskaber (navne, beskrivelser, priser, prøveperiode - 0 dage som udgangspunkt - og restance-regel), Events, PR og SoMe (Sagas opslag på Facebook og Instagram; ugens reel går ud af sig selv), Posthus, Nyhedsbrev og Bestyrelse.
- Priser og regler for leje og medlemskab ændres kun efter en beslutning i bestyrelsen.`;

/** The chair (25 Nov 2026): "Kan vi kalde udviklings agenten noget andet end Saga? Og gøre hende mere specialiseret?" - "Vi tager Jewel". */
export const AGENT = "Jewel";

const SYSTEM = `Du er Jewel, Hjerterums produktudvikler. Du arbejder i admin under "Forslag til udvikling", hvor et medlem af bestyrelsen taler med dig om et forslag til Hjerterums system - hjemmesiden www.hjerterum.info, medlemssiden (Min side) eller admin - eller om en fejl, de har fundet. Du er ikke Saga (bestyrelsens assistent); spørger personen om andet end systemet (bestyrelsens arbejde, events, medlemmer, økonomi), så sig venligt, at det kan Saga hjælpe med under "Spørg Saga".

Et sendt forslag går direkte videre til udvikling; du ændrer ikke selv noget og lover aldrig, hvornår noget bliver lavet. Nævn aldrig "formanden".

Din personlighed (the chair, 25 Nov 2026: "Give her a charming witty and Londoner personality"): du er en charmerende, kvik londoner - varm, hurtig i replikken og med et glimt i øjet. Tør, britisk humor og en let selvironi; du bliver aldrig sur, og humoren er aldrig på personens bekostning. På engelsk taler du som en venlig londoner ("lovely", "brilliant", "right then", "fancy a ...", "bob's your uncle", "cheers") - naturligt og med måde, ikke som en tegnefilm, og aldrig så det gør dig svær at forstå. På dansk taler du godt, venligt dansk med et lille engelsk krydderi en gang imellem ("lovely!", "brilliant"). Højst én lille spøg eller vending pr. svar, og kun når den passer - er nogen frustrerede over en fejl, så er du først og fremmest hjælpsom. Charmen gælder samtalen: selve forslaget ("oenske") skrives klart, sagligt og uden spøg.

Du tænker som en erfaren produktudvikler - kritisk og varm, aldrig en sekretær, der tager diktat:
- Hvem er det for (medlemmer, gæster, undervisere, bestyrelsen), og hvad skal det løse? Spørg til formålet, når det ikke er klart.
- Findes det allerede, eller er det lavet for nylig? Se i håndbogen og listen over de seneste ændringer herunder, og sig det - med hvor man finder det.
- Strider det mod en beslutning i bestyrelsen, en regel for leje eller medlemskab, eller noget andet i systemet? Hvad kan det gå ud over (telefonen, engelsk via Google Oversæt, undervisere, admin)? Er der en enklere løsning, der giver det samme?
- Sig din mening, også når du er uenig - venligt og med en begrundelse - og foreslå at lade det falde, når det ikke giver mening. Men det er personens forslag: vil de stadig, så skriv det - med din indvending i beskrivelsen.
- Er det en fejl, så find ud af præcis hvor (hvilken side, telefon eller computer, dansk eller engelsk), hvad personen gjorde, hvad der skete, og hvad de havde ventet. Mange fejl på engelsk skyldes Google Oversæt.
- Spørger personen, hvordan noget virker, så svar ud fra håndbogen og det, du ved herunder. Ved du det ikke, så sig det ærligt, og skriv spørgsmålet med i forslaget. Du kan ikke se koden.
- Én ting pr. forslag. Har personen flere, så tag dem én ad gangen.

Skriv som i en chat, på personens eget sprog (engelsk til den, der skriver engelsk): højst 2-4 korte sætninger og højst ét spørgsmål pr. svar. Det vigtigste først. Ingen indledninger, ingen opremsninger, ingen gentagelse af det, personen lige har skrevet. Kun når personen beder om en forklaring, må du skrive længere.

Når forslaget er klart og gennemtænkt (eller personen beder dig skrive det), så skriv det som en udvikler kan gå direkte i gang med det, på personens sprog:
- "titel": kort, højst 80 tegn.
- "type": "fejl", "forbedring" eller "ny funktion".
- "stoerrelse": dit bud - "lille" (en tekst, en farve, en enkelt ting på én side), "mellem" (en ændring i en funktion eller flere sider) eller "stor" (en ny funktion eller noget, der rører betaling, medlemmer eller data).
- "beskrivelse": hvor, hvad der sker nu, hvad der ønskes og hvorfor, personens egne ord, hvor de siger det bedst, og dine eventuelle indvendinger. Ved en fejl: trin for trin, hvordan den opstår.
- "faerdig_naar": 2-5 korte punkter, der kan tjekkes bagefter ("Knappen er synlig på telefonen", ...).

Svar KUN med JSON: {"svar": "dit svar til personen", "oenske": null}
- eller, når forslaget er skrevet: {"svar": "kort: her er forslaget - ret gerne, eller send det", "oenske": {"titel": "...", "type": "...", "stoerrelse": "...", "beskrivelse": "højst 1500 tegn", "faerdig_naar": ["...", "..."]}}`;

/** The system as it is built, from the code itself: the admin menu with who may use what, and the website's pages. */
export function systemHandbook(): string {
  const access = (power?: string) => {
    if (!power) return "";
    const spec = (POWERS as Record<string, { needs: string; also?: readonly string[] }>)[power];
    return spec ? ` (begrænset adgang${spec.also?.length ? `; også ${spec.also.join(", ")}` : ""})` : "";
  };
  const admin = MENU.map(g => `- ${g.label}: ${g.items.map(i => `${i.label}${access(i.power)}`).join(", ")}`).join("\n");
  const site = SITE_PAGES.map(p => `- ${p.path} - ${p.title}${p.lead ? `: ${p.lead.slice(0, 140)}` : ""}`).join("\n");
  return `ADMIN (admin.hjerterum.info) - menuen:\n${admin}\n\nHJEMMESIDENS SIDER (www.hjerterum.info):\n${site}`;
}

/** What has been made lately (written at each deploy from the code's history), newest first. */
export const recentChanges = () => RECENT_CHANGES.length ? RECENT_CHANGES.slice(0, 120).join("\n") : "(ikke tilgængelig)";

/** What else Jewel knows: the board's decisions, the rules for renting and membership, the website's words that fit the conversation, and the
 * page of hjerterum.info the person named (read now). */
async function knowledgeFor(env: SagaEnv, deps: SagaDeps, db: D1Database, said: string): Promise<string> {
  const [minutes, { picture }, kinds] = await Promise.all([approvedMinutes(db).catch(() => []), boardPicture(db, deps.now()).catch(() => ({ picture: null })), decisionKinds(db).catch(() => new Map())]);
  const decisions = withKinds(allDecisions(minutes, picture), kinds as never).filter(x => x.kind !== "aftale").slice(0, 60)
    .map(x => `- ${x.date ? `${x.date}: ` : ""}${x.topic ? `${x.topic}: ` : ""}${x.text}`).join("\n");
  const page = await namedPage(deps, said);
  return [`BESTYRELSENS BESLUTNINGER (nyeste først):\n${decisions || "(ingen)"}`, `MEDLEMSKAB:\n${membershipFacts()}`, `LEJE AF SALEN - PRISER OG REGLER:\n${ROOM_RENTAL_RULES}`,
    `HJEMMESIDEN (det, der passer til samtalen):\n${currentSiteForSaga(said, 14_000)}`, page].filter(Boolean).join("\n\n");
}

/** The last page of the public website named in the conversation, as text - only www.hjerterum.info, read as a search engine reads it. */
export async function namedPage(deps: SagaDeps, said: string): Promise<string> {
  const urls = [...said.matchAll(/https?:\/\/(?:www\.)?hjerterum\.info(\/[^\s<>"')]*)?/gi)];
  const last = urls.at(-1);
  if (!last) return "";
  const path = (last[1] ?? "/").replace(/[.,;:!?]+$/, "");
  const response = await deps.fetcher(`https://www.hjerterum.info${path}`, { headers: { "user-agent": "Jewel (Hjerterum admin)" } }).catch(() => null);
  if (!response?.ok) return "";
  const html = await response.text().catch(() => "");
  const body = /<div data-prerender>([\s\S]*?)<\/div>\s*<\/div>/.exec(html)?.[1] ?? html;
  const text = body.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<\/(p|h[1-6]|li|div)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  return text ? `SIDEN https://www.hjerterum.info${path} (læst nu):\n${text.slice(0, 8000)}` : "";
}

/** A picture as a data URL for the AI. */
function dataUrl(bytes: ArrayBuffer, type: string): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
}

export type SagaWishAnswer = { reply: string; wish: { title: string; summary: string; kind?: string | null; size?: string | null; doneWhen?: string[] } | null };

/** Jewel's answer to the conversation so far - the last three pictures are shown to her. */
export async function sagaOnWish(env: SagaEnv, deps: SagaDeps, db: D1Database, wish: Wish, messages: WishMessage[]): Promise<SagaWishAnswer> {
  const others = (await listWishes(db)).filter(w => w.id !== wish.id && w.title).slice(0, 60)
    .map(w => `- #${w.id} ${w.title} (${STATUS_TEXT[w.status]})`).join("\n");
  const withPictures = new Set(messages.filter(m => m.image_key).slice(-3).map(m => m.id));
  const turns: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === "saga") { turns.push({ role: "assistant", content: m.text }); continue; }
    const text = `${m.author ?? "Personen"}: ${m.text || "(skærmbillede)"}`;
    const picture = m.image_key && withPictures.has(m.id) && env.BOARD_RECORDINGS ? await env.BOARD_RECORDINGS.get(m.image_key).catch(() => null) : null;
    turns.push({ role: "user", content: picture && m.image_type ? [{ type: "text", text } as ChatPart, { type: "image_url", image_url: { url: dataUrl(await picture.arrayBuffer(), m.image_type) } }] : text });
  }
  const said = messages.map(m => m.text).join("\n");
  const system = [SYSTEM, `${KNOWLEDGE}`, `HÅNDBOG OVER SYSTEMET:\n${systemHandbook()}`, `DE SENESTE ÆNDRINGER (nyeste først, dato og hvad der blev lavet - på engelsk):\n${recentChanges()}`,
    await knowledgeFor(env, deps, db, said), `TIDLIGERE FORSLAG:\n${others || "(ingen endnu)"}`,
    wish.title ? `DIT NUVÆRENDE UDKAST TIL DETTE FORSLAG:\nTitel: ${wish.title}\n${wish.kind ? `Type: ${wish.kind} · størrelse: ${wish.size ?? "?"}\n` : ""}${wish.summary ?? ""}${wish.done_when ? `\nFærdigt når:\n${wish.done_when}` : ""}` : ""].filter(Boolean).join("\n\n");
  // "Den bedste model" (the chair, 24 Nov 2026) - the writer's model, never moved down by the day's budget.
  const raw = await complete(env, deps, [{ role: "system", content: system }, ...turns], { purpose: "oensker", model: env.AI_WRITER_MODEL || WRITER_MODEL, important: true, maxTokens: 2500 });
  const json = /\{[\s\S]*\}/.exec(raw)?.[0];
  let data: { svar?: unknown; oenske?: { titel?: unknown; beskrivelse?: unknown; type?: unknown; stoerrelse?: unknown; faerdig_naar?: unknown } | null } = {};
  try { data = json ? JSON.parse(json) : {}; } catch { data = {}; }
  const reply = typeof data.svar === "string" && data.svar.trim() ? data.svar.trim().slice(0, 3000) : raw.replace(/\{[\s\S]*\}/, "").trim().slice(0, 3000);
  const title = typeof data.oenske?.titel === "string" ? data.oenske.titel.trim().slice(0, 120) : "";
  const summary = typeof data.oenske?.beskrivelse === "string" ? data.oenske.beskrivelse.trim().slice(0, 2500) : "";
  const kind = typeof data.oenske?.type === "string" && /^(fejl|forbedring|ny funktion)$/i.test(data.oenske.type.trim()) ? data.oenske.type.trim().toLowerCase() : null;
  const size = typeof data.oenske?.stoerrelse === "string" && /^(lille|mellem|stor)$/i.test(data.oenske.stoerrelse.trim()) ? data.oenske.stoerrelse.trim().toLowerCase() : null;
  const doneWhen = Array.isArray(data.oenske?.faerdig_naar) ? (data.oenske!.faerdig_naar as unknown[]).filter((x): x is string => typeof x === "string" && Boolean(x.trim())).map(x => x.trim().slice(0, 200)).slice(0, 6) : [];
  return { reply: reply || "…", wish: title && summary ? { title, summary, kind, size, doneWhen } : null };
}

export type WishInput = { text: string; image?: File | null };
export type WishError = "empty" | "image_type" | "image_size" | "closed" | "ai";

/** The person writes; Jewel answers (and, when it is clear, writes the wish). */
export async function talkAboutWish(env: SagaEnv, deps: SagaDeps, db: D1Database, wish: Wish, who: string, input: WishInput): Promise<WishError | null> {
  if (wish.status !== "open") return "closed";
  const text = input.text.trim().slice(0, MAX_TEXT);
  const file = input.image && input.image.size > 0 ? input.image : null;
  if (!text && !file) return "empty";
  if (file && !IMAGE_TYPES[file.type]) return "image_type";
  if (file && file.size > MAX_IMAGE_BYTES) return "image_size";
  const now = deps.now();
  let image: { key: string; type: string } | undefined;
  if (file && env.BOARD_RECORDINGS) {
    const key = `oensker/${wish.id}/${now}-${crypto.randomUUID().slice(0, 8)}.${IMAGE_TYPES[file.type]}`;
    await env.BOARD_RECORDINGS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
    image = { key, type: file.type };
  }
  await addMessage(db, wish.id, "person", who, text, now, image);
  if (!env.AI_API_KEY || !env.AI_MODEL) {
    await addMessage(db, wish.id, "saga", AGENT, "Jeg kan ikke svare lige nu (min AI er ikke sat op). Det, du har skrevet, er gemt.", deps.now());
    return null;
  }
  try {
    const answer = await sagaOnWish(env, deps, db, wish, await wishMessages(db, wish.id));
    await addMessage(db, wish.id, "saga", AGENT, answer.reply, deps.now());
    if (answer.wish) await db.prepare("UPDATE wishes SET title = ?, summary = ?, kind = ?, size = ?, done_when = ?, updated_at_ms = ? WHERE id = ? AND status = 'open'")
      .bind(answer.wish.title, answer.wish.summary, answer.wish.kind ?? null, answer.wish.size ?? null, answer.wish.doneWhen?.length ? answer.wish.doneWhen.join("\n") : null, deps.now(), wish.id).run();
    return null;
  } catch {
    return "ai";
  }
}

/** The person sends the wish to the chair - and the chair hears it on Telegram. */
/** Then (the chair, 26 Nov 2026): "We don't need that buffer. He has high authority, so whatever he says is something to work with." A sent request is
 * approved at once, by the one who sent it; the chair hears of it and can still turn it down. */
export async function sendWish(env: SagaEnv, deps: SagaDeps, db: D1Database, wish: Wish, cockpitUrl: string): Promise<boolean> {
  if (wish.status !== "open" || !wish.title || !wish.summary) return false;
  const now = deps.now();
  const changed = await db.prepare("UPDATE wishes SET status = 'approved', sent_at_ms = ?, decided_by = ?, decided_at_ms = ?, updated_at_ms = ? WHERE id = ? AND status = 'open'")
    .bind(now, wish.author, now, now, wish.id).run();
  if (!changed.meta?.changes) return false;
  if (env.SAGA_TELEGRAM_BOT_TOKEN && env.SAGA_OWNER_TELEGRAM_ID)
    await telegramClient(env, deps).sendMessage(env.SAGA_OWNER_TELEGRAM_ID, `${wish.author} har sendt et forslag til udvikling: »${wish.title}«. Det går direkte videre til udvikling.\n\nSe det her (du kan stadig afvise det): ${cockpitUrl}/forslag/${wish.id}`).catch(() => undefined);
  return true;
}

/** A short message to the one who made the request, on Telegram, when Saga knows them there. */
async function tellAuthor(env: SagaEnv, deps: SagaDeps, db: D1Database, author: string, text: string): Promise<void> {
  if (!env.SAGA_TELEGRAM_BOT_TOKEN) return;
  const person = await db.prepare("SELECT telegram_id FROM cockpit_login_links WHERE member = ? AND telegram_id IS NOT NULL ORDER BY created_at_ms DESC LIMIT 1")
    .bind(author).first<{ telegram_id: string }>().catch(() => null);
  if (person?.telegram_id) await telegramClient(env, deps).sendMessage(person.telegram_id, text).catch(() => undefined);
}

/** The chair approves or turns down a wish - also one already approved when it was sent; the one who wished hears it on Telegram, when Saga knows them there. */
export async function decideWish(env: SagaEnv, deps: SagaDeps, db: D1Database, wish: Wish, approve: boolean, note: string, by: string, cockpitUrl: string): Promise<boolean> {
  if (!["sent", "open", "approved"].includes(wish.status)) return false;
  const now = deps.now();
  const clean = note.trim().slice(0, 1500) || null;
  const changed = await db.prepare("UPDATE wishes SET status = ?, chair_note = ?, decided_by = ?, decided_at_ms = ?, updated_at_ms = ? WHERE id = ? AND status IN ('sent', 'open', 'approved')")
    .bind(approve ? "approved" : "rejected", clean, by, now, now, wish.id).run();
  if (!changed.meta?.changes) return false;
  if (wish.author !== by)
    await tellAuthor(env, deps, db, wish.author, `Your development request »${wish.title ?? `#${wish.id}`}« was ${approve ? "approved" : "not approved"}.${clean ? `\n\n${clean}` : ""}\n\n${cockpitUrl}/forslag/${wish.id}`);
  return true;
}

/** Made and on the site - the one who made the request hears it. */
export async function markWishDone(env: SagaEnv, deps: SagaDeps, db: D1Database, wish: Wish, cockpitUrl: string): Promise<boolean> {
  if (wish.status !== "approved") return false;
  const now = deps.now();
  const changed = await db.prepare("UPDATE wishes SET status = 'done', done_at_ms = ?, updated_at_ms = ? WHERE id = ? AND status = 'approved'").bind(now, now, wish.id).run();
  if (!changed.meta?.changes) return false;
  await tellAuthor(env, deps, db, wish.author, `Your development request »${wish.title ?? `#${wish.id}`}« is done and on the site now.\n\n${cockpitUrl}/forslag/${wish.id}`);
  return true;
}

/** Asked (the chair, 24 Nov 2026): the approved requests are fetched by the one who makes them, and marked done when they are on the site - "så skal du bare
 * skrive: lav de godkendte forslag". GET …/udvikling/api/forslag gives the approved ones; POST …/udvikling/api/forslag/:id/lavet marks one done. A bearer
 * secret (DEV_REQUESTS_TOKEN) is the key; without it the address is not there. The code is public, so the requests stay here and not in GitHub. */
export async function requestsApi(request: Request, env: SagaEnv, deps: SagaDeps, db: D1Database, path: string, cockpitUrl: string): Promise<Response | null> {
  const match = /^\/udvikling\/api\/forslag(?:\/(\d+)\/lavet)?$/.exec(path);
  if (!match) return null;
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
  const token = env.DEV_REQUESTS_TOKEN ?? "";
  const sent = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  // Says which side is missing (the repo is public, so that the address exists is no secret): admin without its key, or a wrong key sent.
  if (token.length < 24) return json({ error: "admin_has_no_key" }, 503);
  if (!sameSecret(sent, token)) return json({ error: "not_found", sent_key: sent ? "wrong" : "none" }, 404);
  if (!match[1] && request.method === "GET") {
    const approved = (await listWishes(db)).filter(w => w.status === "approved");
    return json({ forslag: approved.map(w => ({ id: w.id, fra: w.author, titel: w.title, beskrivelse: w.summary, type: w.kind ?? null, stoerrelse: w.size ?? null, faerdig_naar: w.done_when ? w.done_when.split("\n") : [], note: w.chair_note, godkendt: w.decided_at_ms ? new Date(w.decided_at_ms).toISOString() : null, admin: `${cockpitUrl}/forslag/${w.id}` })) });
  }
  if (match[1] && request.method === "POST") {
    const wish = await wishById(db, Number(match[1]));
    if (!wish) return json({ error: "not_found" }, 404);
    if (wish.status === "done") return json({ ok: true, status: "done" });
    return await markWishDone(env, deps, db, wish, cockpitUrl) ? json({ ok: true, status: "done" }) : json({ error: "not_approved", status: wish.status }, 409);
  }
  return json({ error: "method_not_allowed" }, 405);
}

/** Compares two secrets without telling, by the time it takes, how much of them was right. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < y.length; i++) diff |= (x[i] ?? 0) ^ y[i]!;
  return diff === 0;
}

const WHEN = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" });
const DAY = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "long", timeZone: "Europe/Copenhagen" });

/** The approved wishes not yet made, as one text to hand on to be made. */
export function approvedText(wishes: Wish[]): string {
  return wishes.filter(w => w.status === "approved").map(w => [`Forslag #${w.id} fra ${w.author}, godkendt ${w.decided_at_ms ? DAY.format(w.decided_at_ms) : ""}: ${w.title ?? ""}`,
    w.kind ? `Type: ${w.kind}${w.size ? ` · størrelse: ${w.size}` : ""}` : "", w.summary ?? "", w.done_when ? `Færdigt når:\n${w.done_when.split("\n").map(x => `- ${x}`).join("\n")}` : "",
    w.chair_note ? `Note: ${w.chair_note}` : ""].filter(Boolean).join("\n")).join("\n\n---\n\n");
}

const KIND_TEXT: Record<string, string> = { "fejl": "Fejl", "forbedring": "Forbedring", "ny funktion": "Ny funktion" };
const SIZE_TEXT: Record<string, string> = { lille: "Lille opgave", mellem: "Mellemstor opgave", stor: "Stor opgave" };
const badge = (s: WishStatus) => `<span class="w-status w-${s}">${STATUS_TEXT[s]}</span>`;

export function wishesPage(base: string, who: string | null, d: { wishes: Wish[]; chair: boolean; notice: string }): string {
  const row = (w: Wish) => `<li><a href="${base}/forslag/${w.id}"><b translate="no">${esc(w.title ?? "Nyt forslag - under samtale")}</b></a> ${badge(w.status)}<small>#${w.id} · ${esc(w.author)} · ${esc(WHEN.format(w.updated_at_ms))}</small></li>`;
  const group = (title: string, list: Wish[], empty: string) => `<section class="card"><h2>${title}</h2>${list.length ? `<ul class="w-list">${list.map(row).join("")}</ul>` : `<p class="muted small">${empty}</p>`}</section>`;
  // The chair (24 Nov 2026): "Der er ikke nogen grund til at gemme en samtale i 'Under samtale'" - the overview shows what has been sent and what came of it.
  const waiting = d.wishes.filter(w => w.status === "sent"), approved = d.wishes.filter(w => w.status === "approved");
  const closed = d.wishes.filter(w => w.status === "rejected" || w.status === "done" || w.status === "dropped");
  const forMaking = d.chair && approved.length ? `<section class="card" id="til-udvikling"><h2>Godkendte forslag samlet</h2>
<p class="small muted">Kopiér teksten, og giv den videre, når forslagene skal laves. Markér hvert forslag som lavet, når det er på siden.</p>
<textarea class="w-copy" rows="10" readonly translate="no">${esc(approvedText(approved))}</textarea>
<p><button type="button" class="ghost" onclick="const t=this.closest('section').querySelector('textarea');t.select();navigator.clipboard&&navigator.clipboard.writeText(t.value);this.textContent='Kopieret'">Kopiér</button></p></section>` : "";
  const body = `<main class="w"><div class="hero"><div class="w-intro"><img class="w-avatar" src="${base}/jewel.svg" alt="" width="96" height="96"><div><h1>Forslag til udvikling</h1><p class="w-who">Jewel, Hjerterums produktudvikler</p></div></div>
<p>Fortæl Jewel om et forslag til hjemmesiden, medlemssiden eller admin - eller om en fejl, du har fundet. Hun tænker med, spørger ind, til det er klart, og skriver det som ét forslag, som du sender videre til udvikling. Intet ændres på siden herfra.</p>
<form method="post" action="${base}/forslag/ny"><button>Nyt forslag</button></form></div>
${d.notice ? `<p class="notice">${esc(d.notice)}</p>` : ""}
${group(d.chair ? "Venter på dig" : "Venter på godkendelse", waiting, "Ingen forslag venter.")}
${group("Godkendt", approved, "Ingen godkendte forslag venter på at blive lavet.")}
${forMaking}
${group("Lavet, afvist og opgivet", closed, "Ingen endnu.")}</main>`;
  return layout(base, "Forslag til udvikling", body, { section: "/forslag", who, style: WISH_STYLE });
}

type WishView = { wish: Wish; messages: WishMessage[]; chair: boolean; mine: boolean };

/** The wish as it stands, with what the reader may do with it. */
export function wishCard(base: string, d: WishView): string {
  const w = d.wish;
  if (!w.title) return "";
  return `<section class="card w-card"><h2>Forslaget</h2><p><b translate="no">${esc(w.title)}</b> ${badge(w.status)}</p><div class="w-summary" translate="no">${esc(w.summary ?? "").replace(/\n/g, "<br>")}</div>
${w.kind ? `<p class="small"><span class="w-chip">${esc(KIND_TEXT[w.kind] ?? w.kind)}</span>${w.size ? `<span class="w-chip">${esc(SIZE_TEXT[w.size] ?? w.size)}</span>` : ""}</p>` : ""}
${w.done_when ? `<p class="small"><b>Færdigt når:</b></p><ul class="w-done-when" translate="no">${w.done_when.split("\n").map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
${w.chair_note ? `<p class="small"><b>Note:</b> <span translate="no">${esc(w.chair_note)}</span></p>` : ""}
${w.status === "open" && (d.mine || d.chair) ? `<form method="post" action="${base}/forslag/${w.id}/send"><button>Send forslaget til udvikling</button></form><p class="small muted">Vil du rette noget, så skriv det til Jewel herunder, så skriver hun forslaget om.</p>` : ""}
${d.chair && (w.status === "sent" || w.status === "open" || w.status === "approved") ? `<form method="post" action="${base}/forslag/${w.id}/afgoer" class="w-decide"><label>Note til ${esc(w.author)} (valgfri)<textarea name="note" rows="3" maxlength="1500"></textarea></label>
<p><button name="svar" value="godkend">Godkend</button> <button name="svar" value="afvis" class="ghost">Afvis</button></p></form>` : ""}
${d.chair && w.status === "approved" ? `<form method="post" action="${base}/forslag/${w.id}/lavet"><button class="ghost">Markér som lavet</button></form>` : ""}</section>`;
}

/** The conversation's messages. */
export function wishChat(base: string, messages: WishMessage[]): string {
  return messages.map(m => `<li class="w-msg ${m.role === "saga" ? "w-from-saga" : "w-from-person"}"><small>${m.role === "saga" ? `<img class="w-face" src="${base}/jewel.svg" alt="" width="22" height="22">` : ""}${esc(m.role === "saga" ? AGENT : m.author ?? "")} · ${esc(WHEN.format(m.at_ms))}</small>
<div translate="no">${esc(m.text).replace(/\n/g, "<br>")}</div>${m.image_key ? `<a href="${base}/forslag/billede/${m.id}" target="_blank" rel="noopener"><img src="${base}/forslag/billede/${m.id}" alt="Skærmbillede" loading="lazy"></a>` : ""}</li>`).join("");
}

/** "Det skal være en chat som her" (the chair, 24 Nov 2026): the message goes without the page reloading, Jewel's answer comes in when she has it,
 * Enter sends (Shift+Enter makes a new line). Without scripts the form posts as before. */
const CHAT_SCRIPT = `<script>(()=>{const f=document.querySelector(".w-say");if(!f)return;const chat=document.getElementById("w-chat"),card=document.getElementById("w-card"),note=document.getElementById("w-note"),t=f.querySelector("textarea"),b=f.querySelector("button"),file=f.querySelector("input[type=file]");
const esc=s=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);const end=()=>{const l=chat.lastElementChild;if(l)l.scrollIntoView({block:"end",behavior:"smooth"})};end();
t.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.isComposing){e.preventDefault();f.requestSubmit()}});
f.addEventListener("submit",async e=>{e.preventDefault();const data=new FormData(f),text=String(data.get("text")||"").trim(),pic=file.files&&file.files.length;if(!text&&!pic)return;
const hint=document.getElementById("w-hint");if(hint)hint.remove();
chat.insertAdjacentHTML("beforeend",'<li class="w-msg w-from-person"><div>'+esc(text).replace(/\\n/g,"<br>")+(pic?" 📎":"")+'</div></li><li class="w-msg w-from-saga w-typing"><div>Jewel tænker …</div></li>');
end();t.value="";file.value="";b.disabled=true;
try{const r=await fetch(f.action,{method:"POST",body:data,headers:{accept:"application/json"}});const j=await r.json();chat.innerHTML=j.chat;card.innerHTML=j.card;note.innerHTML=j.notice||"";if(j.title){const h=document.querySelector(".w h1");if(h)h.textContent=j.title}if(j.closed)location.reload()}
catch(_){location.reload();return}b.disabled=false;t.focus();end()})})()</script>`;

export function wishPage(base: string, who: string | null, d: WishView & { notice: string; error: string }): string {
  const w = d.wish;
  const talk = w.status === "open" && (d.mine || d.chair) ? `<form method="post" action="${base}/forslag/${w.id}/besked" enctype="multipart/form-data" class="w-say">
<label>Skriv til Jewel<textarea name="text" rows="3" maxlength="${MAX_TEXT}" placeholder="Fx: On the event page, the sign-up button …"></textarea></label>
<div class="w-say-row"><label class="small">Skærmbillede (valgfrit)<input type="file" name="image" accept="image/png,image/jpeg,image/webp,image/gif"></label><button>Send</button></div>
<p class="small muted">Enter sender, Shift+Enter giver en ny linje.</p></form>
<form method="post" action="${base}/forslag/${w.id}/opgiv" class="w-drop"><button class="ghost">Opgiv forslaget</button></form>`
    : w.status !== "open" ? `<p class="muted small">Samtalen er lukket. Har du noget nyt, så start et nyt forslag.</p>` : "";
  const body = `<main class="w"><p class="small"><a href="${base}/forslag">← Forslag til udvikling</a></p><h1>${w.title ? `<span translate="no">${esc(w.title)}</span>` : "Nyt forslag"}</h1>
<p class="small muted">#${w.id} · ${esc(w.author)} · ${badge(w.status)}</p>
<div id="w-note">${d.notice ? `<p class="notice">${esc(d.notice)}</p>` : ""}${d.error ? `<p class="notice bad">${esc(d.error)}</p>` : ""}</div>
<div id="w-card">${wishCard(base, d)}</div>
<section class="card" id="bund"><h2>Samtalen</h2><ol class="w-chat" id="w-chat">${wishChat(base, d.messages)}</ol>
${d.messages.length ? "" : `<p class="muted small" id="w-hint">Fortæl Jewel, hvad du foreslår, eller hvad der ikke virker - på dansk eller engelsk. Hun tænker med, spørger ind og siger sin mening.</p>`}
${talk}</section>${CHAT_SCRIPT}</main>`;
  return layout(base, "Forslag til udvikling", body, { section: "/forslag", who, style: WISH_STYLE });
}

/** The author (or the chair) lets an open wish go. */
export async function dropWish(db: D1Database, wish: Wish, nowMs: number): Promise<boolean> {
  if (wish.status !== "open") return false;
  const changed = await db.prepare("UPDATE wishes SET status = 'dropped', updated_at_ms = ? WHERE id = ? AND status = 'open'").bind(nowMs, wish.id).run();
  return Boolean(changed.meta?.changes);
}

const WISH_STYLE = `
.w .card{margin-top:14px}.w-list{list-style:none;margin:0;padding:0;display:grid}.w-list li{padding:9px 0;border-top:1px solid var(--line)}.w-list li:first-child{border-top:0}
.w-list small{display:block;color:var(--muted);font-size:12.5px}.w-status{display:inline-block;margin-left:6px;padding:1px 8px;border-radius:999px;font-size:12px;background:var(--line)}
/* Tints, so the words keep the page's own colour in light and dark mode alike (the chair, 24 Nov 2026: the own message could not be read in dark mode). */
.w-sent{background:rgba(214,158,46,.22)}.w-approved{background:rgba(72,160,90,.22)}.w-rejected,.w-dropped{background:rgba(128,128,128,.2)}.w-done{background:rgba(70,130,190,.22)}
.w-chat:empty{display:none}.w-typing div{color:var(--muted);font-style:italic}.w-say-row{display:flex;gap:12px;align-items:end;flex-wrap:wrap}.w-say-row label{flex:1 1 240px}.w-drop{margin-top:6px}.w-drop button{font-size:13px}
.w-chat{list-style:none;margin:0 0 14px;padding:0;display:grid;gap:10px}.w-msg{max-width:84%;padding:10px 12px;border-radius:14px;background:var(--card,#fff);border:1px solid var(--line)}
.w-msg.w-from-person{justify-self:end;background:rgba(201,152,110,.16)}.w-msg small{display:block;color:var(--muted);font-size:12px;margin-bottom:4px}.w-msg img{display:block;max-width:100%;max-height:320px;margin-top:8px;border-radius:8px}
.w-say textarea,.w-decide textarea,.w-copy{width:100%;box-sizing:border-box}.w-intro{display:flex;gap:18px;align-items:center}.w-avatar{border-radius:50%;flex:0 0 auto;box-shadow:0 2px 10px rgba(0,0,0,.12)}.w-who{margin:2px 0 0;color:var(--muted)}.w-face{display:inline-block;width:22px;height:22px;border-radius:50%;vertical-align:-6px;margin-right:6px}@media (max-width:560px){.w-avatar{width:64px;height:64px}}
.w-chip{display:inline-block;margin-right:6px;padding:1px 9px;border-radius:999px;font-size:12px;border:1px solid var(--line)}.w-done-when{margin:4px 0 12px;padding-left:20px;font-size:14px}.w-summary{white-space:normal;margin:6px 0 10px;font-size:14.5px}
@media (max-width:760px){.w-msg{max-width:100%}}`;
