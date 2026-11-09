import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, Circle, FabricImage, Gradient, Group, Line, Path, Point, Rect, Shadow, StaticCanvas, Textbox, filters, type FabricObject } from "fabric";
import { SIZES, type Format } from "./event-poster";
import { layerDesign, LAYER_DESIGNS, roomBelow, type Colors, type Frame, type Layer, type LayerDesign, type LayerInput } from "./layer-templates";

/** Asked (the chair, 7 Nov 2026): "Vi er nødt til at optimere den grafiske sektion ... flytte rundt på billeder, gøre dem mindre eller større og dreje dem rundt.
 * Altså et lille mini Photoshop." - "Egen editor med lag". A design is opened as layers (Fabric.js): every picture, word, shape and the logo can be moved,
 * sized and turned by its handles, changed in the panel, added or taken away; undo and redo, guides at the middle, and "Brug designet" makes it the post's
 * picture. A design from before (drawn whole) is opened as one picture to build on. */

export type EditorStart = { kind: "layers"; key: string } | { kind: "flat"; image: string };
export type EditorPicture = { url: string; label: string };
type Props = {
  format: Format; start: EditorStart; input: Omit<LayerInput, "W" | "H">; pictures: EditorPicture[]; photoUrl: string | null; logo: HTMLImageElement | null;
  onUse: (blob: Blob) => void; onClose: () => void;
  /** Requested (the chair, 10 Nov 2026): "Jeg bør kunne trække billeder ind fra Pixabay i editoren." The studio's picture finder (Pexels, Unsplash, Pixabay, art). */
  finder?: (chosen: (url: string, label: string) => void) => React.ReactNode;
};

export const EDITOR_FONTS = ["Playfair Display", "Inter", "Cormorant Garamond", "Jost", "DM Serif Display", "DM Sans", "Fraunces", "Work Sans"];
const SERIF_OF = "Playfair Display", SANS_OF = "Inter";
const PROPS = ["role", "tint", "effect", "frameKind", "frameW", "frameH", "zoomIn", "focusX", "focusY", "slot", "srcUrl"];
type Tagged = FabricObject & { role?: string; tint?: string; effect?: string; frameKind?: Frame; frameW?: number; frameH?: number; zoomIn?: number; focusX?: number; focusY?: number; slot?: number; srcUrl?: string };

// ---- Building a design ----

const images = new Map<string, Promise<HTMLImageElement | null>>();
export function loadImage(url: string): Promise<HTMLImageElement | null> {
  if (!images.has(url)) images.set(url, new Promise(resolve => { const img = new Image(); img.crossOrigin = "anonymous"; img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = url; }));
  return images.get(url)!;
}

/** The logo (the chair's own file) in one colour, as a picture to place. */
function tintedLogo(logo: HTMLImageElement, color: string): string {
  const c = document.createElement("canvas"); c.width = logo.naturalWidth; c.height = logo.naturalHeight;
  const t = c.getContext("2d")!; t.drawImage(logo, 0, 0); t.globalCompositeOperation = "source-in"; t.fillStyle = color; t.fillRect(0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

/** The picture's part that fills the frame (w × h on the page): zoomed in by `zoom`, its centre at `focus`. */
function fillFrame(img: FabricImage, el: HTMLImageElement, w: number, h: number, frame: Frame, zoom = 1, focus: [number, number] = [0.5, 0.5]) {
  const iw = el.naturalWidth, ih = el.naturalHeight;
  const scale = Math.max(w / iw, h / ih) * Math.max(1, zoom), sw = w / scale, sh = h / scale;
  img.set({ cropX: (iw - sw) * focus[0], cropY: (ih - sh) * focus[1], width: sw, height: sh, scaleX: scale, scaleY: scale });
  (img as unknown as { clipPath?: FabricObject | undefined }).clipPath = frame === "circle" ? new Circle({ radius: Math.min(sw, sh) / 2, originX: "center", originY: "center" })
    : frame === "round" || frame === "pebble" ? new Rect({ width: sw, height: sh, rx: (frame === "pebble" ? Math.min(sw, sh) * 0.22 : 28 / scale), ry: (frame === "pebble" ? Math.min(sw, sh) * 0.22 : 28 / scale), originX: "center", originY: "center" })
    : frame === "arch" ? new Path(`M ${-sw / 2} ${sh / 2} L ${-sw / 2} ${-sh / 2 + Math.min(sw / 2, sh / 2)} A ${sw / 2} ${Math.min(sw / 2, sh / 2)} 0 0 1 ${sw / 2} ${-sh / 2 + Math.min(sw / 2, sh / 2)} L ${sw / 2} ${sh / 2} Z`, { originX: "center", originY: "center" })
    : undefined;
  Object.assign(img as Tagged, { frameKind: frame, frameW: w, frameH: h, zoomIn: zoom, focusX: focus[0], focusY: focus[1] });
  img.dirty = true;
}

async function photoObject(layer: Extract<Layer, { kind: "photo" }>, url: string | null, colors: Colors): Promise<FabricObject> {
  const el = url ? await loadImage(url) : null;
  const frame = layer.frame ?? "rect";
  let picture: FabricObject;
  if (el) {
    const img = new FabricImage(el, { originX: "left", originY: "top" });
    fillFrame(img, el, layer.w, layer.h, frame, layer.zoom, layer.focus);
    if (layer.grayscale) { img.filters = [new filters.Grayscale()]; img.applyFilters(); }
    Object.assign(img as Tagged, { role: "photo", slot: layer.slot ?? 1, srcUrl: url });
    picture = img;
  } else {
    // No picture: the frame in a quiet colour, to put one in later.
    picture = frame === "circle" ? new Circle({ radius: Math.min(layer.w, layer.h) / 2, fill: colors.camel }) : new Rect({ width: layer.w, height: layer.h, fill: colors.camel, rx: frame === "rect" ? 0 : 28, ry: frame === "rect" ? 0 : 28 });
    (picture as Tagged).role = "placeholder";
  }
  const shadow = layer.shadow ? new Shadow({ color: "rgba(40,25,15,0.32)", blur: 40, offsetX: 0, offsetY: 18 }) : undefined;
  if (layer.border) {
    const b = layer.border.width, bottom = layer.border.bottom ?? b;
    const back = frame === "circle" ? new Circle({ radius: Math.min(layer.w, layer.h) / 2 + b, left: -b, top: -b, fill: layer.border.color })
      : new Rect({ left: -b, top: -b, width: layer.w + 2 * b, height: layer.h + b + bottom, fill: layer.border.color, rx: frame === "round" ? 34 : 0, ry: frame === "round" ? 34 : 0 });
    picture.set({ left: 0, top: 0 });
    const group = new Group([back, picture], { ...(shadow ? { shadow } : {}), opacity: layer.opacity ?? 1 });
    (group as Tagged).role = "photo-frame";
    group.set({ left: layer.x - b, top: layer.y - b });
    if (layer.angle) group.rotate(layer.angle);
    return group;
  }
  picture.set({ left: layer.x, top: layer.y, ...(shadow ? { shadow } : {}), opacity: layer.opacity ?? 1 });
  if (layer.angle) picture.rotate(layer.angle);
  return picture;
}

function textObject(layer: Extract<Layer, { kind: "text" }>, bottom = Infinity): Textbox {
  const t = new Textbox(layer.text, {
    left: layer.x, top: layer.y, width: layer.w, fontSize: layer.size, fontFamily: layer.font === "serif" ? SERIF_OF : SANS_OF, fill: layer.color,
    fontWeight: layer.weight ?? (layer.font === "serif" ? 400 : 500), fontStyle: layer.italic ? "italic" : "normal", textAlign: layer.align ?? "left",
    lineHeight: layer.lineHeight ?? 1.16, charSpacing: layer.spacing ?? 0, opacity: layer.opacity ?? 1,
  });
  // The words in at most their lines, and no word wider than the box.
  const lines = layer.maxLines ?? 99;
  // Reported (the chair, 8 Nov 2026): "Der er så mange layout fejl" - a long title ran into the teacher's name and the date below it: the words end above
  // the next layer under them (`bottom`).
  for (let i = 0; i < 40 && (t.textLines.length > lines || (t.width ?? 0) > layer.w + 1 || layer.y + (t.height ?? 0) > bottom); i++) { t.set({ fontSize: (t.fontSize ?? 40) * 0.94, width: layer.w }); t.initDimensions(); }
  (t as Tagged).role = layer.role ?? "text";
  if (layer.angle) t.rotate(layer.angle);
  return t;
}

/** Requested (the chair, 9 Nov 2026): "muligheden for at lægge en effekt, for eksempel slør eller andre typer effekter, over et billede, så man kan leve med, at
 * kvaliteten ikke er så høj." A few looks that hide a soft or grainy photo, in the house's colours. */
export const PHOTO_EFFECTS: Array<{ key: string; label: string; make: (c: Colors) => InstanceType<typeof filters.BaseFilter>[] }> = [
  { key: "", label: "Ingen", make: () => [] },
  { key: "slor", label: "Slør", make: () => [new filters.Blur({ blur: 0.2 })] },
  { key: "drom", label: "Drømmende", make: c => [new filters.Blur({ blur: 0.05 }), new filters.Brightness({ brightness: 0.06 }), new filters.Saturation({ saturation: -0.2 }), new filters.BlendColor({ color: c.cream, mode: "screen", alpha: 0.18 })] },
  { key: "korn", label: "Korn", make: () => [new filters.Contrast({ contrast: 0.06 }), new filters.Noise({ noise: 70 })] },
  { key: "blod", label: "Blødt lys", make: () => [new filters.Contrast({ contrast: -0.15 }), new filters.Brightness({ brightness: 0.08 }), new filters.Saturation({ saturation: -0.15 })] },
  { key: "varm", label: "Varm", make: c => [new filters.Saturation({ saturation: -0.1 }), new filters.BlendColor({ color: c.camel, mode: "tint", alpha: 0.22 }), new filters.Brightness({ brightness: 0.03 })] },
  { key: "hus", label: "Husets farver", make: c => [new filters.Grayscale(), new filters.BlendColor({ color: c.camel, mode: "tint", alpha: 0.45 })] },
  { key: "sh", label: "Sort/hvid", make: () => [new filters.Grayscale()] },
];

async function logoObject(logo: HTMLImageElement | null, layer: Extract<Layer, { kind: "logo" }>): Promise<FabricObject | null> {
  if (!logo) return null;
  const el = await loadImage(tintedLogo(logo, layer.color));
  if (!el) return null;
  const img = new FabricImage(el, { left: layer.x, top: layer.y });
  img.scaleToWidth(layer.size);
  Object.assign(img as Tagged, { role: "logo", tint: layer.color });
  if (layer.angle) img.rotate(layer.angle);
  return img;
}

function shapeObject(layer: Layer): FabricObject | null {
  if (layer.kind === "rect") {
    const r = new Rect({ left: layer.x, top: layer.y, width: layer.w, height: layer.h, fill: layer.fill, rx: layer.radius ?? 0, ry: layer.radius ?? 0, opacity: layer.opacity ?? 1,
      ...(layer.stroke ? { stroke: layer.stroke } : {}), strokeWidth: layer.strokeWidth ?? 0, ...(layer.dash ? { strokeDashArray: layer.dash } : {}) });
    if (layer.gradient) r.set("fill", new Gradient({ type: "linear", gradientUnits: "pixels", coords: { x1: 0, y1: 0, x2: 0, y2: layer.h }, colorStops: layer.gradient.map(([offset, color]) => ({ offset, color })) }));
    if (layer.angle) r.rotate(layer.angle);
    (r as Tagged).role = "shape";
    return r;
  }
  if (layer.kind === "circle") { const c = new Circle({ left: layer.x - layer.r, top: layer.y - layer.r, radius: layer.r, fill: layer.fill, opacity: layer.opacity ?? 1, ...(layer.stroke ? { stroke: layer.stroke } : {}), strokeWidth: layer.strokeWidth ?? 0 }); (c as Tagged).role = "shape"; return c; }
  if (layer.kind === "line") { const l = new Line([layer.x1, layer.y1, layer.x2, layer.y2], { stroke: layer.stroke, strokeWidth: layer.width, ...(layer.dash ? { strokeDashArray: layer.dash } : {}) }); (l as Tagged).role = "shape"; return l; }
  if (layer.kind === "path") { const p = new Path(layer.d, { left: layer.x, top: layer.y, fill: layer.fill, opacity: layer.opacity ?? 1 }); p.scaleToWidth(layer.w); if (layer.angle) p.rotate(layer.angle); (p as Tagged).role = "shape"; return p; }
  return null;
}

/** The layers of a design on a canvas (the editor's, or a still one for the gallery). */
export async function buildDesign(canvas: Canvas | StaticCanvas, design: LayerDesign, photos: Array<string | null>, logo: HTMLImageElement | null, colors: Colors) {
  canvas.clear();
  canvas.backgroundColor = design.background;
  await Promise.all(EDITOR_FONTS.slice(0, 2).map(f => document.fonts.load(`40px "${f}"`).catch(() => [])));
  for (const layer of design.layers) {
    const obj = layer.kind === "photo" ? await photoObject(layer, photos[(layer.slot ?? 1) - 1] ?? photos[0] ?? null, colors)
      : layer.kind === "text" ? textObject(layer, roomBelow(design.layers, layer)) : layer.kind === "logo" ? await logoObject(logo, layer) : shapeObject(layer);
    if (obj) canvas.add(obj);
  }
  canvas.renderAll();
}

/** A small picture of a design, for the gallery. */
export async function designThumb(design: LayerDesign, size: { width: number; height: number }, photos: Array<string | null>, logo: HTMLImageElement | null, colors: Colors): Promise<string> {
  const el = document.createElement("canvas");
  const c = new StaticCanvas(el, { width: size.width, height: size.height, renderOnAddRemove: false });
  await buildDesign(c, design, photos, logo, colors);
  const url = c.toDataURL({ format: "jpeg", quality: 0.82, multiplier: 360 / size.width });
  void c.dispose();
  return url;
}

// ---- The editor ----

const ROLE_LABEL: Record<string, string> = { photo: "Billede", "photo-frame": "Billede med ramme", placeholder: "Billedfelt", logo: "Logo", title: "Overskrift", sub: "Undertekst", date: "Dato", kicker: "Lille overskrift",
  small: "Lille tekst", quote: "Citat", text: "Tekst", shape: "Form", flat: "Designet" };

export function DesignEditor({ format, start, input, pictures, photoUrl, logo, onUse, onClose, finder }: Props) {
  const { width: W, height: H } = SIZES[format];
  const host = useRef<HTMLDivElement>(null), el = useRef<HTMLCanvasElement>(null), fc = useRef<Canvas | null>(null);
  const [zoom, setZoom] = useState(0.5);
  const [selected, setSelected] = useState<Tagged | null>(null);
  const [, setTick] = useState(0);
  const refresh = () => setTick(t => t + 1);
  const history = useRef<{ stack: string[]; at: number; restoring: boolean }>({ stack: [], at: -1, restoring: false });
  const [busy, setBusy] = useState("Bygger designet …");
  const [useError, setUseError] = useState("");
  const swatches = useMemo(() => [...new Set([input.colors.cream, input.colors.sand, input.colors.blush, input.colors.sage, input.colors.camel, input.colors.terra, input.colors.muted, input.colors.ink, input.colors.dusk, "#ffffff", "#000000"])], [input.colors]);

  const snapshot = () => {
    const h = history.current, c = fc.current;
    if (!c || h.restoring) return;
    const json = JSON.stringify(c.toObject(PROPS));
    if (h.stack[h.at] === json) return;
    h.stack = [...h.stack.slice(0, h.at + 1), json].slice(-40); h.at = h.stack.length - 1; refresh();
  };
  const restore = async (to: number) => {
    const h = history.current, c = fc.current;
    if (!c || to < 0 || to >= h.stack.length) return;
    h.restoring = true; h.at = to;
    await c.loadFromJSON(JSON.parse(h.stack[to]!));
    c.renderAll(); h.restoring = false; setSelected(null); refresh();
  };

  // The canvas, once.
  useEffect(() => {
    // Reported (the chair, 10 Nov 2026): "Når jeg markerer elementer i editoren, kan jeg ikke se det, mens jeg gør det" - the marking box in the house's
    // orange, and what is chosen plainly framed.
    const c = new Canvas(el.current!, { width: W, height: H, preserveObjectStacking: true, backgroundColor: "#ffffff",
      selectionColor: "rgba(228,87,46,0.12)", selectionBorderColor: "#e4572e", selectionLineWidth: 2, selectionDashArray: [6, 4] });
    c.on("object:added", e => e.target.set({ borderColor: "#e4572e", cornerColor: "#e4572e", cornerStrokeColor: "#ffffff", transparentCorners: false, borderScaleFactor: 2, cornerSize: 14 }));
    fc.current = c;
    const pick = () => { setSelected((c.getActiveObject() as Tagged) ?? null); refresh(); };
    c.on("selection:created", pick); c.on("selection:updated", pick); c.on("selection:cleared", () => setSelected(null));
    c.on("object:modified", () => { snapshot(); refresh(); });
    // Guides: the middle of the page, across and down, when something comes near it.
    let guides: Array<"v" | "h"> = [], drewGuides = false;
    c.on("object:moving", e => {
      const t = e.target, center = t.getCenterPoint(), near = 12 / (c.getZoom() || 1);
      guides = [];
      let x = center.x, y = center.y;
      if (Math.abs(center.x - W / 2) < near) { x = W / 2; guides.push("v"); }
      if (Math.abs(center.y - H / 2) < near) { y = H / 2; guides.push("h"); }
      if (guides.length) t.setPositionByOrigin(new Point(x, y), "center", "center");
    });
    c.on("after:render", () => {
      const ctx = c.contextTop; if (!ctx) return;
      // Only the guides' own drawing is wiped - the top layer also holds the marking box while one is drawn.
      if (!guides.length && !drewGuides) return;
      c.clearContext(ctx); drewGuides = guides.length > 0;
      if (!guides.length) return;
      const z = c.getZoom();
      ctx.save(); ctx.strokeStyle = "#e4572e"; ctx.lineWidth = 1; ctx.setLineDash([6, 4]);
      if (guides.includes("v")) { ctx.beginPath(); ctx.moveTo(W / 2 * z, 0); ctx.lineTo(W / 2 * z, H * z); ctx.stroke(); }
      if (guides.includes("h")) { ctx.beginPath(); ctx.moveTo(0, H / 2 * z); ctx.lineTo(W * z, H / 2 * z); ctx.stroke(); }
      ctx.restore();
    });
    c.on("mouse:up", () => { guides = []; c.requestRenderAll(); });
    return () => { void c.dispose(); fc.current = null; };
  }, [W, H]);

  // Fit to the space there is.
  useEffect(() => {
    const fit = () => {
      const box = host.current, c = fc.current; if (!box || !c) return;
      const z = Math.min((box.clientWidth - 48) / W, (box.clientHeight - 48) / H, 1);
      c.setDimensions({ width: W * z, height: H * z }); c.setZoom(z); setZoom(z); c.requestRenderAll();
    };
    fit();
    const ro = new ResizeObserver(fit); if (host.current) ro.observe(host.current);
    return () => ro.disconnect();
  }, [W, H]);

  // The design itself.
  useEffect(() => {
    const c = fc.current; if (!c) return;
    let live = true;
    void (async () => {
      setBusy("Bygger designet …");
      if (start.kind === "layers") {
        const design = layerDesign(start.key, { ...input, W, H });
        if (design) await buildDesign(c, design, [photoUrl, photoUrl, photoUrl], logo, input.colors);
      } else {
        c.clear(); c.backgroundColor = "#ffffff";
        const img = await loadImage(start.image);
        if (img) { const flat = new FabricImage(img, { left: 0, top: 0 }); flat.scaleToWidth(W); (flat as Tagged).role = "flat"; c.add(flat); }
        c.renderAll();
      }
      if (!live) return;
      history.current = { stack: [], at: -1, restoring: false }; snapshot(); setBusy("");
    })();
    return () => { live = false; };
  }, [start, W, H, photoUrl, logo]);

  // Keys: delete, undo, redo, duplicate, nudge.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const c = fc.current, o = c?.getActiveObject() as (Tagged & { isEditing?: boolean }) | undefined;
      if (!c || (e.target as HTMLElement)?.closest?.("input, textarea, select") || o?.isEditing) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); void restore(history.current.at + (e.shiftKey ? 1 : -1)); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); void restore(history.current.at + 1); return; }
      if (!o) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(); return; }
      if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); void duplicate(); return; }
      const step = e.shiftKey ? 10 : 2, move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (move[e.key]) { e.preventDefault(); o.set({ left: (o.left ?? 0) + move[e.key]![0], top: (o.top ?? 0) + move[e.key]![1] }); o.setCoords(); c.requestRenderAll(); snapshot(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const changed = () => { fc.current?.requestRenderAll(); snapshot(); refresh(); };
  const set = (props: Record<string, unknown>) => { if (!selected) return; selected.set(props); selected.setCoords(); changed(); };
  const add = (obj: FabricObject) => { const c = fc.current; if (!c) return; c.add(obj); c.setActiveObject(obj); setSelected(obj as Tagged); changed(); };
  // "kan jeg ikke altid slette elementer": with more than one marked, each of them is taken away (not the marking itself).
  const remove = () => { const c = fc.current; if (!c) return; const all = c.getActiveObjects(); if (!all.length) return; c.discardActiveObject(); c.remove(...all); setSelected(null); changed(); };
  const duplicate = async () => { const c = fc.current, o = c?.getActiveObject() as Tagged | undefined; if (!c || !o) return;
    const copy = await o.clone(PROPS) as Tagged; copy.set({ left: (o.left ?? 0) + 30, top: (o.top ?? 0) + 30 }); add(copy); };
  const layer = (how: "up" | "down" | "top" | "bottom") => { const c = fc.current, o = c?.getActiveObject(); if (!c || !o) return;
    if (how === "up") c.bringObjectForward(o); else if (how === "down") c.sendObjectBackwards(o); else if (how === "top") c.bringObjectToFront(o); else c.sendObjectToBack(o); changed(); };

  // The picture of a selected photo (alone, or in its frame).
  const photoOf = (o: Tagged | null): (FabricImage & Tagged) | null => !o ? null : o.role === "photo" ? o as FabricImage & Tagged
    : o.role === "photo-frame" ? ((o as unknown as Group).getObjects().find(x => (x as Tagged).role === "photo") as (FabricImage & Tagged) | undefined) ?? null : null;
  const refill = async (img: FabricImage & Tagged, change: { url?: string; zoom?: number; focus?: [number, number]; frame?: Frame }) => {
    const url = change.url ?? img.srcUrl; const el = url ? await loadImage(url) : null; if (!el) return;
    if (change.url) { img.setElement(el); img.srcUrl = change.url; }
    fillFrame(img, el, img.frameW ?? img.getScaledWidth(), img.frameH ?? img.getScaledHeight(), change.frame ?? img.frameKind ?? "rect", change.zoom ?? img.zoomIn ?? 1, change.focus ?? [img.focusX ?? 0.5, img.focusY ?? 0.5]);
    if (img.filters?.length) img.applyFilters();
    img.group?.triggerLayout?.(); changed();
  };
  /** Size a photo: its frame grows or shrinks, the picture filling it as before. */
  const addText = (kind: "title" | "sub" | "small") => {
    const size = kind === "title" ? 90 : kind === "sub" ? 48 : 32;
    const t = new Textbox(kind === "title" ? "Overskrift" : kind === "sub" ? "Undertekst" : "Tekst", { left: W * 0.1, top: H * 0.4, width: W * 0.8, fontSize: size, fontFamily: kind === "small" ? SANS_OF : SERIF_OF,
      fill: input.colors.ink, fontStyle: kind === "sub" ? "italic" : "normal", textAlign: "center" });
    (t as Tagged).role = kind; add(t);
  };
  const addPicture = async (url: string, at?: { x: number; y: number }) => {
    const size = W * 0.5;
    const obj = await photoObject({ kind: "photo", x: at ? Math.max(0, Math.min(W - size, at.x - size / 2)) : W * 0.25, y: at ? Math.max(0, Math.min(H - size, at.y - size / 2)) : H * 0.25, w: size, h: size, frame: "round" }, url, input.colors); add(obj);
  };
  // Pictures found while the editor is open, first; and dropped on the page where they are let go.
  const [found, setFound] = useState<EditorPicture[]>([]);
  const pics = [...found, ...pictures.filter(p => !found.some(f => f.url === p.url))];
  const drop = (e: React.DragEvent) => {
    const url = e.dataTransfer.getData("text/x-hjerterum-picture"), c = fc.current; if (!url || !c) return;
    e.preventDefault();
    const box = (e.currentTarget as HTMLElement).querySelector("canvas")!.getBoundingClientRect(), z = c.getZoom() || 1;
    void addPicture(url, { x: (e.clientX - box.left) / z, y: (e.clientY - box.top) / z });
  };
  const addShape = (kind: "rect" | "circle" | "line" | "arch") => {
    const fill = input.colors.camel;
    const obj = kind === "rect" ? new Rect({ left: W * 0.3, top: H * 0.3, width: W * 0.4, height: W * 0.25, fill, rx: 0, ry: 0 })
      : kind === "circle" ? new Circle({ left: W * 0.35, top: H * 0.35, radius: W * 0.15, fill })
      : kind === "line" ? new Line([W * 0.3, H * 0.5, W * 0.7, H * 0.5], { stroke: input.colors.ink, strokeWidth: 4 })
      : new Path(`M 0 400 L 0 150 A 150 150 0 0 1 300 150 L 300 400 Z`, { left: W * 0.35, top: H * 0.3, fill });
    (obj as Tagged).role = "shape"; add(obj);
  };
  const addLogo = async () => { const obj = await logoObject(logo, { kind: "logo", x: W * 0.4, y: H * 0.4, size: W * 0.2, color: input.colors.ink }); if (obj) add(obj); };
  const tintLogo = async (color: string) => { const o = selected as (FabricImage & Tagged) | null; if (!o || o.role !== "logo" || !logo) return;
    const el = await loadImage(tintedLogo(logo, color)); if (!el) return; o.setElement(el); o.tint = color; changed(); };

  // Reported (the chair, 8 Nov 2026): "Når jeg klikker Brug designet, sker der ingenting" - the picture was read back with fetch() from a data: address, which
  // the admin's own rules (connect-src 'self') do not allow. Made straight from the canvas instead, and told when it cannot be.
  const use = () => {
    const c = fc.current; if (!c) return;
    c.discardActiveObject(); c.renderAll();
    setUseError("");
    try {
      c.toCanvasElement(1 / (c.getZoom() || 1)).toBlob(blob => blob ? onUse(blob) : setUseError("Designet kunne ikke gemmes. Prøv igen, eller brug Download."), "image/jpeg", 0.92);
    } catch {
      setUseError("Et af billederne må ikke gemmes herfra (det ligger på en anden side). Skift billedet, eller brug Download.");
    }
  };
  const download = async () => {
    const c = fc.current; if (!c) return;
    c.discardActiveObject(); c.renderAll();
    const a = document.createElement("a"); a.href = c.toDataURL({ format: "jpeg", quality: 0.92, multiplier: 1 / (c.getZoom() || 1) }); a.download = "hjerterum-design.jpg"; a.click();
  };

  const o = selected;
  const isText = Boolean(o && "text" in o && typeof (o as unknown as Textbox).text === "string");
  const photo = photoOf(o);
  const fill = o && typeof o.fill === "string" ? o.fill : null;
  const Swatches = ({ value, onPick }: { value: string | null; onPick: (c: string) => void }) => <div className="ed-swatches">
    {swatches.map(s => <button key={s} type="button" title={s} className={value === s ? "is-on" : ""} style={{ background: s }} onClick={() => onPick(s)} />)}
    <input type="color" aria-label="Egen farve" value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"} onChange={e => onPick(e.target.value)} /></div>;
  const h = history.current;

  return <div className="ed" role="dialog" aria-label="Editor">
    <header className="ed-bar">
      <b>Editor</b>
      <button type="button" className="lys-btn ghost" disabled={h.at <= 0} onClick={() => void restore(h.at - 1)} title="Fortryd (Ctrl+Z)">↶ Fortryd</button>
      <button type="button" className="lys-btn ghost" disabled={h.at >= h.stack.length - 1} onClick={() => void restore(h.at + 1)} title="Gentag (Ctrl+Shift+Z)">↷ Gentag</button>
      <span className="ed-space" />
      <button type="button" className="lys-btn ghost" onClick={() => void download()}>Download</button>
      <button type="button" className="lys-btn" disabled={Boolean(busy)} onClick={use}>Brug designet →</button>
      {useError && <span className="ed-error" role="alert">{useError}</span>}
      <button type="button" className="lys-btn ghost" onClick={onClose} aria-label="Luk editoren">Luk</button>
    </header>
    <aside className="ed-add">
      <h3>Tilføj</h3>
      <p className="ed-row"><button type="button" onClick={() => addText("title")}>Overskrift</button><button type="button" onClick={() => addText("sub")}>Undertekst</button><button type="button" onClick={() => addText("small")}>Lille tekst</button></p>
      <p className="ed-row"><button type="button" onClick={() => addShape("rect")}>▭ Firkant</button><button type="button" onClick={() => addShape("circle")}>◯ Cirkel</button><button type="button" onClick={() => addShape("arch")}>⌂ Bue</button><button type="button" onClick={() => addShape("line")}>― Streg</button></p>
      {logo && <p className="ed-row"><button type="button" onClick={() => void addLogo()}>Logo</button></p>}
      <h3>Billeder</h3>
      <div className="ed-pics">{pics.map(p => <button key={p.url} type="button" title={`Læg ind: ${p.label} (eller træk det ind)`} draggable
        onDragStart={e => { e.dataTransfer.setData("text/x-hjerterum-picture", p.url); e.dataTransfer.effectAllowed = "copy"; }} onClick={() => void addPicture(p.url)}><img src={p.url} alt={p.label} loading="lazy" /></button>)}</div>
      {!pics.length && <p className="studio-muted">Ingen billeder endnu. Find et herunder.</p>}
      {finder && <details className="ed-finder"><summary>Find billeder (Pixabay, Pexels, Unsplash, kunst)</summary>
        {finder((url, label) => { setFound(f => [{ url, label }, ...f.filter(x => x.url !== url)]); void addPicture(url); })}</details>}
      <h3>Baggrund</h3>
      <Swatches value={typeof fc.current?.backgroundColor === "string" ? fc.current.backgroundColor : null} onPick={color => { const c = fc.current; if (!c) return; c.backgroundColor = color; changed(); }} />
    </aside>
    <div className="ed-stage" ref={host} onDragOver={e => { if (e.dataTransfer.types.includes("text/x-hjerterum-picture")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }} onDrop={drop}>
      <canvas ref={el} />
      {busy && <p className="ed-busy">{busy}</p>}
    </div>
    <aside className="ed-props">
      {!o ? <p className="studio-muted">Klik på noget i designet for at ændre det. Træk i hjørnerne for at gøre det større eller mindre, og i den runde knap for at dreje det. Dobbeltklik på en tekst for at skrive i den.</p> : <>
        <h3>{ROLE_LABEL[o.role ?? ""] ?? (isText ? "Tekst" : "Valgt")}</h3>
        {isText && <>
          <label className="ed-field"><span>Tekst</span><textarea rows={3} value={(o as unknown as Textbox).text} onChange={e => set({ text: e.target.value })} /></label>
          <label className="ed-field"><span>Skrift</span><select value={String((o as unknown as Textbox).fontFamily ?? "").replace(/"/g, "")} onChange={e => set({ fontFamily: e.target.value })}>
            {EDITOR_FONTS.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}</select></label>
          <label className="ed-field"><span>Størrelse {Math.round((o as unknown as Textbox).fontSize ?? 0)}</span><input type="range" min={14} max={320} value={(o as unknown as Textbox).fontSize ?? 40} onChange={e => set({ fontSize: Number(e.target.value) })} /></label>
          <p className="ed-row">
            <button type="button" className={(o as unknown as Textbox).fontWeight === 700 || (o as unknown as Textbox).fontWeight === "bold" ? "is-on" : ""} onClick={() => set({ fontWeight: (o as unknown as Textbox).fontWeight === 700 ? 400 : 700 })}><b>F</b></button>
            <button type="button" className={(o as unknown as Textbox).fontStyle === "italic" ? "is-on" : ""} onClick={() => set({ fontStyle: (o as unknown as Textbox).fontStyle === "italic" ? "normal" : "italic" })}><i>K</i></button>
            {(["left", "center", "right"] as const).map(a => <button key={a} type="button" className={(o as unknown as Textbox).textAlign === a ? "is-on" : ""} onClick={() => set({ textAlign: a })}>{a === "left" ? "⇤" : a === "center" ? "⇔" : "⇥"}</button>)}
          </p>
          <label className="ed-field"><span>Afstand mellem bogstaver</span><input type="range" min={-50} max={800} value={(o as unknown as Textbox).charSpacing ?? 0} onChange={e => set({ charSpacing: Number(e.target.value) })} /></label>
          <label className="ed-field"><span>Linjeafstand</span><input type="range" min={0.8} max={2} step={0.02} value={(o as unknown as Textbox).lineHeight ?? 1.16} onChange={e => set({ lineHeight: Number(e.target.value) })} /></label>
          <div className="ed-field"><span>Farve</span><Swatches value={fill} onPick={color => set({ fill: color })} /></div>
        </>}
        {photo && <>
          <div className="ed-field"><span>Skift billede</span><div className="ed-pics">{pics.map(p => <button key={p.url} type="button" onClick={() => void refill(photo, { url: p.url })}><img src={p.url} alt={p.label} loading="lazy" /></button>)}</div></div>
          <label className="ed-field"><span>Zoom i billedet</span><input type="range" min={1} max={3} step={0.02} value={photo.zoomIn ?? 1} onChange={e => void refill(photo, { zoom: Number(e.target.value) })} /></label>
          <label className="ed-field"><span>Udsnit vandret</span><input type="range" min={0} max={1} step={0.01} value={photo.focusX ?? 0.5} onChange={e => void refill(photo, { focus: [Number(e.target.value), photo.focusY ?? 0.5] })} /></label>
          <label className="ed-field"><span>Udsnit lodret</span><input type="range" min={0} max={1} step={0.01} value={photo.focusY ?? 0.5} onChange={e => void refill(photo, { focus: [photo.focusX ?? 0.5, Number(e.target.value)] })} /></label>
          <div className="ed-field"><span>Form</span><p className="ed-row">{([["rect", "Firkant"], ["round", "Afrundet"], ["circle", "Cirkel"], ["arch", "Bue"], ["pebble", "Blød"]] as const).map(([f, label]) =>
            <button key={f} type="button" className={photo.frameKind === f ? "is-on" : ""} onClick={() => void refill(photo, { frame: f })}>{label}</button>)}</p></div>
          <div className="ed-field"><span>Effekt</span><p className="ed-row">{PHOTO_EFFECTS.map(fx =>
            <button key={fx.key} type="button" className={(photo.effect ?? (photo.filters?.length ? "sh" : "")) === fx.key ? "is-on" : ""}
              onClick={() => { photo.filters = fx.make(input.colors); photo.effect = fx.key; photo.applyFilters(); changed(); }}>{fx.label}</button>)}</p></div>
          <p className="ed-row">
            <button type="button" className={o.shadow ? "is-on" : ""} onClick={() => set({ shadow: o.shadow ? null : new Shadow({ color: "rgba(40,25,15,0.32)", blur: 40, offsetY: 18 }) })}>Skygge</button>
          </p>
        </>}
        {o.role === "logo" && <div className="ed-field"><span>Logoets farve</span><Swatches value={o.tint ?? null} onPick={color => void tintLogo(color)} /></div>}
        {!isText && !photo && o.role !== "logo" && o.role !== "flat" && <div className="ed-field"><span>Farve</span><Swatches value={o.type === "line" ? (o.stroke as string) : fill} onPick={color => set(o.type === "line" ? { stroke: color } : { fill: color })} /></div>}
        <label className="ed-field"><span>Drej {Math.round(o.angle ?? 0)}°</span><input type="range" min={-180} max={180} value={Math.round(((o.angle ?? 0) + 540) % 360 - 180)} onChange={e => { o.rotate(Number(e.target.value)); o.setCoords(); changed(); }} /></label>
        <label className="ed-field"><span>Gennemsigtighed</span><input type="range" min={0.05} max={1} step={0.05} value={o.opacity ?? 1} onChange={e => set({ opacity: Number(e.target.value) })} /></label>
        <div className="ed-field"><span>Lag</span><p className="ed-row"><button type="button" onClick={() => layer("top")}>Forrest</button><button type="button" onClick={() => layer("up")}>Frem</button><button type="button" onClick={() => layer("down")}>Tilbage</button><button type="button" onClick={() => layer("bottom")}>Bagerst</button></p></div>
        <p className="ed-row"><button type="button" onClick={() => set({ flipX: !o.flipX })}>Spejlvend</button><button type="button" onClick={() => void duplicate()}>Duplikér</button><button type="button" className="ed-danger" onClick={remove}>Slet</button></p>
      </>}
      <p className="studio-muted ed-zoom">Visning {Math.round(zoom * 100)} % · Piletaster flytter · Ctrl+Z fortryder</p>
    </aside>
  </div>;
}

/** The new designs, for the gallery (format's own size). */
export const LAYER_DESIGN_LIST = LAYER_DESIGNS.map(m => ({ key: m.key, label: m.label, about: m.about }));

/** The new designs as small pictures, each opening in the editor. */
export function LayerGallery({ format, input, photoUrl, logo, onOpen, quotes }: { format: Format; input: Omit<LayerInput, "W" | "H">; photoUrl: string | null; logo: HTMLImageElement | null; onOpen: (key: string) => void;
  quotes?: { count: number; at: number; next: () => void } }) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const size = SIZES[format];
  useEffect(() => {
    let live = true;
    setThumbs({});
    void (async () => {
      for (const m of LAYER_DESIGNS) {
        const design = layerDesign(m.key, { ...input, W: size.width, H: size.height });
        if (!design) continue;
        const url = await designThumb(design, size, [photoUrl, photoUrl, photoUrl], logo, input.colors).catch(() => "");
        if (!live) return;
        if (url) setThumbs(t => ({ ...t, [m.key]: url }));
      }
    })();
    return () => { live = false; };
  }, [format, photoUrl, logo, JSON.stringify(input)]);
  return <div className="poster-grid ed-gallery">{LAYER_DESIGNS.map(m => <figure key={m.key} className="poster-card">
    <button type="button" className="ed-thumb" onClick={() => onOpen(m.key)} aria-label={`Åbn ${m.label} i editoren`}>
      {thumbs[m.key] ? <img src={thumbs[m.key]} alt="" style={{ aspectRatio: `${size.width} / ${size.height}` }} /> : <span className="ed-thumb-wait" style={{ aspectRatio: `${size.width} / ${size.height}` }}>Tegner …</span>}</button>
    <figcaption><div><b>{m.label}</b><p>{m.about}</p></div><p className="studio-actions"><button type="button" className="lys-btn" onClick={() => onOpen(m.key)}>Åbn i editoren</button>
      {m.key.startsWith("citat") && quotes && (quotes.count > 1
        ? <button type="button" className="lys-btn ghost" onClick={quotes.next}>✨ Nyt citat ({quotes.at + 1}/{quotes.count})</button>
        : <span className="studio-muted">{quotes.count ? "Der er kun ét citat - underviserens egne ord kan lægges ind i PR-materialet." : "Ingen citater endnu - underviserens egne ord kan lægges ind i PR-materialet."}</span>)}</p></figcaption>
  </figure>)}</div>;
}
