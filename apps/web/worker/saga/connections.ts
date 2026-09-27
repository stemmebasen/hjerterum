import { minutesDocText } from "./drive.js";
import { requireDb, type SagaDeps, type SagaEnv } from "./env.js";
import { boardActivity, serviceStatus } from "./store.js";

/** Requested: "Er der kontakt til Google doc, telegram gruppen og mailen?" - each source Saga
 * reads, checked when the chair opens his page, and said in plain words: connected or not, and
 * what to do when not. Nothing here changes anything (Telegram is only asked where the bot's
 * messages go). */
export type Connection = { ok: boolean | null; detail: string };
export type SagaConnections = { telegram: Connection; googleDoc: Connection; mail: Connection; ai: Connection };

const time = (ms: number) => new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(ms);
const within = <T>(work: Promise<T>, ms: number) => Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

async function telegram(env: SagaEnv, deps: SagaDeps, origin: string, messages: number, last: number | null): Promise<Connection> {
  if (!env.SAGA_TELEGRAM_BOT_TOKEN || !env.SAGA_BOARD_CHAT_ID) return { ok: false, detail: "Telegram-botten er ikke sat op for Saga." };
  let info: { url?: string; last_error_message?: string } | null = null;
  try {
    const response = await within(deps.fetcher(`https://api.telegram.org/bot${env.SAGA_TELEGRAM_BOT_TOKEN}/getWebhookInfo`, { method: "POST" }), 8000);
    const data = await response.json().catch(() => null) as { ok?: boolean; result?: typeof info; description?: string } | null;
    if (!data?.ok) return { ok: false, detail: `Telegram afviser botten (${data?.description ?? response.status}). Tjek bot-nøglen.` };
    info = data.result ?? {};
  } catch {
    return { ok: null, detail: "Telegram svarede ikke lige nu." };
  }
  const expected = `${origin}/api/saga/telegram`;
  // Requested: "Telegram-gruppen bør også være sat op" - a bot with no webhook, or one that already
  // points at Saga but is refused (an old secret), is connected here. A bot that delivers to
  // another address is used elsewhere and is never taken over.
  const secretRefused = info?.url === expected && /\b401\b|unauthorized/i.test(info.last_error_message ?? "");
  if ((!info?.url || secretRefused) && env.SAGA_TELEGRAM_WEBHOOK_SECRET && /^https:\/\//.test(expected)) {
    const connected = await within(deps.fetcher(`https://api.telegram.org/bot${env.SAGA_TELEGRAM_BOT_TOKEN}/setWebhook`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: expected, secret_token: env.SAGA_TELEGRAM_WEBHOOK_SECRET, allowed_updates: ["message", "callback_query"] }) })
      .then(r => r.json()).then(d => (d as { ok?: boolean }).ok === true), 8000).catch(() => false);
    if (connected) info = { url: expected };
  }
  if (!info?.url) return { ok: false, detail: env.SAGA_TELEGRAM_WEBHOOK_SECRET ? "Botten er ikke koblet til Saga (ingen webhook), og Telegram ville ikke koble den nu. Tryk Opdatér om lidt."
    : "Botten er ikke koblet til Saga (ingen webhook), og Saga mangler sin webhook-nøgle (SAGA_TELEGRAM_WEBHOOK_SECRET)." };
  if (info.url !== expected) return { ok: false, detail: `Botten sender sine beskeder til ${new URL(info.url).host} og ikke til Saga. Bruges den samme bot også andre steder?` };
  if (info.last_error_message) return { ok: false, detail: `Telegram kan ikke levere beskeder til Saga: ${info.last_error_message}` };
  const other = await serviceStatus(requireDb(env), "telegram_other_group");
  if (!messages) {
    // Telegram tells whether the bot may read the whole group (privacy mode off).
    const me = await within(deps.fetcher(`https://api.telegram.org/bot${env.SAGA_TELEGRAM_BOT_TOKEN}/getMe`, { method: "POST" }).then(r => r.json()), 8000).catch(() => null) as { result?: { can_read_all_group_messages?: boolean } } | null;
    const privacy = me?.result?.can_read_all_group_messages === false;
    return { ok: false, detail: "Botten er koblet til Saga, men hun har ikke set en eneste besked fra gruppen. "
      + (privacy ? "Botten må kun læse kommandoer i gruppen: slå dens privatlivstilstand fra (BotFather → /setprivacy → Disable), og fjern og tilføj den så til gruppen igen."
        : "Tjek, at botten er medlem af gruppen, og slå dens privatlivstilstand fra (BotFather → /setprivacy → Disable).")
      + (other ? ` Hun har set beskeder fra en anden gruppe (${other.detail}), så gruppens id i opsætningen er måske forkert.` : "") };
  }
  return { ok: true, detail: `Forbundet. Seneste besked i gruppen: ${time(last!)}.` };
}

async function googleDoc(env: SagaEnv, deps: SagaDeps): Promise<Connection> {
  if (!env.GOOGLE_MINUTES_DOC_ID) return { ok: false, detail: env.GOOGLE_SERVICE_ACCOUNT_JSON ? "Referatdokumentet er ikke valgt." : "Saga har ingen Google-adgang (servicekontoen mangler), og referatdokumentet er ikke valgt." };
  try {
    const text = await within(minutesDocText(env, deps), 10_000);
    const size = `${Math.round(text.length / 1000)} tusind tegn`;
    return { ok: true, detail: env.GOOGLE_SERVICE_ACCOUNT_JSON ? `Forbundet. Saga kan læse referatdokumentet (${size}).`
      : `Forbundet via det åbne link. Saga læser referatdokumentet (${size}), men skriver ikke i det: godkendte referater ligger her, klar til at sætte ind.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/public_doc_read_failed/.test(message)) return { ok: false, detail: "Saga kan ikke åbne referatdokumentet via linket. Del det som \"Alle med linket\" (Del → Generel adgang), eller giv Saga en Google-servicekonto." };
    if (/doc_read_failed: (403|404)/.test(message)) return { ok: false, detail: "Saga kan ikke åbne referatdokumentet. Del det med Sagas servicekonto som redaktør." };
    if (/drive_auth_failed|service_account/.test(message)) return { ok: false, detail: "Google afviser Sagas servicekonto. Tjek nøglen." };
    return { ok: null, detail: "Google svarede ikke lige nu." };
  }
}

function mail(messages: { mails: number; lastMailMs: number | null; lastRelayedMs: number | null }): Connection {
  if (!messages.mails) return { ok: null, detail: "Ingen mails fra team@ endnu. Forbind mailen nedenfor, hvis den ikke er forbundet." };
  return { ok: true, detail: `Forbundet. Seneste mail: ${time(messages.lastMailMs!)}.` };
}

async function ai(env: SagaEnv): Promise<Connection> {
  if (!env.AI_API_KEY || !env.AI_MODEL) return { ok: false, detail: "Saga har ingen AI-nøgle (AI_API_KEY), så hun kan hverken vurdere mails eller skrive overblik." };
  const last = await serviceStatus(requireDb(env), "ai");
  if (!last) return { ok: null, detail: "Saga har ikke brugt sin AI endnu." };
  return last.ok ? { ok: true, detail: `Virker (${time(last.at_ms)}).` } : { ok: false, detail: `Sagas AI svarede med en fejl ${time(last.at_ms)}: ${last.detail || "ukendt"}.` };
}

export async function sagaConnections(env: SagaEnv, deps: SagaDeps, origin: string): Promise<SagaConnections> {
  const activity = await boardActivity(requireDb(env), env.SAGA_BOARD_CHAT_ID ?? "");
  const [t, g, a] = await Promise.all([telegram(env, deps, origin, activity.groupMessages, activity.lastGroupMessageMs), googleDoc(env, deps), ai(env)]);
  return { telegram: t, googleDoc: g, mail: mail(activity), ai: a };
}
