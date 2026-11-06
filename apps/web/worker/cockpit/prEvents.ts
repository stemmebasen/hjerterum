import type { D1Database } from "../db.js";
import { esc } from "./page.js";
import { facebookEvents, LIST_DAYS } from "./fbEvents.js";
import { prReadyNames } from "./prMaterial.js";
import { dateOf, longWhen, mondayOf } from "../social/plan.js";
import type { SocialStatus } from "../social/social.js";

/** Requested (the chair, 3 Nov 2026): "Det kunne også være fedt med en eventoversigt over alle kommende events, med en PR-status i højre side samt nogle
 * actionknapper." PR og SoMe → Events (/pr/events): the coming six weeks' events, each with where it stands - its post on Facebook, its event
 * ("begivenhed") on Facebook, the teacher's PR material - and the buttons to move it on. */

export type PrEventRow = {
  key: string; title: string; startsMs: number; host: string | null; monday: string;
  post: { id: number; status: SocialStatus; publishAtMs: number | null; publishedAtMs: number | null } | null;
  /** Every time one of the event's posts goes out on a medium and has not yet, as the calendar shows it. */
  planned: { channel: "facebook" | "instagram"; atMs: number; approved: boolean }[];
  /** Every time the event is shared on a medium - gone out, approved, or Saga's proposal - for the words to the teacher. */
  shares: { channel: "facebook" | "instagram"; atMs: number; state: "published" | "approved" | "draft"; reminder: boolean }[];
  facebookEvent: { at: number; link: string | null } | null;
  material: boolean | null;
  studio: string | null;
};

export async function prEventsData(db: D1Database, nowMs: number): Promise<PrEventRow[]> {
  const events = await facebookEvents(db, nowMs, LIST_DAYS);
  const posts = await db.prepare(`SELECT id, status, publish_at_ms, published_at_ms, channels, published, json_extract(source, '$.instagramAtMs') AS ig, json_extract(source, '$.shout') AS shout, json_extract(source, '$.key') AS key FROM social_posts WHERE kind = 'event' AND json_extract(source, '$.removed') IS NULL
      AND json_extract(source, '$.key') IN (SELECT value FROM json_each(?)) ORDER BY CASE status WHEN 'published' THEN 0 WHEN 'approved' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END`)
    .bind(JSON.stringify(events.map(e => e.key))).all<{ id: number; status: SocialStatus; publish_at_ms: number | null; published_at_ms: number | null; channels: string | null; published: string | null; ig: number | null; shout: number | null; key: string }>()
    .then(r => r.results ?? []).catch(() => []);
  const byKey = new Map<string, (typeof posts)[number]>();
  for (const p of posts) if (!byKey.has(p.key)) byKey.set(p.key, p);
  // Reported (the chair, 6 Nov 2026): "under events står der opslag, der er planlagt, som jeg ikke kan se i kalenderen. Det må virkelig ikke ske." Each
  // time is shown here exactly as the calendar has it (Facebook at the post's time, Instagram at its own), with a link to that day in the calendar.
  const planned = new Map<string, PrEventRow["planned"]>();
  const list = <T,>(json: string | null, fallback: T): T => { try { return json ? JSON.parse(json) as T : fallback; } catch { return fallback; } };
  for (const p of posts) {
    if (!["draft", "approved", "publishing", "failed"].includes(p.status) || !p.publish_at_ms) continue;
    const channels = list<string[]>(p.channels, ["facebook"]), done = list<Record<string, unknown>>(p.published, {});
    const at = [...planned.get(p.key) ?? []];
    if (channels.includes("facebook") && !done.facebook) at.push({ channel: "facebook", atMs: p.publish_at_ms, approved: p.status !== "draft" });
    if (channels.includes("instagram") && !done.instagram) at.push({ channel: "instagram", atMs: p.ig ?? p.publish_at_ms, approved: p.status !== "draft" });
    planned.set(p.key, at.sort((a, b) => a.atMs - b.atMs));
  }
  // Asked (the chair, 6 Nov 2026): "Kan jeg se et sted hvornår et pågældende event bliver delt? Måske en copy paste tekst, jeg hurtigt kan dele med underviseren".
  const shares = new Map<string, PrEventRow["shares"]>();
  for (const p of posts) {
    if (!["draft", "approved", "publishing", "failed", "published"].includes(p.status) || !p.publish_at_ms) continue;
    const channels = list<string[]>(p.channels, ["facebook"]), done = list<Record<string, unknown>>(p.published, {});
    const state = (c: string): "published" | "approved" | "draft" => done[c] ? "published" : p.status === "draft" ? "draft" : "approved";
    const at = [...shares.get(p.key) ?? []], reminder = p.shout === 2;
    if (channels.includes("facebook")) at.push({ channel: "facebook", atMs: p.status === "published" && p.published_at_ms && !p.ig ? Math.min(p.published_at_ms, p.publish_at_ms) : p.publish_at_ms, state: state("facebook"), reminder });
    if (channels.includes("instagram")) at.push({ channel: "instagram", atMs: p.ig ?? p.publish_at_ms, state: state("instagram"), reminder });
    shares.set(p.key, at.sort((a, b) => a.atMs - b.atMs));
  }
  const ready = await prReadyNames(db);
  return events.map(e => {
    const p = byKey.get(e.key);
    return { key: e.key, title: e.title, startsMs: e.startsMs, host: e.host, monday: mondayOf(e.startsMs),
      post: p ? { id: p.id, status: p.status, publishAtMs: p.publish_at_ms, publishedAtMs: p.published_at_ms } : null,
      planned: planned.get(e.key) ?? [], shares: shares.get(e.key) ?? [],
      facebookEvent: e.done ? { at: e.done.at, link: e.done.link } : null,
      material: e.host ? ready.has(e.host.trim().toLowerCase()) : null,
      // Plakater og opslag's address for the event: the calendar's by its id without "SF", the house's own as "h<n>".
      studio: /^mw:SF([0-9a-f]{24})$/.exec(e.key)?.[1] ?? (/^hr:(\d+)$/.exec(e.key) ? `h${e.key.slice(3)}` : null) };
  });
}

const TZ = "Europe/Copenhagen";
const WHEN = new Intl.DateTimeFormat("da-DK", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ });
const DAY = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", timeZone: TZ });

function postChip(r: PrEventRow): string {
  const p = r.post;
  if (!p) return `<span class="chip wait">Intet opslag</span>`;
  if (p.status === "published") return `<span class="chip good">Opslag sendt ${esc(DAY.format(p.publishedAtMs ?? p.publishAtMs ?? 0))}</span>`;
  if (p.status === "approved" || p.status === "publishing") return `<span class="chip good">Opslag godkendt${p.publishAtMs ? ` · ${esc(WHEN.format(p.publishAtMs))}` : ""}</span>`;
  if (p.status === "draft") return `<span class="chip wait">Opslag venter på dig</span>`;
  if (p.status === "failed") return `<span class="chip wait">Opslag fejlede</span>`;
  return `<span class="chip">Opslag sprunget over</span>`;
}

/** The words the chair sends the teacher: when Hjerterum shares their event - what has gone out and what is approved (not Saga's proposals). */
export function teacherText(r: Pick<PrEventRow, "title" | "host" | "startsMs" | "shares">): string | null {
  const sure = r.shares.filter(s => s.state !== "draft");
  if (!sure.length) return null;
  const name = (r.host ?? "").trim().split(/\s+/)[0] ?? "";
  const title = r.title.replace(/\s*[|·].*$/, "").trim();
  const lines = sure.map(s => `• ${s.channel === "facebook" ? "Facebook" : "Instagram"}: ${longWhen(s.atMs)}${s.state === "published" ? " (er delt)" : ""}${s.reminder ? " - en påmindelse" : ""}`);
  return `Hej${name ? ` ${name}` : ""} 😊\n\nVi deler dit event »${title}« (${longWhen(r.startsMs)}) på Hjerterums sociale medier:\n${lines.join("\n")}\n\n`
    + `Del, like eller skriv en kommentar, når opslagene kommer op - så når de endnu flere 🤍\n\nVenlig hilsen,\nTeam Hjerterum`;
}

function teacherBox(r: PrEventRow): string {
  if (!r.shares.length) return "";
  const text = teacherText(r), waiting = r.shares.filter(s => s.state === "draft").length;
  return `<details class="pe-teacher"><summary>Hvornår deles det? Tekst til underviseren</summary>
${text ? `<textarea readonly rows="${Math.min(14, text.split("\n").length + 1)}">${esc(text)}</textarea><button type="button" class="ghost" data-copy>Kopiér teksten</button>` : ""}
${waiting ? `<p class="small muted">${waiting === 1 ? "Ét tidspunkt venter" : `${waiting} tidspunkter venter`} på din godkendelse og ${text ? "er ikke med i teksten" : "kommer med i teksten, når du har godkendt"}.</p>` : ""}</details>`;
}

const COPY_SCRIPT = `<script>document.querySelectorAll(".pe-teacher [data-copy]").forEach(b=>b.addEventListener("click",async()=>{const t=b.previousElementSibling;try{await navigator.clipboard.writeText(t.value)}catch{t.select();document.execCommand("copy")}b.textContent="Kopieret ✓";setTimeout(()=>b.textContent="Kopiér teksten",2500)}))</script>`;

/** The event's posts in the calendar, each a link to its day there. */
function plannedLine(base: string, r: PrEventRow): string {
  if (!r.planned.length) return "";
  const link = (t: PrEventRow["planned"][number]) => {
    const day = dateOf(t.atMs);
    return `<a href="${base}/pr/kalender?start=${mondayOf(t.atMs)}#dag-${day}">${t.channel === "facebook" ? "Facebook" : "Instagram"} ${esc(WHEN.format(t.atMs))}${t.approved ? " ✓" : ""}</a>`;
  };
  return `<p class="pe-planned small"><span class="muted">I kalenderen:</span> ${r.planned.map(link).join(" · ")}</p>`;
}

export function prEventsSection(base: string, rows: PrEventRow[], nowMs: number): string {
  if (!rows.length) return `<section class="panel"><p class="empty">Ingen events de næste seks uger.</p></section>`;
  const ok = (r: PrEventRow) => Boolean(r.post && ["published", "approved", "publishing"].includes(r.post.status) && r.facebookEvent);
  const row = (r: PrEventRow) => {
    const acts: string[] = [];
    if (r.post?.status === "draft" || r.post?.status === "failed")
      acts.push(`<form method="post" action="${base}/pr/opslag/${r.post.id}"><input type="hidden" name="do" value="godkend"><input type="hidden" name="tilbage" value="events"><button>Godkend opslag</button></form>`);
    if (!r.post && r.startsMs > nowMs + 2 * 3_600_000)
      acts.push(`<form method="post" action="${base}/pr/events/opslag"><input type="hidden" name="uge" value="${r.monday}"><button class="ghost">Lav opslag</button></form>`);
    if (r.post) acts.push(`<a class="button ghost" href="${base}/pr/uge?uge=${r.monday}">Se opslaget</a>`);
    if (!r.facebookEvent)
      acts.push(`<form method="post" action="${base}/arrangementer/facebook"><input type="hidden" name="event" value="${esc(r.key)}"><input type="hidden" name="done" value="1"><input type="hidden" name="tilbage" value="pr-events"><button class="ghost">Facebook-begivenhed oprettet</button></form>`);
    if (r.studio) acts.push(`<a class="button ghost" href="${base}/plakater/${esc(r.studio)}?fra=%2Fpr%2Fevents">Lav design</a>`);
    return `<li class="${ok(r) ? "is-ok" : ""}"><div class="pe-main"><span class="at">${esc(WHEN.format(r.startsMs))}</span><b>${esc(r.title)}</b>${r.host ? `<span class="muted"> · ${esc(r.host)}</span>` : ""}
<div class="pe-acts">${acts.join("")}</div>
${plannedLine(base, r)}${teacherBox(r)}</div>
<div class="pe-status">${postChip(r)}${r.facebookEvent ? `<span class="chip good">${r.facebookEvent.link ? `<a href="${esc(r.facebookEvent.link)}" target="_blank" rel="noopener">Facebook-begivenhed</a>` : "Facebook-begivenhed"} ✓</span>` : `<span class="chip wait">Ingen Facebook-begivenhed</span>`}
${r.material === null ? "" : r.material ? `<span class="chip good">PR-materiale klar</span>` : `<span class="chip">Intet PR-materiale</span>`}</div></li>`;
  };
  const missing = rows.filter(r => !ok(r)).length;
  return `<section class="panel"><header><h2>Kommende events (${rows.length})</h2><p>${missing ? `${missing} mangler noget.` : "Alt er på plads."} De næste seks uger, de nærmeste først.</p></header>
<ul class="pe-list">${rows.map(row).join("")}</ul></section>${COPY_SCRIPT}`;
}

export const PR_EVENTS_STYLE = `.pe-list{list-style:none;margin:0;padding:0}.pe-list li{display:grid;grid-template-columns:minmax(0,1fr) minmax(220px,300px);gap:16px;padding:14px 0;border-top:1px solid var(--line)}
.pe-list li:first-child{border-top:0}.pe-main .at{display:block;color:var(--muted);font-size:13px}.pe-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.pe-acts form{margin:0}
.pe-acts button,.pe-acts .button{font-size:13px;padding:6px 12px;min-height:0}.pe-status{display:flex;flex-direction:column;align-items:flex-end;gap:6px}.pe-status .chip{margin:0}.pe-status a{color:inherit}
.pe-planned{margin:8px 0 0;font-size:13px}.pe-teacher{margin-top:8px;font-size:13px}.pe-teacher summary{cursor:pointer;color:var(--accent)}
.pe-teacher textarea{display:block;width:100%;margin:8px 0;font:inherit;font-size:13.5px;line-height:1.45}.pe-planned a{color:inherit}
.pe-list li.is-ok .pe-main b::after{content:" ✓";color:var(--accent)}
@media (max-width:760px){.pe-list li{grid-template-columns:1fr}.pe-status{flex-direction:row;flex-wrap:wrap;align-items:flex-start}}`;
