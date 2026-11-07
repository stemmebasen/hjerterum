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
      { kind: "photo", x: W * 0.1, y: H * 0.7, w: W * 0.22, h: W * 0.22, frame: "circle" },
      { kind: "text", role: "title", text: w.title, x: W * 0.36, y: H * 0.71, w: W * 0.56, size: 44 * u, font: "serif", color: c.ink, maxLines: 2 },
      { kind: "text", role: "sub", text: teacherLine(w), x: W * 0.36, y: H * 0.79, w: W * 0.56, size: 36 * u, font: "serif", color: c.terra, italic: true },
      { kind: "text", role: "date", text: dateLine(w), x: W * 0.36, y: H * 0.84, w: W * 0.56, size: 30 * u, font: "sans", color: c.ink, weight: 500 },
      { kind: "logo", x: W * 0.8, y: H * 0.03, size: W * 0.13, color: c.ink },
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
];

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
