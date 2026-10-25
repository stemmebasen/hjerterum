import { raw } from "../web/html.js";

/** Flokk's mark: a row of people side by side – one place in it free, because there is always room for one more. The
 * same idea, large, is the front page's picture: a small flock seen from behind, in a row in front of a stage, with an
 * empty seat. public/assets/flokk-icon.svg is the tab's icon. */

const INK = "#17332d";
const light = (c: string) => c === "#ffe08a" || c === "#e4defa";

/** A head and shoulders seen from behind, `w` wide, standing on y = base; null draws the free place, dashed. */
function figure(x: number, base: number, w: number, fill: string | null, stroke: number): string {
  const r = w * 0.36, h = w * 0.62, top = base - h;
  const shoulders = `M${(x - w / 2).toFixed(2)} ${base}v${(-h * 0.35).toFixed(2)}a${(w / 2).toFixed(2)} ${(h * 0.65).toFixed(2)} 0 0 1 ${w} 0v${(h * 0.35).toFixed(2)}z`;
  const head = `cx="${x}" cy="${(top - r * 0.95).toFixed(2)}" r="${r.toFixed(2)}"`;
  if (!fill) return `<g fill="none" stroke="${INK}" stroke-width="${stroke}" stroke-dasharray="${(stroke * 2).toFixed(1)} ${(stroke * 1.7).toFixed(1)}"><circle ${head}/><path d="${shoulders.replace(/z$/, "")}"/></g>`;
  const line = light(fill) ? ` stroke="${INK}" stroke-width="${stroke}"` : "";
  return `<circle ${head} fill="${fill}"${line}/><path d="${shoulders}" fill="${fill}"${line}/>`;
}

const ROW = ["#1e6b56", "#b3164f", "#ffe08a", null, "#17332d"] as const;

export const FLOKK_MARK = raw(`<svg class="mark mark-flokk" viewBox="0 0 64 34" aria-hidden="true">${ROW.map((c, i) => figure(6.5 + i * 12.75, 33, 11, c, 1.4)).join("")}</svg>`);

const PEOPLE = ["#1e6b56", "#b3164f", "#ffe08a", null, "#e4defa", "#17332d"] as const;

export const ROW_ART = raw(`<svg class="f-row-art" viewBox="0 0 440 340" role="img" aria-label="En lille flok set bagfra på en stolerække foran en scene – med én ledig plads">
<defs><clipPath id="stage"><rect x="24" y="12" width="392" height="170" rx="28"/></clipPath></defs>
<rect x="24" y="12" width="392" height="170" rx="28" fill="#dff1e7"/>
<ellipse cx="220" cy="182" rx="150" ry="112" fill="#fff3c9" clip-path="url(#stage)"/>
<ellipse cx="220" cy="182" rx="70" ry="52" fill="#ffe08a" opacity=".55" clip-path="url(#stage)"/>
${[70, 130, 190, 250, 310, 370].map((x, i) => {
  // The row curves towards the stage: its ends sit a little further forward (higher in the picture).
  const seat = 262 - (x - 220) ** 2 / 1100;
  return `${figure(x, seat + 6, 54, PEOPLE[i] ?? null, 3)}<rect x="${x - 28}" y="${seat.toFixed(1)}" width="56" height="50" rx="14" fill="#e3d7c2" stroke="${INK}" stroke-width="3"/>`;
}).join("")}
<text x="250" y="148" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-style="italic" font-weight="600" font-size="28" fill="#b3164f">dig?</text>
</svg>`);
