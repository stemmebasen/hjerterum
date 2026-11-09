import type { PosterWords } from "./event-poster";

/** Asked (the chair, 7 Nov 2026): "Vi er nødt til at optimere den grafiske sektion ... flytte rundt på billeder, gøre dem mindre eller større og dreje dem rundt.
 * Altså et lille mini Photoshop ... Jeg synes heller ikke, at de designforslag, der er, er fyldestgørende. Det kommer til at ligne det samme, det hele." -
 * "Egen editor med lag". Designs made of layers - pictures in frames, words, shapes and the logo - each a different composition, not the same layout in another
 * colour. The editor (design-editor.tsx) opens them with every layer movable, sizable and turnable. Pure: positions in the format's own pixels. */

export type Frame = "rect" | "round" | "circle" | "arch" | "pebble";
export type Layer =
  | { kind: "photo"; slot?: 1 | 2 | 3; x: number; y: number; w: number; h: number; angle?: number; frame?: Frame; zoom?: number; focus?: [number, number]; border?: { width: number; bottom?: number; color: string }; shadow?: boolean; grayscale?: boolean; opacity?: number }
  | { kind: "text"; role?: "title" | "sub" | "date" | "kicker" | "small" | "quote"; text: string; x: number; y: number; w: number; size: number; font: "serif" | "sans"; color: string;
      weight?: 400 | 500 | 600 | 700; italic?: boolean; align?: "left" | "center" | "right"; lineHeight?: number; spacing?: number; angle?: number; opacity?: number; maxLines?: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number; fill: string; radius?: number; angle?: number; opacity?: number; stroke?: string; strokeWidth?: number; dash?: number[];
      gradient?: Array<[number, string]> }
  | { kind: "circle"; x: number; y: number; r: number; fill: string; opacity?: number; stroke?: string; strokeWidth?: number }
  | { kind: "path"; d: string; x: number; y: number; w: number; h: number; fill: string; angle?: number; opacity?: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; stroke: string; width: number; dash?: number[] }
  | { kind: "logo"; x: number; y: number; size: number; color: string; angle?: number };

export type LayerDesign = { key: string; label: string; about: string; background: string; layers: Layer[] };
export type Colors = { cream: string; sand: string; ink: string; muted: string; terra: string; camel: string; sage: string; blush: string; dusk: string };
export type LayerInput = { W: number; H: number; words: PosterWords; colors: Colors; site: string; quote: string | null };

const upper = (s: string) => s.toLocaleUpperCase("da-DK");
const teacherLine = (w: PosterWords) => w.teacher ? `med ${w.teacher}` : w.rest ?? "";
const dateLine = (w: PosterWords) => `${w.day} · kl. ${w.time}`;

/** A wide cover (Facebook) of any design: its picture in its frame to the left, the words to the right, in its colours. */
function landscape(i: LayerInput, key: string, label: string, about: string, bg: string, ink: string, accent: string, frame: Frame): LayerDesign {
  const { W, H, words: w } = i, u = H / 1005;
  const px = W * 0.05, pw = W * 0.45;
  return { key, label, about, background: bg, layers: [
    { kind: "photo", x: px, y: H * 0.08, w: pw, h: H * 0.84, frame, shadow: frame !== "rect" },
    { kind: "text", role: "kicker", text: upper(w.kicker), x: W * 0.55, y: H * 0.14, w: W * 0.4, size: 30 * u, font: "sans", color: accent, weight: 600, spacing: 300 },
    { kind: "text", role: "title", text: w.title, x: W * 0.55, y: H * 0.22, w: W * 0.4, size: 96 * u, font: "serif", color: ink, maxLines: 3, lineHeight: 1.05 },
    { kind: "text", role: "sub", text: teacherLine(w), x: W * 0.55, y: H * 0.6, w: W * 0.4, size: 44 * u, font: "serif", color: accent, italic: true },
    { kind: "text", role: "date", text: dateLine(w), x: W * 0.55, y: H * 0.72, w: W * 0.4, size: 32 * u, font: "sans", color: ink, weight: 500 },
    { kind: "text", role: "small", text: i.site, x: W * 0.55, y: H * 0.79, w: W * 0.3, size: 26 * u, font: "sans", color: ink, opacity: 0.75 },
    { kind: "logo", x: W * 0.86, y: H * 0.72, size: H * 0.2, color: ink },
  ] };
}

type Maker = { key: string; label: string; about: string; frame: Frame; make: (i: LayerInput) => LayerDesign };

// ---- Botanical shapes (drawn leaves and stems - never a logo) ----
const LEAF = "M0 26 C 28 -4 72 -4 100 26 C 72 56 28 56 0 26 Z";
/** One leaf, its middle at (cx, cy), `len` long, turned `angle` degrees. */
const leaf = (cx: number, cy: number, len: number, angle: number, fill: string, opacity = 1): Layer =>
  ({ kind: "path", d: LEAF, x: cx - len / 2, y: cy - len * 0.26, w: len, h: len * 0.52, fill, angle, opacity });
/** A sprig: a stem from (x0, y0) to (x1, y1) with leaves on both sides, smaller towards the tip. */
function sprig(x0: number, y0: number, x1: number, y1: number, n: number, len: number, stem: string, fill: string, opacity = 1): Layer[] {
  const dir = Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI;
  const leaves: Layer[] = [{ kind: "line", x1: x0, y1: y0, x2: x1, y2: y1, stroke: stem, width: Math.max(2, len * 0.04) }];
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1), side = i % 2 ? 1 : -1, size = len * (1 - t * 0.45);
    const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t, a = (dir + side * 38) * Math.PI / 180;
    leaves.push(leaf(px + Math.cos(a) * size * 0.45, py + Math.sin(a) * size * 0.45, size, dir + side * 38, fill, opacity));
  }
  leaves.push(leaf(x1 + Math.cos(dir * Math.PI / 180) * len * 0.25, y1 + Math.sin(dir * Math.PI / 180) * len * 0.25, len * 0.5, dir, fill, opacity));
  return leaves;
}
/** A wreath of leaves around (cx, cy), radius r, with a few berries. */
function wreath(cx: number, cy: number, r: number, n: number, len: number, fill: string, berry: string): Layer[] {
  const out: Layer[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * Math.PI, wob = i % 2 ? 1.06 : 0.94;
    out.push(leaf(cx + Math.cos(t) * r * wob, cy + Math.sin(t) * r * wob, len * (i % 3 ? 1 : 0.8), (t * 180) / Math.PI + 90 + (i % 2 ? 25 : -25), fill, i % 4 ? 0.95 : 0.7));
    if (i % 5 === 2) out.push({ kind: "circle", x: cx + Math.cos(t + 0.15) * r, y: cy + Math.sin(t + 0.15) * r, r: len * 0.09, fill: berry });
  }
  return out;
}

export const LAYER_DESIGNS: Maker[] = [
  { key: "polaroid", label: "Polaroids", about: "Fotoet som et polaroid på bordet, datoen på et kort ved siden af.", frame: "rect", make: i => {
    const { W, H, words: w, colors: c } = i, u = W / 1080;
    return { key: "polaroid", label: "Polaroids", about: "", background: c.sand, layers: [
      { kind: "rect", x: W * 0.6, y: H * 0.09, w: W * 0.32, h: W * 0.38, fill: c.terra, radius: 10 * u, angle: 7 },
      { kind: "text", role: "date", text: w.number, x: W * 0.62, y: H * 0.13, w: W * 0.28, size: 160 * u, font: "serif", color: c.cream, align: "center", angle: 7, maxLines: 1 },
      { kind: "text", role: "small", text: upper(w.month), x: W * 0.62, y: H * 0.27, w: W * 0.28, size: 30 * u, font: "sans", color: c.cream, weight: 600, spacing: 250, align: "center", angle: 7, maxLines: 1 },
      { kind: "photo", x: W * 0.07, y: H * 0.06, w: W * 0.5, h: W * 0.5, angle: -5, border: { width: 24 * u, bottom: 90 * u, color: "#fffdf8" }, shadow: true },
      { kind: "text", role: "kicker", text: upper(w.kicker), x: W * 0.08, y: H * 0.6, w: W * 0.84, size: 30 * u, font: "sans", color: c.terra, weight: 600, spacing: 350 },
      { kind: "text", role: "title", text: w.title, x: W * 0.08, y: H * 0.64, w: W * 0.84, size: 104 * u, font: "serif", color: c.ink, maxLines: 3, lineHeight: 1.04 },
      { kind: "text", role: "sub", text: teacherLine(w), x: W * 0.08, y: H * 0.84, w: W * 0.6, size: 46 * u, font: "serif", color: c.muted, italic: true },
      { kind: "text", role: "date", text: `kl. ${w.time}`, x: W * 0.08, y: H * 0.9, w: W * 0.6, size: 34 * u, font: "sans", color: c.ink, weight: 500 },
      { kind: "logo", x: W * 0.8, y: H * 0.84, size: W * 0.15, color: c.ink },
    ] };
  } },
  { key: "magasin", label: "Magasinforside", about: "Fotoet over hele siden, navnet som et magasins titel og overskriften stor nederst.", frame: "rect", make: i => {
    const { W, H, words: w, colors: c } = i, u = W / 1080;
    return { key: "magasin", label: "Magasinforside", about: "", background: c.dusk, layers: [
      { kind: "photo", x: 0, y: 0, w: W, h: H },
      { kind: "rect", x: 0, y: 0, w: W, h: H, fill: "#000000", gradient: [[0, "rgba(20,14,10,0.45)"], [0.22, "rgba(20,14,10,0)"], [0.5, "rgba(20,14,10,0)"], [1, "rgba(20,14,10,0.88)"]] },
      { kind: "text", role: "kicker", text: "HJERTERUM", x: W * 0.06, y: H * 0.04, w: W * 0.88, size: 64 * u, font: "serif", color: c.cream, align: "center", spacing: 500 },
      { kind: "line", x1: W * 0.06, y1: H * 0.115, x2: W * 0.94, y2: H * 0.115, stroke: c.cream, width: 2 * u },
      { kind: "text", role: "small", text: upper(w.kicker), x: W * 0.06, y: H * 0.13, w: W * 0.88, size: 26 * u, font: "sans", color: c.cream, weight: 500, spacing: 400, align: "center" },
      { kind: "text", role: "title", text: w.title, x: W * 0.06, y: H * 0.6, w: W * 0.88, size: 118 * u, font: "serif", color: "#ffffff", maxLines: 3, lineHeight: 1.0 },
      { kind: "text", role: "sub", text: teacherLine(w), x: W * 0.06, y: H * 0.82, w: W * 0.7, size: 46 * u, font: "serif", color: c.blush, italic: true },
      { kind: "text", role: "date", text: dateLine(w), x: W * 0.06, y: H * 0.89, w: W * 0.7, size: 34 * u, font: "sans", color: "#ffffff", weight: 600 },
      { kind: "logo", x: W * 0.8, y: H * 0.85, size: W * 0.15, color: "#ffffff" },
    ] };
  } },
  { key: "typografi", label: "Stor typografi", about: "Overskriften fylder siden, fotoet i en lille cirkel.", frame: "circle", make: i => {
    const { W, H, words: w, colors: c } = i, u = W / 1080;
    return { key: "typografi", label: "Stor typografi", about: "", background: c.terra, layers: [
      { kind: "text", role: "kicker", text: upper(w.kicker), x: W * 0.08, y: H * 0.07, w: W * 0.6, size: 30 * u, font: "sans", color: c.blush, weight: 600, spacing: 400 },
      { kind: "text", role: "title", text: w.title, x: W * 0.08, y: H * 0.14, w: W * 0.72, size: 168 * u, font: "serif", color: c.cream, maxLines: 4, lineHeight: 0.98 },
      { kind: "photo", x: W * 0.55, y: H * 0.6, w: W * 0.38, h: W * 0.38, frame: "circle", border: { width: 10 * u, color: c.cream } },
      { kind: "text", role: "sub", text: teacherLine(w), x: W * 0.08, y: H * 0.66, w: W * 0.44, size: 48 * u, font: "serif", color: c.blush, italic: true },
      { kind: "text", role: "date", text: `${w.day}\nkl. ${w.time}`, x: W * 0.08, y: H * 0.76, w: W * 0.44, size: 38 * u, font: "sans", color: c.cream, weight: 600, lineHeight: 1.3 },
      { kind: "text", role: "small", text: i.site, x: W * 0.08, y: H * 0.9, w: W * 0.44, size: 28 * u, font: "sans", color: c.cream, opacity: 0.8 },
      { kind: "logo", x: W * 0.82, y: H * 0.06, size: W * 0.14, color: c.cream },
    ] };
  } },
  { key: "bue", label: "Buen", about: "Fotoet i en blød bue som en dør, ro og luft omkring.", frame: "arch", make: i => {
    const { W, H, words: w, colors: c } = i, u = W / 1080;
    return { key: "bue", label: "Buen", about: "", background: c.cream, layers: [
      { kind: "circle", x: W * 0.5, y: H * 0.33, r: W * 0.4, fill: c.blush, opacity: 0.7 },
      { kind: "photo", x: W * 0.2, y: H * 0.07, w: W * 0.6, h: H * 0.5, frame: "arch", shadow: true },
      { kind: "text", role: "kicker", text: upper(w.kicker), x: W * 0.1, y: H * 0.61, w: W * 0.8, size: 28 * u, font: "sans", color: c.terra, weight: 600, spacing: 400, align: "center" },
      { kind: "text", role: "title", text: w.title, x: W * 0.08, y: H * 0.65, w: W * 0.84, size: 92 * u, font: "serif", color: c.ink, maxLines: 2, align: "center", lineHeight: 1.05 },
      { kind: "text", role: "sub", text: teacherLine(w), x: W * 0.1, y: H * 0.8, w: W * 0.8, size: 44 * u, font: "serif", color: c.terra, italic: true, align: "center" },
      { kind: "line", x1: W * 0.42, y1: H * 0.865, x2: W * 0.58, y2: H * 0.865, stroke: c.camel, width: 3 * u },
      { kind: "text", role: "date", text: dateLine(w), x: W * 0.1, y: H * 0.88, w: W * 0.8, size: 32 * u, font: "sans", color: c.ink, weight: 500, align: "center" },
      { kind: "logo", x: W * 0.06, y: H * 0.04, size: W * 0.13, color: c.terra },
    ] };
  } },
  { key: "diagonal", label: "Skråt bånd", about: "Fotoet drejet en anelse, et farvet bånd med datoen skråt over siden.", frame: "rect", make: i => {
    const { W, H, words: w, colors: c } = i, u = W / 1080;
    return { key: "diagonal", label: "Skråt bånd", about: "", background: c.blush, layers: [
      { kind: "photo", x: -W * 0.04, y: H * 0.02, w: W * 1.08, h: H * 0.54, angle: -5 },
      { kind: "rect", x: -W * 0.1, y: H * 0.5, w: W * 1.2, h: H * 0.11, fill: c.terra, angle: -5 },
      { kind: "text", role: "date", text: upper(`${w.day} · kl. ${w.time}`), x: W * 0.05, y: H * 0.535, w: W * 0.9, size: 36 * u, font: "sans", color: c.cream, weight: 600, spacing: 200, align: "center", angle: -5, maxLines: 1 },
      { kind: "text", role: "title", text: w.title, x: W * 0.08, y: H * 0.66, w: W * 0.84, size: 100 * u, font: "serif", color: c.ink, maxLines: 3, lineHeight: 1.03 },
      { kind: "text", role: "sub", text: teacherLine(w), x: W * 0.08, y: H * 0.86, w: W * 0.62, size: 46 * u, font: "serif", color: c.terra, italic: true },
      { kind: "text", role: "small", text: i.site, x: W * 0.08, y: H * 0.92, w: W * 0.6, size: 28 * u, font: "sans", color: c.ink, opacity: 0.75 },
      { kind: "logo", x: W * 0.8, y: H * 0.84, size: W * 0.15, color: c.terra },
    ] };
  } },
  { key: "billet", label: "Billetten", about: "Eventet som en billet med perforering og en afrivningsdel med datoen.", frame: "round", make: i => {
    const { W, H, words: w, colors: c } = i, u = W / 1080;
    const cut = H * 0.69;
    return { key: "billet", label: "Billetten", about: "", background: c.camel, layers: [
      { kind: "rect", x: W * 0.06, y: H * 0.05, w: W * 0.88, h: H * 0.9, fill: c.cream, radius: 30 * u },
      { kind: "circle", x: W * 0.06, y: cut, r: 34 * u, fill: c.camel },
      { kind: "circle", x: W * 0.94, y: cut, r: 34 * u, fill: c.camel },
      { kind: "line", x1: W * 0.12, y1: cut, x2: W * 0.88, y2: cut, stroke: c.camel, width: 4 * u, dash: [14 * u, 12 * u] },
      { kind: "photo", x: W * 0.11, y: H * 0.085, w: W * 0.78, h: H * 0.36, frame: "round" },
      { kind: "text", role: "kicker", text: upper(`Adgangsbillet · ${w.kicker}`), x: W * 0.11, y: H * 0.47, w: W * 0.78, size: 26 * u, font: "sans", color: c.terra, weight: 600, spacing: 300 },
      { kind: "text", role: "title", text: w.title, x: W * 0.11, y: H * 0.5, w: W * 0.78, size: 82 * u, font: "serif", color: c.ink, maxLines: 2, lineHeight: 1.04 },
      { kind: "text", role: "sub", text: teacherLine(w), x: W * 0.11, y: H * 0.62, w: W * 0.78, size: 40 * u, font: "serif", color: c.muted, italic: true },
      { kind: "text", role: "date", text: w.number, x: W * 0.11, y: H * 0.72, w: W * 0.26, size: 150 * u, font: "serif", color: c.terra },
      { kind: "text", role: "date", text: `${upper(w.month)}\nkl. ${w.time}\n${i.site}`, x: W * 0.37, y: H * 0.745, w: W * 0.34, size: 30 * u, font: "sans", color: c.ink, weight: 500, lineHeight: 1.45 },
      { kind: "logo", x: W * 0.72, y: H * 0.74, size: W * 0.15, color: c.ink },
    ] };
  } },
  { key: "citat", label: "Citatet", about: "Et citat eller eventets egne ord stort, fotoet lille i en cirkel.", frame: "circle", make: i => {
    const { W, H, words: w, colors: c } = i, u = W / 1080;
    return { key: "citat", label: "Citatet", about: "", background: c.sage, layers: [
      { kind: "text", role: "kicker", text: "“", x: W * 0.07, y: H * 0.02, w: W * 0.3, size: 300 * u, font: "serif", color: c.terra },
      { kind: "text", role: "quote", text: i.quote ?? w.title, x: W * 0.1, y: H * 0.2, w: W * 0.8, size: 76 * u, font: "serif", color: c.ink, italic: true, maxLines: 6, lineHeight: 1.15 },
      // "Logoet og eventinfo er en lille smule for lille" (the chair, 9 Nov 2026).
      { kind: "photo", x: W * 0.08, y: H * 0.68, w: W * 0.26, h: W * 0.26, frame: "circle" },
      { kind: "text", role: "title", text: w.title, x: W * 0.38, y: H * 0.69, w: W * 0.56, size: 56 * u, font: "serif", color: c.ink, maxLines: 2 },
      { kind: "text", role: "sub", text: teacherLine(w), x: W * 0.38, y: H * 0.79, w: W * 0.56, size: 44 * u, font: "serif", color: c.terra, italic: true },
      { kind: "text", role: "date", text: dateLine(w), x: W * 0.38, y: H * 0.85, w: W * 0.56, size: 36 * u, font: "sans", color: c.ink, weight: 500 },
      { kind: "logo", x: W * 0.77, y: H * 0.03, size: W * 0.17, color: c.ink },
    ] };
  } },
  { key: "ramme", label: "Rammen", about: "En bred farvet ramme om fotoet og ordene, som et indrammet billede.", frame: "rect", make: i => {
    const { W, H, words: w, colors: c } = i, u = W / 1080;
    return { key: "ramme", label: "Rammen", about: "", background: c.dusk, layers: [
      { kind: "rect", x: W * 0.05, y: W * 0.05, w: W * 0.9, h: H - W * 0.1, fill: c.cream },
      { kind: "photo", x: W * 0.1, y: W * 0.1, w: W * 0.8, h: H * 0.5 },
      { kind: "rect", x: W * 0.1, y: W * 0.1, w: W * 0.8, h: H * 0.5, fill: "rgba(0,0,0,0)", stroke: c.camel, strokeWidth: 3 * u },
      { kind: "text", role: "kicker", text: upper(w.kicker), x: W * 0.1, y: H * 0.62, w: W * 0.8, size: 28 * u, font: "sans", color: c.terra, weight: 600, spacing: 350 },
      { kind: "text", role: "title", text: w.title, x: W * 0.1, y: H * 0.655, w: W * 0.8, size: 88 * u, font: "serif", color: c.ink, maxLines: 2, lineHeight: 1.04 },
      { kind: "text", role: "sub", text: teacherLine(w), x: W * 0.1, y: H * 0.79, w: W * 0.6, size: 42 * u, font: "serif", color: c.muted, italic: true },
      { kind: "text", role: "date", text: dateLine(w), x: W * 0.1, y: H * 0.86, w: W * 0.6, size: 30 * u, font: "sans", color: c.ink, weight: 500 },
      { kind: "logo", x: W * 0.76, y: H * 0.79, size: W * 0.14, color: c.terra },
    ] };
  } },
  { key: "kollage", label: "Kollagen", about: "Tre udsnit af fotoet side om side, et farvefelt med ordene.", frame: "rect", make: i => {
    const { W, H, words: w, colors: c } = i, u = W / 1080;
    return { key: "kollage", label: "Kollagen", about: "", background: c.cream, layers: [
      { kind: "photo", x: W * 0.05, y: W * 0.05, w: W * 0.57, h: H * 0.5, frame: "round" },
      { kind: "photo", slot: 2, x: W * 0.65, y: W * 0.05, w: W * 0.3, h: H * 0.24, frame: "round", zoom: 1.8, focus: [0.3, 0.35] },
      { kind: "photo", slot: 3, x: W * 0.65, y: W * 0.05 + H * 0.26, w: W * 0.3, h: H * 0.24, frame: "round", zoom: 2.4, focus: [0.65, 0.6], grayscale: true },
      { kind: "rect", x: W * 0.05, y: H * 0.58, w: W * 0.9, h: H * 0.37, fill: c.terra, radius: 22 * u },
      { kind: "text", role: "kicker", text: upper(w.kicker), x: W * 0.1, y: H * 0.615, w: W * 0.8, size: 28 * u, font: "sans", color: c.blush, weight: 600, spacing: 350 },
      { kind: "text", role: "title", text: w.title, x: W * 0.1, y: H * 0.65, w: W * 0.8, size: 86 * u, font: "serif", color: c.cream, maxLines: 2, lineHeight: 1.04 },
      { kind: "text", role: "sub", text: teacherLine(w), x: W * 0.1, y: H * 0.79, w: W * 0.56, size: 40 * u, font: "serif", color: c.blush, italic: true },
      { kind: "text", role: "date", text: dateLine(w), x: W * 0.1, y: H * 0.86, w: W * 0.6, size: 30 * u, font: "sans", color: c.cream, weight: 600 },
      { kind: "logo", x: W * 0.76, y: H * 0.8, size: W * 0.14, color: c.cream },
    ] };
  } },
  { key: "minimal", label: "Stilhed", about: "Meget luft, et lille foto, en tynd streg og overskriften roligt i midten.", frame: "rect", make: i => {
    const { W, H, words: w, colors: c } = i, u = W / 1080;
    return { key: "minimal", label: "Stilhed", about: "", background: c.cream, layers: [
      { kind: "logo", x: W * 0.44, y: H * 0.06, size: W * 0.12, color: c.ink },
      { kind: "photo", x: W * 0.3, y: H * 0.2, w: W * 0.4, h: H * 0.34, grayscale: false },
      { kind: "line", x1: W * 0.46, y1: H * 0.6, x2: W * 0.54, y2: H * 0.6, stroke: c.ink, width: 2 * u },
      { kind: "text", role: "title", text: w.title, x: W * 0.12, y: H * 0.63, w: W * 0.76, size: 64 * u, font: "serif", color: c.ink, maxLines: 3, align: "center", lineHeight: 1.12 },
      { kind: "text", role: "sub", text: teacherLine(w), x: W * 0.12, y: H * 0.78, w: W * 0.76, size: 36 * u, font: "serif", color: c.muted, italic: true, align: "center" },
      { kind: "text", role: "date", text: upper(dateLine(w)), x: W * 0.12, y: H * 0.86, w: W * 0.76, size: 24 * u, font: "sans", color: c.ink, weight: 600, spacing: 300, align: "center" },
      { kind: "text", role: "small", text: i.site, x: W * 0.12, y: H * 0.9, w: W * 0.76, size: 24 * u, font: "sans", color: c.muted, align: "center" },
    ] };
  } },
  // Requested (the chair, 9 Nov 2026): "De her er super gode. Kan du lave flere 4-5 flotte varianter med citater - gerne mere kunstneriske og botaniske. Logoet
  // og eventinfo er en lille smule for lille."
  { key: "citat-gren", label: "Citat med grene", about: "Citatet stort mellem to grene med blade, fotoet i en cirkel og eventet tydeligt nederst.", frame: "circle", make: i => {
    const { W, H, words: w, colors: c } = i, u = W / 1080;
    return { key: "citat-gren", label: "", about: "", background: c.cream, layers: [
      ...sprig(W * 1.02, H * 0.0, W * 0.76, H * 0.13, 6, 100 * u, c.camel, "#9fb18f", 0.9),
      ...sprig(W * 1.03, H * 1.0, W * 0.8, H * 0.93, 5, 90 * u, c.camel, "#b9c6a7", 0.9),
      { kind: "logo", x: W * 0.07, y: H * 0.04, size: W * 0.18, color: c.ink },
      { kind: "text", role: "quote", text: i.quote ?? w.title, x: W * 0.12, y: H * 0.2, w: W * 0.76, size: 78 * u, font: "serif", color: c.ink, italic: true, maxLines: 6, lineHeight: 1.15, align: "center" },
      { kind: "line", x1: W * 0.44, y1: H * 0.66, x2: W * 0.56, y2: H * 0.66, stroke: c.terra, width: 3 * u },
      { kind: "photo", x: W * 0.08, y: H * 0.7, w: W * 0.25, h: W * 0.25, frame: "circle", border: { width: 8 * u, color: "#ffffff" } },
      { kind: "text", role: "title", text: w.title, x: W * 0.38, y: H * 0.71, w: W * 0.56, size: 56 * u, font: "serif", color: c.ink, maxLines: 2 },
      { kind: "text", role: "sub", text: teacherLine(w), x: W * 0.38, y: H * 0.81, w: W * 0.56, size: 44 * u, font: "serif", color: c.terra, italic: true },
      { kind: "text", role: "date", text: dateLine(w), x: W * 0.38, y: H * 0.87, w: W * 0.56, size: 36 * u, font: "sans", color: c.ink, weight: 500 },
    ] };
  } },
  { key: "citat-krans", label: "Bladkransen", about: "Citatet inde i en krans af blade, fotoet og eventet under kransen.", frame: "round", make: i => {
    const { W, H, words: w, colors: c } = i, u = W / 1080, cy = H * 0.37, r = W * 0.37;
    return { key: "citat-krans", label: "", about: "", background: c.sage, layers: [
      ...wreath(W / 2, cy, r, 30, 90 * u, "#8ea37c", c.terra),
      { kind: "text", role: "quote", text: i.quote ?? w.title, x: W * 0.26, y: cy - r * 0.55, w: W * 0.48, size: 52 * u, font: "serif", color: c.ink, italic: true, maxLines: 7, lineHeight: 1.15, align: "center" },
      { kind: "logo", x: W * 0.79, y: H * 0.03, size: W * 0.16, color: c.ink },
      { kind: "photo", x: W * 0.08, y: H * 0.74, w: W * 0.28, h: W * 0.2, frame: "round" },
      { kind: "text", role: "title", text: w.title, x: W * 0.4, y: H * 0.74, w: W * 0.54, size: 54 * u, font: "serif", color: c.ink, maxLines: 2 },
      { kind: "text", role: "sub", text: teacherLine(w), x: W * 0.4, y: H * 0.835, w: W * 0.54, size: 42 * u, font: "serif", color: c.terra, italic: true },
      { kind: "text", role: "date", text: dateLine(w), x: W * 0.4, y: H * 0.89, w: W * 0.54, size: 34 * u, font: "sans", color: c.ink, weight: 600 },
    ] };
  } },
  { key: "citat-nat", label: "Nattehaven", about: "Lyse ord på mørk bund mellem bregner, fotoet i en bue.", frame: "arch", make: i => {
    const { W, H, words: w, colors: c } = i, u = W / 1080;
    return { key: "citat-nat", label: "", about: "", background: c.dusk, layers: [
      ...sprig(-W * 0.03, H * 0.19, W * 0.24, H * 0.02, 7, 100 * u, c.camel, c.camel, 0.55),
      ...sprig(W * 1.03, H * 0.19, W * 0.76, H * 0.02, 7, 100 * u, c.camel, c.blush, 0.45),
      ...sprig(W * 1.03, H * 1.0, W * 0.78, H * 0.94, 5, 90 * u, c.camel, c.camel, 0.4),
      { kind: "circle", x: W * 0.5, y: H * 0.1, r: 14 * u, fill: c.blush, opacity: 0.8 },
      { kind: "logo", x: W * 0.41, y: H * 0.03, size: W * 0.18, color: c.cream },
      { kind: "text", role: "quote", text: i.quote ?? w.title, x: W * 0.14, y: H * 0.2, w: W * 0.72, size: 76 * u, font: "serif", color: c.cream, italic: true, maxLines: 6, lineHeight: 1.15, align: "center" },
      { kind: "photo", x: W * 0.08, y: H * 0.64, w: W * 0.26, h: H * 0.28, frame: "arch", border: { width: 6 * u, color: c.camel } },
      { kind: "text", role: "title", text: w.title, x: W * 0.4, y: H * 0.68, w: W * 0.54, size: 56 * u, font: "serif", color: c.cream, maxLines: 2 },
      { kind: "text", role: "sub", text: teacherLine(w), x: W * 0.4, y: H * 0.79, w: W * 0.54, size: 44 * u, font: "serif", color: c.blush, italic: true },
      { kind: "text", role: "date", text: dateLine(w), x: W * 0.4, y: H * 0.86, w: W * 0.54, size: 36 * u, font: "sans", color: c.cream, weight: 600 },
    ] };
  } },
  { key: "citat-herbarium", label: "Herbariet", about: "Som en side fra en herbariebog: et presset foto med tape, en tegnet stilk og citatet.", frame: "rect", make: i => {
    const { W, H, words: w, colors: c } = i, u = W / 1080;
    return { key: "citat-herbarium", label: "", about: "", background: c.sand, layers: [
      { kind: "rect", x: W * 0.05, y: W * 0.05, w: W * 0.9, h: H - W * 0.1, fill: "rgba(0,0,0,0)", stroke: c.camel, strokeWidth: 2 * u, dash: [10 * u, 8 * u] },
      ...sprig(W * 0.14, H * 0.62, W * 0.2, H * 0.08, 8, 95 * u, c.muted, "#8a9b74", 0.9),
      { kind: "photo", x: W * 0.52, y: H * 0.07, w: W * 0.36, h: W * 0.42, angle: 4, border: { width: 16 * u, bottom: 16 * u, color: "#fffdf8" }, shadow: true },
      { kind: "rect", x: W * 0.6, y: H * 0.055, w: W * 0.18, h: 34 * u, fill: "rgba(201,151,111,0.55)", angle: -6 },
      { kind: "text", role: "quote", text: i.quote ?? w.title, x: W * 0.3, y: H * 0.46, w: W * 0.6, size: 60 * u, font: "serif", color: c.ink, italic: true, maxLines: 5, lineHeight: 1.15 },
      { kind: "line", x1: W * 0.1, y1: H * 0.755, x2: W * 0.9, y2: H * 0.755, stroke: c.camel, width: 2 * u },
      { kind: "text", role: "title", text: w.title, x: W * 0.1, y: H * 0.77, w: W * 0.6, size: 52 * u, font: "serif", color: c.ink, maxLines: 2 },
      { kind: "text", role: "sub", text: teacherLine(w), x: W * 0.1, y: H * 0.86, w: W * 0.6, size: 40 * u, font: "serif", color: c.terra, italic: true },
      { kind: "text", role: "date", text: dateLine(w), x: W * 0.1, y: H * 0.91, w: W * 0.62, size: 34 * u, font: "sans", color: c.ink, weight: 500 },
      { kind: "logo", x: W * 0.74, y: H * 0.79, size: W * 0.17, color: c.ink },
    ] };
  } },
  { key: "citat-bue", label: "Citat under buen", about: "Fotoet i en høj bue med blade ved foden, citatet under og eventet nederst.", frame: "arch", make: i => {
    const { W, H, words: w, colors: c } = i, u = W / 1080;
    return { key: "citat-bue", label: "", about: "", background: c.blush, layers: [
      { kind: "photo", x: W * 0.27, y: H * 0.05, w: W * 0.46, h: H * 0.36, frame: "arch", shadow: true },
      ...sprig(W * 0.12, H * 0.43, W * 0.34, H * 0.36, 5, 80 * u, c.terra, c.terra, 0.75),
      ...sprig(W * 0.88, H * 0.43, W * 0.66, H * 0.36, 5, 80 * u, c.terra, c.terra, 0.75),
      { kind: "text", role: "quote", text: i.quote ?? w.title, x: W * 0.1, y: H * 0.46, w: W * 0.8, size: 62 * u, font: "serif", color: c.ink, italic: true, maxLines: 5, lineHeight: 1.15, align: "center" },
      { kind: "text", role: "title", text: w.title, x: W * 0.08, y: H * 0.73, w: W * 0.6, size: 52 * u, font: "serif", color: c.ink, maxLines: 2 },
      { kind: "text", role: "sub", text: teacherLine(w), x: W * 0.08, y: H * 0.83, w: W * 0.6, size: 42 * u, font: "serif", color: c.terra, italic: true },
      { kind: "text", role: "date", text: dateLine(w), x: W * 0.08, y: H * 0.89, w: W * 0.62, size: 34 * u, font: "sans", color: c.ink, weight: 600 },
      { kind: "logo", x: W * 0.74, y: H * 0.76, size: W * 0.18, color: c.terra },
    ] };
  } },
];

/** Where a text must end: a little above the next words or logo under it in its column (none for turned words). */
export function roomBelow(layers: Layer[], layer: Extract<Layer, { kind: "text" }>): number {
  if (layer.angle) return Infinity;
  const under = layers.filter((o): o is Extract<Layer, { kind: "text" | "logo" }> => o.kind === "text" || o.kind === "logo")
    .filter(o => o !== layer && !o.angle && o.y > layer.y + 1 && o.x < layer.x + layer.w && o.x + (o.kind === "text" ? o.w : o.size) > layer.x).map(o => o.y);
  return under.length ? Math.min(...under) - layer.size * 0.12 : Infinity;
}

/** A design for the format: its own composition in a tall format, the wide cover as a picture with the words beside it. */
export function layerDesign(key: string, input: LayerInput): LayerDesign | null {
  const maker = LAYER_DESIGNS.find(m => m.key === key);
  if (!maker) return null;
  if (input.W > input.H) {
    const tall = maker.make({ ...input, W: 1080, H: 1350 });
    return landscape(input, maker.key, maker.label, maker.about, tall.background, input.colors.ink === tall.background ? input.colors.cream : pickInk(tall.background, input.colors), input.colors.terra, maker.frame);
  }
  const design = maker.make(input);
  return { ...design, label: maker.label, about: maker.about };
}

/** Dark words on a light ground, light on a dark one. */
function pickInk(background: string, c: Colors): string {
  const m = /^#([0-9a-f]{6})$/i.exec(background);
  if (!m) return c.ink;
  const n = parseInt(m[1]!, 16), lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum < 0.5 ? c.cream : c.ink;
}
