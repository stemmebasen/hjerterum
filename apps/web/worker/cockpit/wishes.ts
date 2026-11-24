import type { D1Database } from "../db.js";
import { completeAs } from "../saga/ai.js";
import type { ChatPart, ChatMessage } from "../saga/ai.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { telegramClient } from "../saga/telegram.js";
import { esc, layout } from "./page.js";

/** Asked (the chair, 24 Nov 2026): "Jeg får en masse feedback fra Douglas. Er det muligt han på en eller måde kan chatte med ai om ændringerne - og så
 * ligger den endelig implementering og godkendelse stadig hos mig?" - "Ja".
 *
 * Admin → Ønsker og fejl. Douglas (and the chair) talks a wish or a fault through with Saga, in his own words and language, with a screenshot if he
 * likes. Saga asks until it is clear and writes it as one wish; he sends it to the chair, who approves or turns it down with a note. Nothing on the
 * website changes from here: the approved wishes are what the chair hands on to be made (the list at the bottom), and the chair marks them done.
 * Saga answers questions about how things work from what she is told below - and says so when she does not know. */

export type WishStatus = "open" | "sent" | "approved" | "rejected" | "done";
export type Wish = { id: number; author: string; status: WishStatus; title: string | null; summary: string | null; chair_note: string | null; decided_by: string | null;
  decided_at_ms: number | null; sent_at_ms: number | null; done_at_ms: number | null; created_at_ms: number; updated_at_ms: number };
export type WishMessage = { id: number; wish_id: number; role: "person" | "saga"; author: string | null; text: string; image_key: string | null; image_type: string | null; at_ms: number };

export const STATUS_TEXT: Record<WishStatus, string> = { open: "Under samtale", sent: "Venter på formanden", approved: "Godkendt", rejected: "Afvist", done: "Lavet" };
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
export async function newWish(db: D1Database, author: string, nowMs: number): Promise<number> {
  const made = await db.prepare("INSERT INTO wishes (author, status, created_at_ms, updated_at_ms) VALUES (?, 'open', ?, ?)").bind(author, nowMs, nowMs).run();
  return Number(made.meta?.last_row_id);
}
async function addMessage(db: D1Database, wishId: number, role: "person" | "saga", author: string | null, text: string, nowMs: number, image?: { key: string; type: string }): Promise<number> {
  const made = await db.prepare("INSERT INTO wish_messages (wish_id, role, author, text, image_key, image_type, at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(wishId, role, author, text, image?.key ?? null, image?.type ?? null, nowMs).run();
  await db.prepare("UPDATE wishes SET updated_at_ms = ? WHERE id = ?").bind(nowMs, wishId).run();
  return Number(made.meta?.last_row_id);
}

/** What Saga knows about the new system - kept short and true; what is not here she does not guess at. */
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

const SYSTEM = `Du er Saga, Hjerterums assistent, i admin under "Ønsker og fejl". Her fortæller et medlem af bestyrelsen om et ønske til hjemmesiden, medlemssiden eller admin - eller om en fejl, de har fundet. Formanden, Jacob, beslutter, hvad der bliver lavet; du ændrer ikke selv noget og lover aldrig, at noget bliver lavet.

Din opgave:
1. Forstå ønsket eller fejlen helt: hvilken side eller hvilket sted, hvad personen gjorde, hvad der skete, og hvad de havde ventet eller ønsker i stedet. Er der et skærmbillede, så se på det.
2. Spørg om det, der mangler - ét kort spørgsmål ad gangen, aldrig en lang liste. Gæt ikke.
3. Spørger personen, hvordan noget virker, så svar kort ud fra det, du ved herunder. Ved du det ikke, så sig ærligt, at det kan Jacob svare på - og tilbyd at skrive det som et spørgsmål til ham.
4. Når det er klart, så skriv ønsket: en kort titel og en beskrivelse, som en udvikler kan gå direkte i gang med - hvor, hvad der sker nu, hvad der ønskes, og personens egne ord, hvor de siger det bedst. Én ting pr. ønske; har personen flere, så tag dem én ad gangen og sig, at de næste kan få deres eget ønske bagefter.
5. Er ønsket allerede på listen over tidligere ønsker, så sig det.

Skriv altid på samme sprog som personen (engelsk til den, der skriver engelsk). Venligt, kort og konkret - ingen lange indledninger.

${KNOWLEDGE}

Svar KUN med JSON: {"svar": "dit svar til personen", "oenske": null}
- eller, når ønsket er klart (eller personen beder dig skrive det): {"svar": "kort: her er ønsket - ret gerne, eller send det til Jacob", "oenske": {"titel": "højst 80 tegn", "beskrivelse": "højst 1500 tegn"}}`;

/** A picture as a data URL for the AI. */
function dataUrl(bytes: ArrayBuffer, type: string): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
}

export type SagaWishAnswer = { reply: string; wish: { title: string; summary: string } | null };

/** Saga's answer to the conversation so far - the last three pictures are shown to her. */
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
  const system = `${SYSTEM}\n\nTidligere ønsker:\n${others || "(ingen endnu)"}${wish.title ? `\n\nDit nuværende udkast til dette ønske:\nTitel: ${wish.title}\n${wish.summary ?? ""}` : ""}`;
  const raw = await completeAs("oensker", "mid", 1800)(env, deps, [{ role: "system", content: system }, ...turns]);
  const json = /\{[\s\S]*\}/.exec(raw)?.[0];
  let data: { svar?: unknown; oenske?: { titel?: unknown; beskrivelse?: unknown } | null } = {};
  try { data = json ? JSON.parse(json) : {}; } catch { data = {}; }
  const reply = typeof data.svar === "string" && data.svar.trim() ? data.svar.trim().slice(0, 3000) : raw.replace(/\{[\s\S]*\}/, "").trim().slice(0, 3000);
  const title = typeof data.oenske?.titel === "string" ? data.oenske.titel.trim().slice(0, 120) : "";
  const summary = typeof data.oenske?.beskrivelse === "string" ? data.oenske.beskrivelse.trim().slice(0, 2500) : "";
  return { reply: reply || "…", wish: title && summary ? { title, summary } : null };
}

export type WishInput = { text: string; image?: File | null };
export type WishError = "empty" | "image_type" | "image_size" | "closed" | "ai";

/** The person writes; Saga answers (and, when it is clear, writes the wish). */
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
    await addMessage(db, wish.id, "saga", "Saga", "Jeg kan ikke svare lige nu (min AI er ikke sat op). Det, du har skrevet, er gemt.", deps.now());
    return null;
  }
  try {
    const answer = await sagaOnWish(env, deps, db, wish, await wishMessages(db, wish.id));
    await addMessage(db, wish.id, "saga", "Saga", answer.reply, deps.now());
    if (answer.wish) await db.prepare("UPDATE wishes SET title = ?, summary = ?, updated_at_ms = ? WHERE id = ? AND status = 'open'").bind(answer.wish.title, answer.wish.summary, deps.now(), wish.id).run();
    return null;
  } catch {
    return "ai";
  }
}

/** The person sends the wish to the chair - and the chair hears it on Telegram. */
export async function sendWish(env: SagaEnv, deps: SagaDeps, db: D1Database, wish: Wish, cockpitUrl: string): Promise<boolean> {
  if (wish.status !== "open" || !wish.title || !wish.summary) return false;
  const now = deps.now();
  const changed = await db.prepare("UPDATE wishes SET status = 'sent', sent_at_ms = ?, updated_at_ms = ? WHERE id = ? AND status = 'open'").bind(now, now, wish.id).run();
  if (!changed.meta?.changes) return false;
  if (env.SAGA_TELEGRAM_BOT_TOKEN && env.SAGA_OWNER_TELEGRAM_ID)
    await telegramClient(env, deps).sendMessage(env.SAGA_OWNER_TELEGRAM_ID, `${wish.author} har sendt et ønske: »${wish.title}«\n\nSe det, og godkend eller afvis det her: ${cockpitUrl}/oensker/${wish.id}`).catch(() => undefined);
  return true;
}

/** The chair approves or turns down a sent wish; the one who wished hears it on Telegram, when Saga knows them there. */
export async function decideWish(env: SagaEnv, deps: SagaDeps, db: D1Database, wish: Wish, approve: boolean, note: string, by: string, cockpitUrl: string): Promise<boolean> {
  if (wish.status !== "sent" && wish.status !== "open") return false;
  const now = deps.now();
  const clean = note.trim().slice(0, 1500) || null;
  const changed = await db.prepare("UPDATE wishes SET status = ?, chair_note = ?, decided_by = ?, decided_at_ms = ?, updated_at_ms = ? WHERE id = ? AND status IN ('sent', 'open')")
    .bind(approve ? "approved" : "rejected", clean, by, now, now, wish.id).run();
  if (!changed.meta?.changes) return false;
  if (wish.author !== by && env.SAGA_TELEGRAM_BOT_TOKEN) {
    const person = await db.prepare("SELECT telegram_id FROM cockpit_login_links WHERE member = ? AND telegram_id IS NOT NULL ORDER BY created_at_ms DESC LIMIT 1")
      .bind(wish.author).first<{ telegram_id: string }>().catch(() => null);
    if (person?.telegram_id) await telegramClient(env, deps).sendMessage(person.telegram_id,
      `Your wish »${wish.title ?? `#${wish.id}`}« was ${approve ? "approved" : "not approved"} by ${by}.${clean ? `\n\n${clean}` : ""}\n\n${cockpitUrl}/oensker/${wish.id}`).catch(() => undefined);
  }
  return true;
}

export async function markWishDone(db: D1Database, wish: Wish, nowMs: number): Promise<boolean> {
  if (wish.status !== "approved") return false;
  const changed = await db.prepare("UPDATE wishes SET status = 'done', done_at_ms = ?, updated_at_ms = ? WHERE id = ? AND status = 'approved'").bind(nowMs, nowMs, wish.id).run();
  return Boolean(changed.meta?.changes);
}

const WHEN = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" });
const DAY = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "long", timeZone: "Europe/Copenhagen" });

/** The approved wishes not yet made, as one text to hand on to be made. */
export function approvedText(wishes: Wish[]): string {
  return wishes.filter(w => w.status === "approved").map(w => [`Ønske #${w.id} fra ${w.author}, godkendt ${w.decided_at_ms ? DAY.format(w.decided_at_ms) : ""}: ${w.title ?? ""}`,
    w.summary ?? "", w.chair_note ? `Formandens note: ${w.chair_note}` : ""].filter(Boolean).join("\n")).join("\n\n---\n\n");
}

const badge = (s: WishStatus) => `<span class="w-status w-${s}">${STATUS_TEXT[s]}</span>`;

export function wishesPage(base: string, who: string | null, d: { wishes: Wish[]; chair: boolean; notice: string }): string {
  const row = (w: Wish) => `<li><a href="${base}/oensker/${w.id}"><b translate="no">${esc(w.title ?? "Nyt ønske - under samtale")}</b></a> ${badge(w.status)}<small>#${w.id} · ${esc(w.author)} · ${esc(WHEN.format(w.updated_at_ms))}</small></li>`;
  const group = (title: string, list: Wish[], empty: string) => `<section class="card"><h2>${title}</h2>${list.length ? `<ul class="w-list">${list.map(row).join("")}</ul>` : `<p class="muted small">${empty}</p>`}</section>`;
  const waiting = d.wishes.filter(w => w.status === "sent"), open = d.wishes.filter(w => w.status === "open"), approved = d.wishes.filter(w => w.status === "approved");
  const closed = d.wishes.filter(w => w.status === "rejected" || w.status === "done");
  const forMaking = d.chair && approved.length ? `<section class="card" id="til-udvikling"><h2>Godkendte ønsker samlet</h2>
<p class="small muted">Kopiér teksten, og giv den videre, når ønskerne skal laves. Markér hvert ønske som lavet, når det er på siden.</p>
<textarea class="w-copy" rows="10" readonly translate="no">${esc(approvedText(approved))}</textarea>
<p><button type="button" class="ghost" onclick="const t=this.closest('section').querySelector('textarea');t.select();navigator.clipboard&&navigator.clipboard.writeText(t.value);this.textContent='Kopieret'">Kopiér</button></p></section>` : "";
  const body = `<main class="w"><div class="hero"><h1>Ønsker og fejl</h1>
<p>Fortæl Saga om et ønske til hjemmesiden, medlemssiden eller admin - eller om en fejl, du har fundet. Hun spørger, til det er klart, og skriver det som ét ønske. Du sender det til formanden, som godkender eller afviser det. Intet ændres på siden herfra.</p>
<form method="post" action="${base}/oensker/ny"><button>Nyt ønske</button></form></div>
${d.notice ? `<p class="notice">${esc(d.notice)}</p>` : ""}
${group(d.chair ? "Venter på dig" : "Venter på formanden", waiting, "Ingen ønsker venter.")}
${group("Under samtale", open, "Ingen samtaler i gang.")}
${group("Godkendt", approved, "Ingen godkendte ønsker venter på at blive lavet.")}
${forMaking}
${group("Lavet og afvist", closed, "Ingen endnu.")}</main>`;
  return layout(base, "Ønsker og fejl", body, { section: "/oensker", who, style: WISH_STYLE });
}

export function wishPage(base: string, who: string | null, d: { wish: Wish; messages: WishMessage[]; chair: boolean; mine: boolean; notice: string; error: string }): string {
  const w = d.wish;
  const bubble = (m: WishMessage) => `<li class="w-msg ${m.role === "saga" ? "w-from-saga" : "w-from-person"}"><small>${esc(m.role === "saga" ? "Saga" : m.author ?? "")} · ${esc(WHEN.format(m.at_ms))}</small>
<div translate="no">${esc(m.text).replace(/\n/g, "<br>")}</div>${m.image_key ? `<a href="${base}/oensker/billede/${m.id}" target="_blank" rel="noopener"><img src="${base}/oensker/billede/${m.id}" alt="Skærmbillede" loading="lazy"></a>` : ""}</li>`;
  const card = w.title ? `<section class="card w-card"><h2>Ønsket</h2><p><b translate="no">${esc(w.title)}</b> ${badge(w.status)}</p><div class="w-summary" translate="no">${esc(w.summary ?? "").replace(/\n/g, "<br>")}</div>
${w.chair_note ? `<p class="small"><b>Formandens note:</b> <span translate="no">${esc(w.chair_note)}</span></p>` : ""}
${w.status === "open" && (d.mine || d.chair) ? `<form method="post" action="${base}/oensker/${w.id}/send"><button>Send ønsket til formanden</button></form><p class="small muted">Vil du rette noget, så skriv det til Saga herunder, så skriver hun ønsket om.</p>` : ""}
${d.chair && (w.status === "sent" || w.status === "open") ? `<form method="post" action="${base}/oensker/${w.id}/afgoer" class="w-decide"><label>Note til ${esc(w.author)} (valgfri)<textarea name="note" rows="3" maxlength="1500"></textarea></label>
<p><button name="svar" value="godkend">Godkend</button> <button name="svar" value="afvis" class="ghost">Afvis</button></p></form>` : ""}
${d.chair && w.status === "approved" ? `<form method="post" action="${base}/oensker/${w.id}/lavet"><button class="ghost">Markér som lavet</button></form>` : ""}</section>` : "";
  const talk = w.status === "open" && (d.mine || d.chair) ? `<form method="post" action="${base}/oensker/${w.id}/besked" enctype="multipart/form-data" class="w-say" onsubmit="const b=this.querySelector('button');b.disabled=true;b.textContent='Saga tænker …'">
<label>Skriv til Saga<textarea name="text" rows="4" maxlength="${MAX_TEXT}" placeholder="Fx: On the event page, the sign-up button …"></textarea></label>
<label class="small">Skærmbillede (valgfrit)<input type="file" name="image" accept="image/png,image/jpeg,image/webp,image/gif"></label>
<p><button>Send</button></p></form>` : w.status !== "open" ? `<p class="muted small">Ønsket er sendt, så samtalen er lukket. Har du noget nyt, så start et nyt ønske.</p>` : "";
  const body = `<main class="w"><p class="small"><a href="${base}/oensker">← Ønsker og fejl</a></p><h1>${w.title ? `<span translate="no">${esc(w.title)}</span>` : "Nyt ønske"}</h1>
<p class="small muted">#${w.id} · ${esc(w.author)} · ${badge(w.status)}</p>
${d.notice ? `<p class="notice">${esc(d.notice)}</p>` : ""}${d.error ? `<p class="notice bad">${esc(d.error)}</p>` : ""}
${card}
<section class="card" id="bund"><h2>Samtalen</h2>${d.messages.length ? `<ol class="w-chat">${d.messages.map(bubble).join("")}</ol>` : `<p class="muted small">Fortæl Saga, hvad du ønsker, eller hvad der ikke virker - på dansk eller engelsk.</p>`}
${talk}</section></main>`;
  return layout(base, "Ønsker og fejl", body, { section: "/oensker", who, style: WISH_STYLE });
}

const WISH_STYLE = `
.w .card{margin-top:14px}.w-list{list-style:none;margin:0;padding:0;display:grid}.w-list li{padding:9px 0;border-top:1px solid var(--line)}.w-list li:first-child{border-top:0}
.w-list small{display:block;color:var(--muted);font-size:12.5px}.w-status{display:inline-block;margin-left:6px;padding:1px 8px;border-radius:999px;font-size:12px;background:var(--line)}
.w-sent{background:#f3e3c7}.w-approved{background:#dcebd6}.w-rejected{background:#eee}.w-done{background:#d7e4ef}
.w-chat{list-style:none;margin:0 0 14px;padding:0;display:grid;gap:10px}.w-msg{max-width:84%;padding:10px 12px;border-radius:14px;background:var(--card,#fff);border:1px solid var(--line)}
.w-msg.w-from-person{justify-self:end;background:#f6efe6}.w-msg small{display:block;color:var(--muted);font-size:12px;margin-bottom:4px}.w-msg img{display:block;max-width:100%;max-height:320px;margin-top:8px;border-radius:8px}
.w-say textarea,.w-decide textarea,.w-copy{width:100%;box-sizing:border-box}.w-summary{white-space:normal;margin:6px 0 10px;font-size:14.5px}
@media (max-width:760px){.w-msg{max-width:100%}}`;
