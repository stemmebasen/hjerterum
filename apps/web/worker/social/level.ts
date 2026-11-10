import { addDays, at, dateOf, EXTRA_GAP_MS, hourOf, MAX_PER_DAY, POST_GAP_MS } from "./plan.js";

/** Asked (the chair, 10 Nov 2026): "Det her ser helt ubalanceret ud. Der er kun ét opslag i morgen, men fem om et par dage." - "Hun må meget gerne fordele
 * dem jævnt fra og med i morgen tidlig." Every morning the proposals nobody has approved or moved are spread so the days carry about the same number of
 * posts - Facebook and Instagram counted together, as the calendar shows them (one entry when both go out at one time). A post only moves inside its own
 * window (its time before the event), keeps its time of day where it can, and Instagram stays at or after Facebook. */

export type LevelPost = { id: number; fb: number | null; ig: number | null; earliest: number; latest: number };
type Times = { fb: number | null; ig: number | null };
type Fixed = { id: number; t: number; channel: "fb" | "ig" };

/** Within a day, the times a moved post may take when its own is taken: Gitta's afternoon first, then lunch, the evening and the morning. */
const TIMES: Array<[number, number]> = [[15, 0], [12, 0], [19, 30], [9, 0], [17, 0], [9, 30], [17, 30]];

/** The new times of the posts that move; `fixed` are the times that stay (approved, sent, moved by the chair, the week's posts). */
export function levelDays(fixed: Fixed[], posts: LevelPost[], fromMs: number, toMs: number): Map<number, Times> {
  // Danish dates and times are worked out with Intl, which is slow: each once.
  const dayCache = new Map<number, string>(), atCache = new Map<string, number>(), hourCache = new Map<number, number>();
  const dayOf = (t: number) => { let d = dayCache.get(t); if (d === undefined) { d = dateOf(t); dayCache.set(t, d); } return d; };
  const atOf = (day: string, h: number, m: number) => { const k = `${day} ${h}:${m}`; let t = atCache.get(k); if (t === undefined) { t = at(day, h, m); atCache.set(k, t); } return t; };
  const hourIn = (t: number) => { let h = hourCache.get(t); if (h === undefined) { h = hourOf(t); hourCache.set(t, h); } return h; };

  const days: string[] = [];
  for (let d = dayOf(fromMs); atOf(d, 0, 0) <= toMs; d = addDays(d, 1)) days.push(d);
  const inRange = new Set(days);
  const current = new Map<number, Times>(posts.map(p => [p.id, { fb: p.fb, ig: p.ig }]));

  // The calendar's entries per day, and each medium's times per day (for "two hours apart" and "at most five").
  const count = new Map<string, number>(days.map(d => [d, 0]));
  const onChannel = { fb: new Map<string, Array<{ id: number; t: number }>>(), ig: new Map<string, Array<{ id: number; t: number }>>() };
  const entriesOf = (t: Times) => [...new Set([t.fb, t.ig].filter((x): x is number => x !== null))];
  const add = (id: number, t: Times, sign: 1 | -1) => {
    for (const x of entriesOf(t)) { const d = dayOf(x); if (count.has(d)) count.set(d, count.get(d)! + sign); }
    for (const channel of ["fb", "ig"] as const) {
      const x = t[channel]; if (x === null) continue;
      const d = dayOf(x), list = onChannel[channel].get(d) ?? [];
      onChannel[channel].set(d, sign > 0 ? [...list, { id, t: x }] : list.filter(o => !(o.id === id && o.t === x)));
    }
  };
  const fixedById = new Map<number, Times>();
  for (const f of fixed) { const t = fixedById.get(f.id) ?? { fb: null, ig: null }; t[f.channel] = f.t; fixedById.set(f.id, t); }
  for (const [id, t] of fixedById) add(id, t, 1);
  for (const [id, t] of current) add(id, t, 1);

  // A time on `day` for one medium: its own time of day if nothing on that medium is within two hours, else the first of TIMES that is.
  const place = (day: string, own: number, channel: "fb" | "ig", id: number, lo: number, hi: number): number | null => {
    const same = (onChannel[channel].get(day) ?? []).filter(o => o.id !== id);
    if (same.length >= MAX_PER_DAY) return null;
    const ok = (t: number) => t >= lo && t <= hi && same.every(o => Math.abs(o.t - t) >= EXTRA_GAP_MS);
    const ownTime = atOf(day, hourIn(own), new Date(own).getUTCMinutes());
    if (ok(ownTime)) return ownTime;
    for (const [h, m] of TIMES) { const t = atOf(day, h, m); if (ok(t)) return t; }
    return null;
  };
  // How much the days even out (the sum of the squares falls) when a post goes from `from` to `to`.
  const gainOf = (from: Times, to: Times) => {
    const change = new Map<string, number>();
    for (const x of entriesOf(from)) { const d = dayOf(x); if (count.has(d)) change.set(d, (change.get(d) ?? 0) - 1); }
    for (const x of entriesOf(to)) { const d = dayOf(x); if (count.has(d)) change.set(d, (change.get(d) ?? 0) + 1); }
    let gain = 0;
    for (const [d, c] of change) { const n = count.get(d)!; gain += n * n - (n + c) * (n + c); }
    return gain;
  };

  for (let round = 0; round < 300; round++) {
    let best: { id: number; to: Times; gain: number } | null = null;
    for (const p of posts) {
      const c = current.get(p.id)!, main = c.fb ?? c.ig;
      if (main === null || !inRange.has(dayOf(main))) continue;
      const lo = Math.max(p.earliest, fromMs), hi = Math.min(p.latest, toMs);
      const mainDay = dayOf(main);
      for (const day of days) {
        if (day === mainDay || atOf(day, 23, 59) < lo || atOf(day, 0, 0) > hi) continue;
        const shift = (Date.parse(`${day}T12:00:00Z`) - Date.parse(`${mainDay}T12:00:00Z`)) / 86_400_000;
        let fb: number | null = null, ig: number | null = null;
        if (c.fb !== null) { fb = place(day, c.fb, "fb", p.id, lo, hi); if (fb === null) continue; }
        if (c.ig !== null) {
          if (c.fb !== null && c.ig === c.fb) ig = fb;
          else {
            ig = place(addDays(dayOf(c.ig), shift), c.ig, "ig", p.id, lo, hi);
            // Instagram at Facebook's time or three hours after it, never before; else with Facebook.
            if (ig === null || (fb !== null && ig !== fb && ig < fb + POST_GAP_MS)) ig = fb ?? ig;
            if (ig === null) continue;
          }
        }
        const to = { fb, ig }, gain = gainOf(c, to);
        if (gain > 0 && (!best || gain > best.gain)) best = { id: p.id, to, gain };
      }
    }
    if (!best) break;
    add(best.id, current.get(best.id)!, -1);
    current.set(best.id, best.to);
    add(best.id, best.to, 1);
  }
  const out = new Map<number, Times>();
  for (const p of posts) { const c = current.get(p.id)!; if (c.fb !== p.fb || c.ig !== p.ig) out.set(p.id, c); }
  return out;
}
