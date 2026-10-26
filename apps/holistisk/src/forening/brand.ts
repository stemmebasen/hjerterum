import { raw } from "../web/html.js";

/** Flokk's mark: a row of people side by side – one place in it free, because there is always room for one more. The
 * same idea, large, is the front page's picture: a small flock seen from behind, in a row in front of a stage, with an
 * empty seat. Drawn soft – filled shapes, no outlines – unlike the event portal's chunky look.
 * public/assets/flokk-icon.svg is the tab's icon. */

const FREE = "#a8495f";

/** A head and shoulders seen from behind, `w` wide, standing on y = base; null draws the free place, dotted. */
function figure(x: number, base: number, w: number, fill: string | null, line: number): string {
  const r = w * 0.36, h = w * 0.62, top = base - h;
  const shoulders = `M${(x - w / 2).toFixed(2)} ${base}v${(-h * 0.35).toFixed(2)}a${(w / 2).toFixed(2)} ${(h * 0.65).toFixed(2)} 0 0 1 ${w} 0v${(h * 0.35).toFixed(2)}z`;
  const head = `cx="${x}" cy="${(top - r * 0.95).toFixed(2)}" r="${r.toFixed(2)}"`;
  if (!fill) return `<g fill="#fbe9ee" stroke="${FREE}" stroke-width="${line}" stroke-linecap="round" stroke-dasharray="${(line * 0.1).toFixed(2)} ${(line * 2.2).toFixed(2)}"><circle ${head}/><path d="${shoulders}"/></g>`;
  return `<circle ${head} fill="${fill}"/><path d="${shoulders}" fill="${fill}"/>`;
}

const MARK_PEOPLE = ["#6fa58c", "#d98a9d", "#e8c35f", null, "#9f92d4"] as const;

export const FLOKK_MARK = raw(`<svg class="mark mark-flokk" viewBox="0 0 64 34" aria-hidden="true">${MARK_PEOPLE.map((c, i) => figure(6.5 + i * 12.75, 33, 11, c, 1.6)).join("")}</svg>`);

const PEOPLE = ["#9cc3ae", "#e9a9b8", "#f2d58a", null, "#c9bfe8", "#f1c2a2"] as const;

export const ROW_ART = raw(`<svg class="f-row-art" viewBox="0 0 440 340" role="img" aria-label="En lille flok set bagfra på en stolerække foran en scene – med én ledig plads">
<defs>
  <linearGradient id="f-stage" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3efe8"/><stop offset="1" stop-color="#f3ece4"/></linearGradient>
  <clipPath id="f-stage-clip"><rect x="20" y="10" width="400" height="180" rx="48"/></clipPath>
  <radialGradient id="f-glow" cx=".5" cy="1" r=".75"><stop offset="0" stop-color="#fbe7b5"/><stop offset=".55" stop-color="#fbefd4" stop-opacity=".8"/><stop offset="1" stop-color="#fbefd4" stop-opacity="0"/></radialGradient>
</defs>
<rect x="20" y="10" width="400" height="180" rx="48" fill="url(#f-stage)"/>
<ellipse cx="220" cy="190" rx="190" ry="150" fill="url(#f-glow)" clip-path="url(#f-stage-clip)"/>
${[70, 130, 190, 250, 310, 370].map((x, i) => {
  // The row curves towards the stage: its ends sit a little further forward (higher in the picture).
  const seat = 262 - (x - 220) ** 2 / 1100;
  return `<ellipse cx="${x}" cy="${(seat + 50).toFixed(1)}" rx="30" ry="5" fill="#e9dfd2"/>${figure(x, seat + 6, 54, PEOPLE[i] ?? null, 3)}<rect x="${x - 28}" y="${seat.toFixed(1)}" width="56" height="48" rx="18" fill="#efe4d6"/>`;
}).join("")}
<text x="250" y="150" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-style="italic" font-weight="500" font-size="28" fill="${FREE}">dig?</text>
</svg>`);
