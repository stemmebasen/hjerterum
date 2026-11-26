import type { D1Database } from "../db.js";
import { completeAs } from "../saga/ai.js";
import type { SagaDeps, SagaEnv } from "../saga/env.js";
import { serviceStatus, setServiceStatus } from "../saga/store.js";
import { telegramClient } from "../saga/telegram.js";
import { POWERS } from "./authority.js";
import { RECENT_CHANGES } from "./recent-changes.generated.js";

/** Asked (the chair, 26 Nov 2026): "Can Saga tell Douglas and I when a bunch of changes has been made on Telegram?" Once a day, at 17 in Copenhagen,
 * when something new has gone live since the last time, Saga writes a short list in plain words: in Danish to the chair, in English to the others who
 * may send development requests (POWERS["wishes.write"].also - Douglas). What has gone live is what was deployed: RECENT_CHANGES, written before each
 * deploy (.github/scripts/recent-changes.mjs). The newest change told is kept (saga_status "change_digest"), so nothing is told twice. */
const KEY = "change_digest";
const HOUR = 17;
const DAY = 86_400_000;
const MAX_LINES = 40;

const dateIn = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(ms);
const hourIn = (ms: number) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", hour: "2-digit", hour12: false }).format(ms)) % 24;

/** The changes not told yet, newest first: those above the last one told; without a mark, those of today and yesterday. */
export function changesSince(lines: string[], told: string | null, nowMs: number): string[] {
  if (!told) { const from = dateIn(nowMs - DAY); return lines.filter(line => line.slice(0, 10) >= from); }
  // The mark is kept to 300 characters (saga_status), so a long line is matched by its beginning.
  const at = lines.findIndex(line => line.slice(0, 300) === told);
  return at >= 0 ? lines.slice(0, at) : lines.filter(line => line.slice(0, 10) > told.slice(0, 10));
}

const ASK = {
  da: "Skriv en kort besked på dansk til formanden for foreningen Hjerterum om, hvad der er lavet på hjemmesiden, medlemssiden og admin siden sidst. Du får listen over ændringerne, som udviklerne skrev dem.",
  en: "Write a short message in English to Douglas, a board member of the Hjerterum association, about what has been done on the website, the member pages and admin since last time. You get the list of changes as the developers wrote them (in Danish)."
};
const RULES = "Begynd med én kort linje (fx \"Nyt i dag på Hjerterums sider:\"), og skriv så højst 10 punkter med \"• \", ét pr. ændring, i almindelige ord for en, der ikke er udvikler: hvad man nu kan, eller hvad der er rettet. Slå ændringer, der hører sammen, sammen. Udelad rent tekniske ændringer (tests, opsætning, intern oprydning). Ingen markdown, ingen links, ingen hilsen til sidst. Hvis intet er værd at nævne, så svar kun: INTET";

async function message(env: SagaEnv, deps: SagaDeps, lang: "da" | "en", lines: string[]): Promise<string | null> {
  try {
    const text = (await completeAs("change-digest", "mid", 900)(env, deps, [{ role: "system", content: `${ASK[lang]}\n\n${RULES}` }, { role: "user", content: lines.join("\n") }])).trim();
    return /^INTET\b/.test(text) ? null : text;
  } catch {
    // Without the model: the list as it is.
    return `${lang === "da" ? "Nyt på Hjerterums sider:" : "New on Hjerterum's pages:"}\n${lines.slice(0, 12).map(line => `• ${line.slice(11)}`).join("\n")}`;
  }
}

/** The Telegram accounts of those named, from the logins Saga has sent them (as wishes.ts tellAuthor). */
async function telegramOf(db: D1Database, name: string): Promise<string | null> {
  const row = await db.prepare("SELECT telegram_id FROM cockpit_login_links WHERE (member = ? OR member LIKE ? || ' %') AND telegram_id IS NOT NULL AND role IS NULL ORDER BY created_at_ms DESC LIMIT 1")
    .bind(name, name).first<{ telegram_id: string }>().catch(() => null);
  return row?.telegram_id ?? null;
}

export async function scheduledChangeDigest(env: SagaEnv, deps: SagaDeps, db: D1Database, claim: (key: string, slot: number) => Promise<boolean>, lines: string[] = RECENT_CHANGES): Promise<number> {
  const now = deps.now();
  if (!env.SAGA_TELEGRAM_BOT_TOKEN || !env.SAGA_OWNER_TELEGRAM_ID || hourIn(now) !== HOUR || !lines.length) return 0;
  if (!(await claim(KEY, Math.floor(now / DAY)))) return 0;
  const fresh = changesSince(lines, (await serviceStatus(db, KEY).catch(() => null))?.detail ?? null, now).slice(0, MAX_LINES);
  // The newest is marked first: a failed send is not repeated tomorrow with the next day's changes on top.
  await setServiceStatus(db, KEY, true, lines[0]!.slice(0, 300), now);
  if (!fresh.length) return 0;
  const telegram = telegramClient(env, deps);
  let sent = 0;
  const da = await message(env, deps, "da", fresh);
  if (da) { await telegram.sendMessage(env.SAGA_OWNER_TELEGRAM_ID, da).then(() => sent++).catch(() => undefined); }
  const others = [...new Set(POWERS["wishes.write"].also ?? [])];
  const ids = (await Promise.all(others.map(name => telegramOf(db, name)))).filter((id): id is string => Boolean(id) && id !== env.SAGA_OWNER_TELEGRAM_ID);
  if (ids.length) {
    const en = await message(env, deps, "en", fresh);
    if (en) for (const id of ids) await telegram.sendMessage(id, en).then(() => sent++).catch(() => undefined);
  }
  return sent;
}
