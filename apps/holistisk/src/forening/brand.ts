import { raw } from "../web/html.js";

/** Flokk's mark: a row of people side by side – one place in it free, because there is always room for one more. The
 * same idea, large, is the front page's picture: a small flock seen from behind, in a row in front of a stage, with an
 * empty seat, on a night out: a lit stage, a microphone, spotlights. Filled shapes in clear colours, no outlines –
 * unlike the event portal's chunky look.
 * public/assets/flokk-icon.svg is the tab's icon. */

const FREE = "#a8495f";

/** A head and shoulders seen from behind, `w` wide, standing on y = base; null draws the free place, dotted in `free`
 * ([fill, line]). */
function figure(x: number, base: number, w: number, fill: string | null, line: number, free: readonly [string, string] = ["#fbe9ee", FREE]): string {
  const r = w * 0.36, h = w * 0.62, top = base - h;
  const shoulders = `M${(x - w / 2).toFixed(2)} ${base}v${(-h * 0.35).toFixed(2)}a${(w / 2).toFixed(2)} ${(h * 0.65).toFixed(2)} 0 0 1 ${w} 0v${(h * 0.35).toFixed(2)}z`;
  const head = `cx="${x}" cy="${(top - r * 0.95).toFixed(2)}" r="${r.toFixed(2)}"`;
  if (!fill) return `<g fill="${free[0]}" stroke="${free[1]}" stroke-width="${line}" stroke-linecap="round" stroke-dasharray="${(line * 0.1).toFixed(2)} ${(line * 2.2).toFixed(2)}"><circle ${head}/><path d="${shoulders}"/></g>`;
  return `<circle ${head} fill="${fill}"/><path d="${shoulders}" fill="${fill}"/>`;
}

const MARK_PEOPLE = ["#3f9c78", "#e0607a", "#f0b429", null, "#8a78e0"] as const;

export const FLOKK_MARK = raw(`<svg class="mark mark-flokk" viewBox="0 0 64 34" aria-hidden="true">${MARK_PEOPLE.map((c, i) => figure(6.5 + i * 12.75, 33, 11, c, 1.6)).join("")}</svg>`);

const PEOPLE = ["#8fd1b5", "#ef8a8a", "#f6c445", null, "#b3a6f2", "#f5a77f"] as const;
const BUTTER = "#f6c445";

/** Drawn for the dark hero. */
export const ROW_ART = raw(`<svg class="f-row-art" viewBox="0 0 440 340" role="img" aria-label="En lille flok set bagfra på en stolerække foran en oplyst scene – med én ledig plads">
<defs>
  <linearGradient id="f-beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BUTTER}" stop-opacity=".45"/><stop offset="1" stop-color="${BUTTER}" stop-opacity="0"/></linearGradient>
  <radialGradient id="f-pool" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${BUTTER}" stop-opacity=".55"/><stop offset="1" stop-color="${BUTTER}" stop-opacity="0"/></radialGradient>
</defs>
<rect x="30" y="40" width="380" height="156" rx="36" fill="#28493f"/>
<path d="M120 40h18l52 150h-120z" fill="url(#f-beam)"/><path d="M302 40h18l50 150h-120z" fill="url(#f-beam)"/>
<circle cx="129" cy="40" r="11" fill="${BUTTER}"/><circle cx="311" cy="40" r="11" fill="${BUTTER}"/>
<ellipse cx="220" cy="176" rx="140" ry="22" fill="url(#f-pool)"/>
<g fill="#fbf3e6"><rect x="147" y="118" width="6" height="62" rx="3"/><rect x="130" y="176" width="40" height="7" rx="3.5"/><rect x="138" y="98" width="24" height="30" rx="12"/></g>
<circle cx="24" cy="92" r="7" fill="#ef8a8a"/><circle cx="420" cy="110" r="9" fill="#8fd1b5"/><circle cx="404" cy="18" r="6" fill="#b3a6f2"/><circle cx="46" cy="16" r="5" fill="${BUTTER}"/>
${[70, 130, 190, 250, 310, 370].map((x, i) => {
  // The row curves towards the stage: its ends sit a little further forward (higher in the picture).
  const seat = 262 - (x - 220) ** 2 / 1100;
  return `<ellipse cx="${x}" cy="${(seat + 50).toFixed(1)}" rx="30" ry="6" fill="#16302a"/>${figure(x, seat + 6, 56, PEOPLE[i] ?? null, 3, ["#2c4d44", BUTTER])}<rect x="${x - 28}" y="${seat.toFixed(1)}" width="56" height="48" rx="22" fill="#3a5f54"/>`;
}).join("")}
<text x="262" y="150" text-anchor="middle" font-family="Bricolage Grotesque, Lexend, sans-serif" font-weight="800" font-size="26" fill="${BUTTER}">dig?</text>
</svg>`);

/** A small flock of `n` side by side, for the example cards. */
export function flockArt(n: number, colour = "#1d3a33"): ReturnType<typeof raw> {
  const w = 22, gap = 5, width = n * w + (n - 1) * gap + 4;
  return raw(`<svg class="f-ex-flock" viewBox="0 0 ${width} 34" aria-hidden="true">${Array.from({ length: n }, (_, i) => figure(2 + w / 2 + i * (w + gap), 33, w, colour, 1.6)).join("")}</svg>`);
}
