/** The chair (27 Nov 2026): "Det er vigtigt at Jewel briefer Douglas og giver en eta på hvornår hans ændringer cirka er live". The approved requests are
 * made at fixed checks (the scheduled task "Lav Douglas' forslag til udvikling": 09, 12, 15, 18 and 21 in Copenhagen). A request is expected live
 * the work's time after the next check - a small one about an hour, a medium one about three, a large one the day after - and never at night: what
 * would land after 22 lands the next day around noon. An estimate, said as one. */
const ZONE = "Europe/Copenhagen";
export const CHECK_HOURS = [9, 12, 15, 18, 21];
const WORK_HOURS: Record<string, number> = { lille: 1, mellem: 3, stor: 24 };
const HOUR = 3_600_000, DAY = 24 * HOUR;

const parts = (ms: number) => Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
  .formatToParts(ms).map(p => [p.type, p.value])) as Record<string, string>;
/** The wall clock in Copenhagen, written as if it were UTC. */
const wall = (ms: number) => { const p = parts(ms); return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)); };
/** The moment a Copenhagen wall-clock time stands for. */
const fromWall = (w: number) => { const guess = w - (wall(w) - w); return guess - (wall(guess) - w); };

export function liveEta(size: string | null | undefined, nowMs: number): number {
  const now = wall(nowMs), midnight = now - (now % DAY), minutes = (now - midnight) / 60_000;
  const next = CHECK_HOURS.find(h => h * 60 > minutes);
  const check = next === undefined ? midnight + DAY + CHECK_HOURS[0]! * HOUR : midnight + next * HOUR;
  let eta = check + (WORK_HOURS[size ?? ""] ?? WORK_HOURS.mellem!) * HOUR;
  const hour = Math.floor((eta % DAY) / HOUR);
  if (hour >= 22 || hour < 9) eta = eta - (eta % DAY) + (hour >= 22 ? DAY : 0) + 12 * HOUR;
  return fromWall(eta);
}

/** "i dag ca. kl. 13" / "today around 13:00"; "i morgen ...", or the weekday and date. */
export function etaText(etaMs: number, nowMs: number, lang: "da" | "en"): string {
  const day = (ms: number) => { const w = wall(ms); return w - (w % DAY); };
  const diff = Math.round((day(etaMs) - day(nowMs)) / DAY);
  const hour = parts(etaMs).hour!.replace(/^0/, "");
  if (lang === "en") {
    const when = diff === 0 ? "today" : diff === 1 ? "tomorrow" : new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, weekday: "long", day: "numeric", month: "long" }).format(etaMs);
    return `${when} around ${hour.padStart(2, "0")}:00`;
  }
  const when = diff === 0 ? "i dag" : diff === 1 ? "i morgen" : new Intl.DateTimeFormat("da-DK", { timeZone: ZONE, weekday: "long", day: "numeric", month: "long" }).format(etaMs);
  return `${when} ca. kl. ${hour}`;
}
