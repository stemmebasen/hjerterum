import { raw } from "../web/html.js";

/** Flokk's mark: the open circle – five people in a ring with one place free, because there is always room for one
 * more. The same drawing, large, is the front page's picture; public/assets/flokk-icon.svg is the tab's icon. */

const RING = [[20, 7], [31.26, 13.5], [31.26, 26.5], [20, 33], [8.74, 26.5], [8.74, 13.5]] as const;
const FILLS = ["#1e6b56", "#b3164f", null, "#ffe08a", "#17332d", "#e4defa"] as const;

function ring(scale: number, dot: number, stroke: number): string {
  return RING.map(([x, y], i) => {
    const cx = (x * scale).toFixed(2), cy = (y * scale).toFixed(2);
    const fill = FILLS[i];
    return fill
      ? `<circle cx="${cx}" cy="${cy}" r="${dot}" fill="${fill}"${fill === "#ffe08a" || fill === "#e4defa" ? ` stroke="#17332d" stroke-width="${stroke}"` : ""}/>`
      : `<circle cx="${cx}" cy="${cy}" r="${(dot - stroke / 2).toFixed(2)}" fill="none" stroke="#17332d" stroke-width="${stroke}" stroke-dasharray="${stroke * 1.6} ${stroke * 1.4}"/>`;
  }).join("");
}

export const FLOKK_MARK = raw(`<svg class="mark mark-flokk" viewBox="0 0 40 40" aria-hidden="true">${ring(1, 4.6, 1.4)}</svg>`);

export const OPEN_CIRCLE_ART = raw(`<svg class="f-circle-art" viewBox="0 0 400 400" role="img" aria-label="Fem mennesker i en rundkreds med én ledig plads">
<circle cx="200" cy="200" r="168" fill="#dff1e7"/>
<circle cx="200" cy="200" r="74" fill="#fffdf8"/>
${ring(10, 38, 4)}
<text x="312.6" y="274" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-weight="600" font-size="27" fill="#b3164f">dig?</text>
</svg>`);
