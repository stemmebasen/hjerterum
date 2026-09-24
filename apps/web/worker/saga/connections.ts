import { driveAccessToken, readDocText } from "./drive.js";
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
  if (!info?.url) return { ok: false, detail: "Botten er ikke koblet til Saga (ingen webhook), så hun får ingen beskeder fra gruppen." };
  if (info.url !== expected) return { ok: false, detail: `Botten sender sine beskeder til ${new URL(info.url).host} og ikke til Saga. Bruges den samme bot også andre steder?` };
  if (info.last_error_message) return { ok: false, detail: `Telegram kan ikke levere beskeder til Saga: ${info.last_error_message}` };
  const other = await serviceStatus(requireDb(env), "telegram_other_group");
  if (!messages) return { ok: false, detail: "Botten er koblet til Saga, men hun har ikke set en eneste besked fra gruppen. Tjek, at botten er medlem af gruppen, og slå dens privatlivstilstand fra (BotFather → /setprivacy → Disable)."
    + (other ? ` Hun har set beskeder fra en anden gruppe (${other.detail}), så gruppens id i opsætningen er måske forkert.` : "") };
  return { ok: true, detail: `Forbundet. Seneste besked i gruppen: ${time(last!)}.` };
}

async function googleDoc(env: SagaEnv, deps: SagaDeps): Promise<Connection> {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) return { ok: false, detail: "Saga har ingen Google-adgang (servicekontoen mangler)." };
  if (!env.GOOGLE_MINUTES_DOC_ID) return { ok: false, detail: "Referatdokumentet er ikke valgt." };
  try {
    const text = await within(readDocText(deps, await driveAccessToken(env, deps), env.GOOGLE_MINUTES_DOC_ID), 10_000);
    return { ok: true, detail: `Forbundet. Saga kan læse referatdokumentet (${Math.round(text.length / 1000)} tusind tegn).` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
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
