import type { MessengerThread } from "../social/meta.js";
import { esc } from "./page.js";

/** Asked (the chair, 6 Nov 2026): "Vil jeg kunne svare på Messenger beskeder i cockpittet?" - and, when it could be read, "men hvor er beskederne så?".
 * PR og SoMe → Beskeder: the page's conversations in Messenger, newest first, and an answer from the page - sent only when the chair presses Send.
 * Meta lets a page answer within 24 hours of the person's last message; after that the box is closed and says why. */

export const REPLY_WINDOW_MS = 24 * 3_600_000;

const TZ = "Europe/Copenhagen";
const WHEN = new Intl.DateTimeFormat("da-DK", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ });

/** How long the page may still answer: from the person's last message. */
export function replyLeft(thread: MessengerThread, nowMs: number): number {
  const last = [...thread.messages].reverse().find(m => !m.fromPage);
  return last ? last.createdMs + REPLY_WINDOW_MS - nowMs : 0;
}

const left = (ms: number) => ms >= 3_600_000 ? `${Math.floor(ms / 3_600_000)} timer` : `${Math.max(1, Math.floor(ms / 60_000))} minutter`;
const linkify = (text: string) => esc(text).replace(/https:\/\/[^\s<]+/g, url => `<a href="${url}" target="_blank" rel="noopener">${url.length > 60 ? `${url.slice(0, 57)}…` : url}</a>`).replace(/\n/g, "<br>");

export function messengerSection(base: string, data: { threads: MessengerThread[]; error: string | null; nowMs: number }): string {
  const intro = `<header><h2>Beskeder</h2><p>Hjerterums samtaler på Messenger, de nyeste først. Du kan svare herfra, så længe der er gået under 24 timer siden personens seneste besked (Metas regel). Intet sendes, før du trykker Send.</p></header>`;
  if (data.error) return `<section class="panel" id="beskeder">${intro}<p class="notice warn">${esc(data.error)}</p></section>`;
  if (!data.threads.length) return `<section class="panel" id="beskeder">${intro}<p class="empty">Ingen beskeder endnu.</p></section>`;
  const thread = (t: MessengerThread) => {
    const ms = replyLeft(t, data.nowMs);
    const unanswered = t.messages.length > 0 && !t.messages[t.messages.length - 1]!.fromPage;
    const bubbles = t.messages.map(m => `<li class="${m.fromPage ? "mine" : "theirs"}"><div>${m.text ? `<p>${linkify(m.text)}</p>` : ""}${m.pictures.map(p => `<img src="${esc(p)}" alt="" loading="lazy" referrerpolicy="no-referrer">`).join("")}
${m.links.filter(l => !m.text.includes(l)).map(l => `<p><a href="${esc(l)}" target="_blank" rel="noopener">${esc(l.length > 60 ? `${l.slice(0, 57)}…` : l)}</a></p>`).join("")}</div><span class="at">${esc(WHEN.format(m.createdMs))}</span></li>`).join("");
    const reply = !t.person ? "" : ms > 0
      ? `<form method="post" action="${base}/pr/beskeder/svar" class="msg-reply"><input type="hidden" name="til" value="${esc(t.person.id)}"><input type="hidden" name="navn" value="${esc(t.person.name)}">
<textarea name="tekst" rows="3" required maxlength="1900" placeholder="Skriv et svar fra Hjerterum …"></textarea><div class="msg-row"><span class="small muted">Du kan svare i ${left(ms)} endnu.</span><button>Send</button></div></form>`
      : `<p class="small muted">Der er gået over 24 timer siden den seneste besked fra ${esc(t.person.name || "personen")}, så Meta tillader ikke et svar herfra. Svar i Messenger på telefonen eller på facebook.com, hvis det stadig er vigtigt.</p>`;
    return `<article class="msg-thread${unanswered ? " is-open" : ""}"><header><b>${esc(t.person?.name || "Ukendt")}</b>${unanswered ? ` <span class="chip wait">Venter på svar</span>` : ""}<span class="small muted"> · ${esc(WHEN.format(t.updatedMs))}</span></header>
<ul class="msg-list">${bubbles}</ul>${reply}</article>`;
  };
  return `<section class="panel" id="beskeder">${intro}${data.threads.map(thread).join("")}</section>`;
}

export const PR_MESSENGER_STYLE = `.msg-thread{border-top:1px solid var(--line);padding:16px 0}.msg-thread:first-of-type{border-top:0}.msg-thread>header{margin-bottom:10px}
.msg-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}.msg-list li{display:grid;gap:2px;max-width:78%}.msg-list li.mine{justify-self:end;text-align:right}
.msg-list li>div{padding:9px 13px;border-radius:16px;background:var(--soft);text-align:left;overflow-wrap:anywhere}.msg-list li.mine>div{background:rgba(76,111,255,.18)}
.msg-list li p{margin:0}.msg-list li p+p{margin-top:6px}.msg-list li img{display:block;max-width:240px;max-height:240px;border-radius:10px;margin-top:6px}.msg-list .at{font-size:11.5px;color:var(--muted)}
.msg-reply{margin-top:12px}.msg-reply textarea{width:100%;font:inherit}.msg-row{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:6px}`;
