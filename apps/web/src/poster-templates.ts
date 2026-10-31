import { ADDRESS, blob, byline, C, cover, fit, logo, pebbleRect, SANS, SERIF, spaced, text, titleLines, type Assets, type Ctx, type PosterWords } from "./event-poster";

/** Requested: "Lav gerne flere skabeloner" - "Nej, 8 der vises. Og så kan man få 8 nye." - and "hvad med det aflange facebook cover
 * format?". Sixteen poster designs, each drawn for any shape: post (4:5), story (9:16) and Facebook's event cover (1.91:1). A design
 * says where its photo sits (photo) and draws itself (draw); the photo box is also what the photo-size check measures (photoFits).
 * The first five keep their hand-made post and story layouts (event-poster.ts); here they get their cover layout. Six of the new ones
 * follow Gitta's own looks (her skills: the date block and the soft circle of the "omtale", the dark box of the campaigns, the
 * evening fade of the "billedopslag", the caramel stripe); the rest are new. */

export type Shape = "rect" | "pebble" | "arch" | "circle" | "blob" | "wave-bottom" | "wave-right";
export type PhotoSpot = { x: number; y: number; w: number; h: number; shape: Shape; radius?: number; optional?: boolean };
export type Template = { photo: (W: number, H: number) => PhotoSpot | null; draw: (ctx: Ctx, W: number, H: number, w: PosterWords, a: Assets) => void };

const G = { cream: "#F4F1EB", caramel: "#CD9D76", cocoa: "#2E2621", grey: "#393939", creamB: "#F7F4EE", brownB: "#4A3B33", brownB2: "#5A4C44", accentB: "#8A7C70",
  sageLine: "#C9D2C2", night: "#2a221d", box: "rgba(87,67,56,.78)", leaf: "#3b4634", leafSoft: "#dfe7d6", gold: "#d9b67a" };

const land = (W: number, H: number) => W / H > 1.2;
const unit = (W: number, H: number) => Math.min(W, H) / 1080;

/** The photo clipped to its shape, like CSS object-fit: cover; without a photo the shape is a quiet sand field. */
function photoIn(ctx: Ctx, img: HTMLImageElement | null, s: PhotoSpot, filter = "") {
  ctx.save();
  shapePath(ctx, s);
  ctx.clip();
  if (img) { if (filter) ctx.filter = filter; cover(ctx, img, s.x, s.y, s.w, s.h, 0.5, 0.42); ctx.filter = "none"; }
  else { ctx.fillStyle = C.sand; ctx.fillRect(s.x, s.y, s.w, s.h); }
  ctx.restore();
}

function shapePath(ctx: Ctx, s: PhotoSpot) {
  const { x, y, w, h } = s;
  ctx.beginPath();
  if (s.shape === "rect") { ctx.roundRect(x, y, w, h, s.radius ?? 0); return; }
  if (s.shape === "circle") { ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); return; }
  if (s.shape === "arch") { const r = w / 2; ctx.moveTo(x, y + h); ctx.lineTo(x, y + r); ctx.arc(x + r, y + r, r, Math.PI, 0); ctx.lineTo(x + w, y + h); ctx.closePath(); return; }
  if (s.shape === "pebble") { pebbleRect(ctx, x, y, w, h, { tl: [w * 0.3, h * 0.26], tr: [w * 0.07, h * 0.07], br: [w * 0.22, h * 0.3], bl: [w * 0.12, h * 0.1] }); return; }
  if (s.shape === "wave-bottom") { ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h - h * 0.08); ctx.bezierCurveTo(x + w * 0.7, y + h + h * 0.06, x + w * 0.35, y + h - h * 0.16, x, y + h - h * 0.02); ctx.closePath(); return; }
  if (s.shape === "wave-right") { ctx.moveTo(x, y); ctx.lineTo(x + w - w * 0.06, y); ctx.bezierCurveTo(x + w + w * 0.05, y + h * 0.3, x + w - w * 0.12, y + h * 0.65, x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); return; }
  // blob: a soft round shape
  const cx = x + w / 2, cy = y + h / 2, wob = [1, 1.04, 0.97, 1.03, 0.98, 1.05, 0.96, 1.02];
  const pts = wob.map((k, i) => { const t = (i / wob.length) * Math.PI * 2; return [cx + Math.cos(t) * (w / 2) * k, cy + Math.sin(t) * (h / 2) * k] as const; });
  const mid = (i: number) => { const p = pts[i % pts.length]!, q = pts[(i + 1) % pts.length]!; return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as const; };
  const m0 = mid(pts.length - 1); ctx.moveTo(m0[0], m0[1]);
  pts.forEach((p, i) => { const m = mid(i); ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]); });
  ctx.closePath();
}

type BlockStyle = { color: string; accent: string; muted: string; kicker?: string | null; align?: "left" | "center"; size: number; maxLines: number;
  italicAll?: boolean; meta?: boolean; footer?: string | null; mono?: boolean };

/** Kicker, title (in two voices), byline and the day and time, fitted to a box and placed at its top, centre or bottom. */
function block(ctx: Ctx, r: { x: number; y: number; w: number; h: number }, w: PosterWords, st: BlockStyle, anchor: "top" | "center" | "bottom" = "top", u = 1) {
  const kick = st.kicker === undefined ? w.kicker : st.kicker;
  const by = byline(w);
  const metaLines = st.meta === false ? [] : [`${w.day} · ${w.time}`, st.footer === undefined ? "hjerterum.info" : st.footer].filter((x): x is string => Boolean(x));
  const room = (size: number) => {
    const t = fit(ctx, w.title, s => `400 ${s}px ${SERIF}`, r.w, size, st.maxLines, Math.round(size * 0.45));
    const lines = st.italicAll ? t.lines.map(text => ({ text, italic: true })) : titleLines(t.lines);
    let s = t.size;
    while (s > 30 && lines.some(l => { ctx.font = `${l.italic ? "italic " : ""}400 ${s}px ${SERIF}`; return ctx.measureText(l.text).width > r.w; })) s -= 4;
    const height = (kick ? 52 * u : 0) + lines.length * s * 1.04 + (by ? 58 * u : 0) + (metaLines.length ? 24 * u + metaLines.length * 38 * u : 0);
    return { lines, s, height };
  };
  let lay = room(st.size);
  for (let size = st.size - 4; lay.height > r.h && size > st.size * 0.45; size -= 4) lay = room(size);
  let y = anchor === "top" ? r.y : anchor === "bottom" ? r.y + r.h - lay.height : r.y + (r.h - lay.height) / 2;
  const x = st.align === "center" ? r.x + r.w / 2 : r.x;
  const align = st.align === "center" ? "center" : "left";
  if (kick) { spaced(ctx, kick, x, y + 20 * u, `600 ${Math.round(20 * u)}px ${st.mono ? "\"Space Mono\", ui-monospace, monospace" : SANS}`, st.accent, 4.5 * u, align); y += 52 * u; }
  lay.lines.forEach(l => {
    y += lay.s * 0.86;
    text(ctx, l.text, x, y, `${l.italic ? "italic " : ""}400 ${lay.s}px ${SERIF}`, l.italic && !st.italicAll ? st.accent : st.color, align);
    y += lay.s * 0.18;
  });
  if (by) { y += 46 * u; text(ctx, by, x, y, `italic 400 ${Math.round(34 * u)}px ${SERIF}`, st.color, align); y += 12 * u; }
  if (metaLines.length) {
    y += 24 * u;
    metaLines.forEach((m, i) => { y += 34 * u; text(ctx, m, x, y, `${i === 0 ? 600 : 400} ${Math.round((i === 0 ? 26 : 24) * u)}px ${SANS}`, i === 0 ? st.color : st.muted, align); y += 4 * u; });
  }
  return { bottom: y };
}

function dateCircle(ctx: Ctx, cx: number, cy: number, r: number, fill: string, color: string, w: PosterWords) {
  ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  spaced(ctx, w.month.slice(0, 3), cx, cy - r * 0.3, `600 ${Math.round(r * 0.19)}px ${SANS}`, color, r * 0.04, "center");
  text(ctx, w.number, cx, cy + r * 0.52, `400 ${Math.round(r * 0.84)}px ${SERIF}`, color, "center");
}

/** Gitta's "Look B": a soft round circle whose edge fades out. */
function softCircle(ctx: Ctx, cx: number, cy: number, r: number, inner: string, mid: string, w: PosterWords, ink: string, sub: string) {
  const g = ctx.createRadialGradient(cx, cy - r * 0.1, 0, cx, cy, r);
  g.addColorStop(0, inner); g.addColorStop(0.55, mid); g.addColorStop(0.78, mid + "8c"); g.addColorStop(1, mid + "00");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  text(ctx, w.number, cx, cy + r * 0.2, `400 ${Math.round(r * 0.9)}px ${SERIF}`, ink, "center");
  spaced(ctx, w.month.slice(0, 3), cx, cy + r * 0.5, `400 ${Math.round(r * 0.22)}px "Space Mono", ui-monospace, monospace`, sub, r * 0.03, "center");
}

/** billet: the ticket's place on the page. */
function ticket(W: number, H: number) {
  const u = unit(W, H);
  return land(W, H) ? { x: 110 * u, y: 120 * u, w: W - 220 * u, h: H - 240 * u } : { x: 90 * u, y: 120 * u, w: W - 180 * u, h: H - 240 * u };
}
/** polaroid: the front snapshot's paper (the photo sits inside it, with room for the handwritten date below). */
function snapshot(W: number, H: number) {
  const u = unit(W, H);
  const w = land(W, H) ? H * 0.62 : W * 0.6;
  return { x: land(W, H) ? 170 * u : (W - w) / 2, y: land(W, H) ? H * 0.16 : 150 * u, w, h: w * 0.86 + 70 * u };
}
/** mosaik: five tiles - three photo crops, the date, the words. */
function tiles(W: number, H: number) {
  const u = unit(W, H), g = 18 * u, m = 40 * u;
  if (land(W, H)) {
    const cw = (W - 2 * m - 3 * g) / 4, ch = (H - 2 * m - g) / 2, x = (i: number) => m + i * (cw + g), y = (j: number) => m + j * (ch + g);
    return [{ x: x(0), y: y(0), w: cw * 2 + g, h: ch * 2 + g }, { x: x(2), y: y(1), w: cw, h: ch }, { x: x(3), y: y(1), w: cw, h: ch }, { x: x(3), y: y(0), w: cw, h: ch }, { x: x(2), y: y(0), w: cw, h: ch }];
  }
  const cw = (W - 2 * m - g) / 2, ch = (H - 2 * m - 2 * g) / 3, x = (i: number) => m + i * (cw + g), y = (j: number) => m + j * (ch + g);
  return [{ x: x(0), y: y(0), w: cw * 2 + g, h: ch }, { x: x(0), y: y(2), w: cw, h: ch }, { x: x(1), y: y(2), w: cw, h: ch }, { x: x(1), y: y(1), w: cw, h: ch }, { x: x(0), y: y(1), w: cw, h: ch }];
}
/** Like cover, but zoomed in around a point - the mosaic's details. */
function crop(ctx: Ctx, img: HTMLImageElement, x: number, y: number, w: number, h: number, fx: number, fy: number, zoom: number) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight) * zoom;
  const sw = w / scale, sh = h / scale;
  const sx = Math.min(Math.max(img.naturalWidth * fx - sw / 2, 0), img.naturalWidth - sw), sy = Math.min(Math.max(img.naturalHeight * fy - sh / 2, 0), img.naturalHeight - sh);
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

const weekday = (w: PosterWords) => w.day.split(" ")[0]!;

export const TEMPLATES: Record<string, Template> = {
  // ---- The first five, as a Facebook cover (their post and story layouts are in event-poster.ts) ----
  rolig: {
    photo: (W, H) => land(W, H) ? { x: W * 0.46, y: 0, w: W * 0.54, h: H, shape: "pebble" } : { x: W * 0.35, y: H * 0.07, w: W * 0.65, h: H * 0.47, shape: "pebble" },
    draw(ctx, W, H, w, a) {
      const u = unit(W, H), spot = this.photo(W, H)!;
      ctx.fillStyle = C.cream; ctx.fillRect(0, 0, W, H);
      photoIn(ctx, a.photo, spot);
      logo(ctx, a.logo, 84 * u, 72 * u, 56 * u, C.ink);
      block(ctx, { x: 84 * u, y: 190 * u, w: W * 0.46 - 190 * u, h: H - 330 * u }, w, { color: C.ink, accent: C.terra, muted: C.muted, size: 104 * u, maxLines: 3, footer: ADDRESS }, "center", u);
      dateCircle(ctx, W * 0.46, H - 170 * u, 92 * u, C.terra, C.cream, w);
    }
  },
  foto: {
    photo: (W, H) => ({ x: 0, y: 0, w: W, h: H, shape: "rect" }),
    draw(ctx, W, H, w, a) {
      const u = unit(W, H);
      ctx.fillStyle = C.dusk; ctx.fillRect(0, 0, W, H);
      photoIn(ctx, a.photo, { x: 0, y: 0, w: W, h: H, shape: "rect" });
      const g = land(W, H) ? ctx.createLinearGradient(0, 0, W, 0) : ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "rgba(42,30,24,.9)"); g.addColorStop(0.5, "rgba(42,30,24,.62)"); g.addColorStop(1, "rgba(42,30,24,.05)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      logo(ctx, a.logo, 72 * u, 64 * u, 56 * u, "#fbfaf8");
      block(ctx, { x: 72 * u, y: 170 * u, w: W * 0.5, h: H - 300 * u }, w, { color: "#fbfaf8", accent: C.blush, muted: "#e8dfd4", size: 112 * u, maxLines: 3, footer: ADDRESS }, "center", u);
    }
  },
  organisk: {
    photo: (W, H) => { const r = H * 0.36; return { x: W * 0.72 - r, y: H * 0.5 - r, w: r * 2, h: r * 2, shape: "blob" }; },
    draw(ctx, W, H, w, a) {
      const u = unit(W, H), spot = this.photo(W, H)!;
      ctx.fillStyle = C.sand; ctx.fillRect(0, 0, W, H);
      blob(ctx, 120 * u, 60 * u, 520 * u, 380 * u, [1, 1.08, 0.94, 1.12, 0.9, 1.05, 0.96, 1.1], C.camel);
      blob(ctx, W - 40 * u, H - 30 * u, 380 * u, 300 * u, [1, 1.1, 0.92, 1.05, 0.95, 1.12, 0.9], C.terra);
      blob(ctx, W * 0.47, H * 0.24, 130 * u, 120 * u, [1, 0.92, 1.08, 0.95, 1.1, 0.9, 1.04], C.sage);
      photoIn(ctx, a.photo, spot);
      logo(ctx, a.logo, 80 * u, 64 * u, 54 * u, C.ink);
      text(ctx, w.number, W * 0.47, H * 0.24 + 40 * u, `italic 400 ${Math.round(150 * u)}px ${SERIF}`, C.ink, "center");
      spaced(ctx, w.month, W * 0.47, H * 0.24 + 92 * u, `600 ${Math.round(18 * u)}px ${SANS}`, C.ink, 5 * u, "center");
      block(ctx, { x: 80 * u, y: H * 0.42, w: W * 0.36, h: H * 0.5 }, w, { color: C.ink, accent: C.terra, muted: C.muted, size: 92 * u, maxLines: 3, footer: "Hjerterum, Aarhus" }, "bottom", u);
    }
  },
  typografi: {
    photo: () => null,
    draw(ctx, W, H, w, a) {
      const u = unit(W, H);
      ctx.fillStyle = C.terra; ctx.fillRect(0, 0, W, H);
      blob(ctx, W - 140 * u, 210 * u, 330 * u, 300 * u, [1, 1.06, 0.94, 1.1, 0.92, 1.04, 0.97], "rgba(201,151,111,.45)");
      logo(ctx, a.logo, 84 * u, 72 * u, 56 * u, C.cream);
      block(ctx, { x: 84 * u, y: 190 * u, w: W * 0.7, h: H - 330 * u }, w, { color: C.cream, accent: C.blush, muted: C.blush, size: 128 * u, maxLines: 3, meta: false }, "center", u);
      text(ctx, w.number, 84 * u, H - 84 * u, `italic 400 ${Math.round(110 * u)}px ${SERIF}`, C.cream);
      ctx.font = `italic 400 ${Math.round(110 * u)}px ${SERIF}`;
      const nw = ctx.measureText(w.number).width;
      spaced(ctx, w.month, 84 * u + nw + 24 * u, H - 128 * u, `600 ${Math.round(20 * u)}px ${SANS}`, C.blush, 5 * u);
      text(ctx, weekday(w), 84 * u + nw + 24 * u, H - 92 * u, `500 ${Math.round(24 * u)}px ${SANS}`, C.cream);
      text(ctx, w.time, W - 84 * u, H - 128 * u, `600 ${Math.round(28 * u)}px ${SANS}`, C.cream, "right");
      text(ctx, "Hjerterum · hjerterum.info", W - 84 * u, H - 92 * u, `400 ${Math.round(22 * u)}px ${SANS}`, C.blush, "right");
    }
  },
  split: {
    photo: (W, H) => land(W, H) ? { x: 0, y: 0, w: W * 0.54, h: H, shape: "wave-right" } : { x: 0, y: 0, w: W, h: H * 0.56, shape: "wave-bottom" },
    draw(ctx, W, H, w, a) {
      const u = unit(W, H), spot = this.photo(W, H)!;
      ctx.fillStyle = C.cream; ctx.fillRect(0, 0, W, H);
      photoIn(ctx, a.photo, spot);
      logo(ctx, a.logo, W * 0.58, 70 * u, 52 * u, C.ink);
      block(ctx, { x: W * 0.58, y: 170 * u, w: W * 0.36, h: H - 260 * u }, w, { color: C.ink, accent: C.terra, muted: C.muted, size: 96 * u, maxLines: 3 }, "center", u);
    }
  },

  // ---- Gitta's looks ----
  datoblok: {
    photo: (W, H) => land(W, H) ? { x: W * 0.58, y: 0, w: W * 0.42, h: H, shape: "rect" } : { x: 0, y: H * 0.61, w: W, h: H * 0.39, shape: "rect" },
    draw(ctx, W, H, w, a) {
      const u = unit(W, H), L = land(W, H), spot = this.photo(W, H)!, right = L ? W * 0.58 : W;
      ctx.fillStyle = G.cream; ctx.fillRect(0, 0, W, H);
      photoIn(ctx, a.photo, spot);
      spaced(ctx, "Hjerterum", 60 * u, 80 * u, `400 ${Math.round(32 * u)}px "Space Mono", ui-monospace, monospace`, G.cocoa, 7 * u);
      ctx.fillStyle = G.caramel; ctx.fillRect(right - 300 * u, 68 * u, 240 * u, 14 * u);
      ctx.fillRect(60 * u, 140 * u, 230 * u, 250 * u);
      text(ctx, w.number, 175 * u, 300 * u, `400 ${Math.round(140 * u)}px ${SERIF}`, G.cocoa, "center");
      spaced(ctx, w.month.slice(0, 3), 175 * u, 360 * u, `400 ${Math.round(34 * u)}px "Space Mono", ui-monospace, monospace`, G.cocoa, 4 * u, "center");
      spaced(ctx, weekday(w), 330 * u, 250 * u, `700 ${Math.round(28 * u)}px "Space Mono", ui-monospace, monospace`, G.cocoa, 3 * u);
      text(ctx, `kl. ${w.time}`, 330 * u, 300 * u, `400 ${Math.round(28 * u)}px "Space Mono", ui-monospace, monospace`, G.grey);
      block(ctx, { x: 60 * u, y: 440 * u, w: right - 130 * u, h: (L ? H : spot.y) - 470 * u }, w, { color: G.cocoa, accent: G.cocoa, muted: G.grey, kicker: null, size: 100 * u, maxLines: 3, meta: false }, "top", u);
      text(ctx, "Læs mere på hjerterum.info", 60 * u, (L ? H : spot.y) - 36 * u, `400 ${Math.round(26 * u)}px "Space Mono", ui-monospace, monospace`, G.grey);
    }
  },
  cirkel: {
    photo: (W, H) => land(W, H) ? { x: W * 0.6, y: 0, w: W * 0.4, h: H, shape: "rect" } : { x: 0, y: H * 0.67, w: W, h: H * 0.33, shape: "rect" },
    draw(ctx, W, H, w, a) {
      const u = unit(W, H), L = land(W, H), spot = this.photo(W, H)!, right = L ? W * 0.6 : W;
      ctx.fillStyle = G.creamB; ctx.fillRect(0, 0, W, H);
      photoIn(ctx, a.photo, spot);
      spaced(ctx, "Hjerterum", 52 * u, 80 * u, `400 ${Math.round(32 * u)}px "Space Mono", ui-monospace, monospace`, G.brownB, 3 * u);
      ctx.fillStyle = G.sageLine; ctx.fillRect(right - 380 * u, 70 * u, 330 * u, 2 * u);
      softCircle(ctx, 230 * u, 310 * u, 165 * u, "#E4EADF", "#DDE4D7", w, "#3E322B", G.brownB2);
      text(ctx, weekday(w), 460 * u, 290 * u, `400 ${Math.round(34 * u)}px "Space Mono", ui-monospace, monospace`, G.brownB);
      text(ctx, `kl. ${w.time}`, 460 * u, 342 * u, `400 ${Math.round(34 * u)}px "Space Mono", ui-monospace, monospace`, G.brownB);
      const bottom = L ? H : spot.y;
      block(ctx, { x: 62 * u, y: 520 * u, w: right - 130 * u, h: bottom - 640 * u }, w, { color: G.brownB, accent: G.accentB, muted: G.brownB2, kicker: null, size: 92 * u, maxLines: 3, meta: false }, "top", u);
      text(ctx, "Læs mere på hjerterum.info", 66 * u, bottom - 50 * u, `400 ${Math.round(26 * u)}px "Space Mono", ui-monospace, monospace`, G.brownB);
      text(ctx, "Kom som du er", right - 66 * u, bottom - 50 * u, `italic 400 ${Math.round(34 * u)}px ${SERIF}`, G.accentB, "right");
    }
  },
  boks: {
    photo: (W, H) => ({ x: 0, y: 0, w: W, h: H, shape: "rect" }),
    draw(ctx, W, H, w, a) {
      const u = unit(W, H), L = land(W, H);
      photoIn(ctx, a.photo, { x: 0, y: 0, w: W, h: H, shape: "rect" }, "sepia(.12) saturate(1.05)");
      const bw = L ? W * 0.52 : W * 0.78, bh = L ? H * 0.74 : H * 0.6, bx = (W - bw) / 2, by = (H - bh) / 2;
      ctx.fillStyle = G.box; ctx.fillRect(bx, by, bw, bh);
      logo(ctx, a.logo, W / 2 - 30 * u, by + 46 * u, 60 * u, "#ffffff");
      ctx.font = "0px serif";
      block(ctx, { x: bx + 50 * u, y: by + 140 * u, w: bw - 100 * u, h: bh - 190 * u }, w, { color: "#ffffff", accent: "#f3e3d4", muted: "#f1e6dc", size: 84 * u, maxLines: 3, align: "center" }, "center", u);
    }
  },
  aften: {
    photo: (W, H) => land(W, H) ? { x: W * 0.4, y: 0, w: W * 0.6, h: H, shape: "rect" } : { x: 0, y: 0, w: W, h: H * 0.73, shape: "rect" },
    draw(ctx, W, H, w, a) {
      const u = unit(W, H), L = land(W, H), spot = this.photo(W, H)!;
      ctx.fillStyle = G.night; ctx.fillRect(0, 0, W, H);
      photoIn(ctx, a.photo, spot);
      const g = L ? ctx.createLinearGradient(spot.x + spot.w * 0.55, 0, spot.x, 0) : ctx.createLinearGradient(0, spot.h * 0.35, 0, spot.h);
      g.addColorStop(0, "rgba(42,34,29,0)"); g.addColorStop(0.55, "rgba(42,34,29,.7)"); g.addColorStop(1, G.night);
      ctx.fillStyle = g; ctx.fillRect(spot.x, spot.y, spot.w, spot.h);
      const r = L ? { x: 70 * u, y: 120 * u, w: W * 0.46, h: H - 210 * u } : { x: 70 * u, y: H * 0.42, w: W - 140 * u, h: H * 0.58 - 90 * u };
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 14 * u;
      const k = w.kicker;
      spaced(ctx, `Hjerterum · ${k}`, r.x, r.y + 20 * u + (L ? H * 0.12 : 0), `700 ${Math.round(24 * u)}px "Space Mono", ui-monospace, monospace`, "#ffffff", 6 * u);
      ctx.fillStyle = G.caramel; ctx.fillRect(r.x, r.y + 50 * u + (L ? H * 0.12 : 0), 110 * u, 10 * u);
      block(ctx, { x: r.x, y: r.y + 90 * u + (L ? H * 0.12 : 0), w: r.w, h: r.h - 90 * u - (L ? H * 0.12 : 0) }, w, { color: "#ffffff", accent: "#f3e3d4", muted: "#e8dfd4", kicker: null, size: 72 * u, maxLines: 3, footer: "Læs mere på hjerterum.info" }, L ? "top" : "bottom", u);
      ctx.restore();
    }
  },
  stribe: {
    photo: (W, H) => land(W, H) ? { x: 0, y: H * 0.52, w: W * 0.26, h: H * 0.48, shape: "rect" } : { x: 0, y: H * 0.65, w: W * 0.35, h: H * 0.35, shape: "rect" },
    draw(ctx, W, H, w, a) {
      const u = unit(W, H), L = land(W, H), sw = L ? W * 0.26 : W * 0.35;
      ctx.fillStyle = G.cream; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = G.caramel; ctx.fillRect(0, 0, sw, H);
      photoIn(ctx, a.photo, this.photo(W, H)!);
      spaced(ctx, weekday(w), 50 * u, 110 * u, `700 ${Math.round(28 * u)}px "Space Mono", ui-monospace, monospace`, G.cocoa, 5 * u);
      text(ctx, `${w.number}.`, 50 * u, (L ? 330 : 440) * u, `400 ${Math.round(150 * u)}px ${SERIF}`, G.cocoa);
      spaced(ctx, w.month, 54 * u, (L ? 380 : 492) * u, `700 ${Math.round(24 * u)}px "Space Mono", ui-monospace, monospace`, G.cocoa, 4 * u);
      text(ctx, `kl. ${w.time}`, 54 * u, (L ? 420 : 540) * u, `400 ${Math.round(24 * u)}px "Space Mono", ui-monospace, monospace`, G.cocoa);
      spaced(ctx, "Hjerterum", sw + 80 * u, 110 * u, `700 ${Math.round(26 * u)}px "Space Mono", ui-monospace, monospace`, G.grey, 8 * u);
      block(ctx, { x: sw + 80 * u, y: 200 * u, w: W - sw - 160 * u, h: H - 300 * u }, w, { color: G.cocoa, accent: G.cocoa, muted: G.grey, kicker: w.kicker, size: 96 * u, maxLines: 4, footer: "Læs mere på hjerterum.info", mono: true }, "center", u);
    }
  },

  // ---- New - reported: "Many of them are very much alike. Can we make a little more variation?" Each of these breaks the
  // cream-page-with-text-left-and-photo-right pattern: giant type, a ticket, tilted snapshots, a band across the photo, a mosaic. ----
  plakat: {
    // Type only, as big as it goes: the title fills the page, the date stands huge in the corner. A photo is not used.
    photo: () => null,
    draw(ctx, W, H, w, a) {
      const u = unit(W, H), L = land(W, H);
      ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, H);
      logo(ctx, a.logo, 80 * u, 70 * u, 52 * u, C.cream);
      text(ctx, w.number, W - 70 * u, (L ? 330 : 360) * u, `italic 400 ${Math.round((L ? 300 : 340) * u)}px ${SERIF}`, C.camel, "right");
      spaced(ctx, `${weekday(w)} · ${w.month}`, W - 76 * u, (L ? 380 : 420) * u, `600 ${Math.round(22 * u)}px ${SANS}`, C.cream, 6 * u, "right");
      const r = L ? { x: 80 * u, y: 200 * u, w: W * 0.62, h: H - 330 * u } : { x: 80 * u, y: 470 * u, w: W - 160 * u, h: H - 470 * u - 210 * u };
      block(ctx, r, w, { color: C.cream, accent: C.camel, muted: "#d8cbbb", kicker: null, size: (L ? 190 : 200) * u, maxLines: 4, meta: false }, "bottom", u);
      ctx.fillStyle = C.terra; ctx.fillRect(80 * u, H - 150 * u, 140 * u, 8 * u);
      text(ctx, `kl. ${w.time} · Hjerterum, Aarhus`, 80 * u, H - 80 * u, `600 ${Math.round(28 * u)}px ${SANS}`, C.cream);
    }
  },
  billet: {
    // A ticket on a dark table: the photo on the stub, the words on the ticket, a perforated line between them.
    photo: (W, H) => {
      const u = unit(W, H), t = ticket(W, H);
      return land(W, H) ? { x: t.x, y: t.y, w: t.w * 0.38, h: t.h, shape: "rect", radius: 26 * u } : { x: t.x, y: t.y, w: t.w, h: t.h * 0.42, shape: "rect", radius: 26 * u };
    },
    draw(ctx, W, H, w, a) {
      const u = unit(W, H), L = land(W, H), t = ticket(W, H), spot = this.photo(W, H)!;
      ctx.fillStyle = C.dusk; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,.4)"; ctx.shadowBlur = 50 * u; ctx.shadowOffsetY = 20 * u;
      ctx.fillStyle = C.cream; ctx.beginPath(); ctx.roundRect(t.x, t.y, t.w, t.h, 26 * u); ctx.fill(); ctx.restore();
      photoIn(ctx, a.photo, spot);
      // The notches and the perforation where the stub tears off.
      ctx.fillStyle = C.dusk; ctx.setLineDash([12 * u, 12 * u]); ctx.strokeStyle = C.camel; ctx.lineWidth = 3 * u;
      if (L) {
        const x = spot.x + spot.w;
        ctx.beginPath(); ctx.arc(x, t.y, 26 * u, 0, Math.PI * 2); ctx.arc(x, t.y + t.h, 26 * u, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x, t.y + 40 * u); ctx.lineTo(x, t.y + t.h - 40 * u); ctx.stroke();
      } else {
        const y = spot.y + spot.h;
        ctx.beginPath(); ctx.arc(t.x, y, 26 * u, 0, Math.PI * 2); ctx.arc(t.x + t.w, y, 26 * u, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(t.x + 40 * u, y); ctx.lineTo(t.x + t.w - 40 * u, y); ctx.stroke();
      }
      ctx.setLineDash([]);
      const r = L ? { x: spot.x + spot.w + 70 * u, y: t.y + 60 * u, w: t.w - spot.w - 140 * u, h: t.h - 120 * u } : { x: t.x + 60 * u, y: spot.y + spot.h + 50 * u, w: t.w - 120 * u, h: t.y + t.h - spot.y - spot.h - 100 * u };
      spaced(ctx, "Adgangsbillet · Hjerterum", r.x, r.y + 20 * u, `600 ${Math.round(20 * u)}px ${SANS}`, C.terra, 5 * u);
      block(ctx, { ...r, y: r.y + 60 * u, h: r.h - 60 * u }, w, { color: C.ink, accent: C.terra, muted: C.muted, kicker: null, size: 92 * u, maxLines: 3, footer: ADDRESS }, "center", u);
    }
  },
  polaroid: {
    // Two snapshots dropped on the table, a little askew; the words written beside them.
    photo: (W, H) => { const p = snapshot(W, H); return { x: p.x, y: p.y, w: p.w, h: p.w * 0.86, shape: "rect" }; },
    draw(ctx, W, H, w, a) {
      const u = unit(W, H), L = land(W, H), p = snapshot(W, H), spot = this.photo(W, H)!;
      ctx.fillStyle = C.sand; ctx.fillRect(0, 0, W, H);
      const card = (dx: number, dy: number, turn: number, filter: string, label: string | null) => {
        ctx.save();
        ctx.translate(p.x + p.w / 2 + dx, p.y + p.h / 2 + dy); ctx.rotate(turn); ctx.translate(-(p.x + p.w / 2), -(p.y + p.h / 2));
        ctx.shadowColor = "rgba(42,38,34,.25)"; ctx.shadowBlur = 36 * u; ctx.shadowOffsetY = 12 * u;
        ctx.fillStyle = "#fffdf9"; ctx.fillRect(p.x - 24 * u, p.y - 24 * u, p.w + 48 * u, p.h + 48 * u); ctx.shadowColor = "transparent";
        photoIn(ctx, a.photo, spot, filter);
        if (label) text(ctx, label, p.x + p.w / 2, p.y + p.h - 18 * u, `italic 400 ${Math.round(38 * u)}px ${SERIF}`, C.ink, "center");
        ctx.restore();
      };
      card(L ? 70 * u : 60 * u, -30 * u, 0.09, "grayscale(1) contrast(1.05)", null);
      card(0, 0, -0.05, "", `${weekday(w)} ${w.number}. ${w.month}`);
      // A strip of tape across the front snapshot.
      ctx.save(); ctx.translate(p.x + p.w / 2, p.y - 20 * u); ctx.rotate(-0.08); ctx.fillStyle = "rgba(201,151,111,.55)"; ctx.fillRect(-90 * u, -22 * u, 180 * u, 44 * u); ctx.restore();
      const r = L ? { x: W * 0.56, y: 110 * u, w: W * 0.38, h: H - 220 * u } : { x: 90 * u, y: p.y + p.h + 110 * u, w: W - 180 * u, h: H - p.y - p.h - 160 * u };
      block(ctx, r, w, { color: C.ink, accent: C.terra, muted: C.muted, size: 90 * u, maxLines: 3, align: L ? "left" : "center", italicAll: true }, "center", u);
    }
  },
  baand: {
    // The photo fills everything; a calm sage band runs straight across it with the words, centred.
    photo: (W, H) => ({ x: 0, y: 0, w: W, h: H, shape: "rect" }),
    draw(ctx, W, H, w, a) {
      const u = unit(W, H), L = land(W, H);
      photoIn(ctx, a.photo, { x: 0, y: 0, w: W, h: H, shape: "rect" });
      const bh = L ? H * 0.46 : H * 0.38, by = L ? (H - bh) / 2 : H * 0.5;
      ctx.fillStyle = "rgba(223,231,214,.94)"; ctx.fillRect(0, by, W, bh);
      ctx.fillStyle = G.leaf; ctx.fillRect(0, by, W, 6 * u); ctx.fillRect(0, by + bh - 6 * u, W, 6 * u);
      logo(ctx, a.logo, W / 2 - 150 * u, by + 34 * u, 46 * u, G.leaf);
      block(ctx, { x: L ? W * 0.18 : 80 * u, y: by + 100 * u, w: L ? W * 0.64 : W - 160 * u, h: bh - 130 * u }, w, { color: G.leaf, accent: "#6f7d52", muted: "#4f5a46", kicker: null, size: 96 * u, maxLines: 2, align: "center" }, "center", u);
    }
  },
  mosaik: {
    // A mosaic: the photo three times in different crops, a terracotta tile with the date and a cream tile with the title.
    photo: (W, H) => { const c = tiles(W, H); return { ...c[0]!, shape: "rect" }; },
    draw(ctx, W, H, w, a) {
      const u = unit(W, H), c = tiles(W, H);
      ctx.fillStyle = C.cream; ctx.fillRect(0, 0, W, H);
      const crops: Array<[number, number, number]> = [[0.5, 0.42, 1], [0.2, 0.7, 1.9], [0.8, 0.3, 2.4]];
      crops.forEach(([fx, fy, zoom], i) => { const t = c[i]!; ctx.save(); ctx.beginPath(); ctx.roundRect(t.x, t.y, t.w, t.h, 18 * u); ctx.clip(); if (a.photo) crop(ctx, a.photo, t.x, t.y, t.w, t.h, fx, fy, zoom); else { ctx.fillStyle = C.sand; ctx.fillRect(t.x, t.y, t.w, t.h); } ctx.restore(); });
      const d = c[3]!, words = c[4]!;
      ctx.fillStyle = C.terra; ctx.beginPath(); ctx.roundRect(d.x, d.y, d.w, d.h, 18 * u); ctx.fill();
      text(ctx, w.number, d.x + d.w / 2, d.y + d.h * 0.58, `400 ${Math.round(Math.min(d.w, d.h) * 0.52)}px ${SERIF}`, C.cream, "center");
      spaced(ctx, `${w.month.slice(0, 3)} · ${w.time}`, d.x + d.w / 2, d.y + d.h * 0.8, `600 ${Math.round(20 * u)}px ${SANS}`, C.blush, 4 * u, "center");
      ctx.fillStyle = C.sand; ctx.beginPath(); ctx.roundRect(words.x, words.y, words.w, words.h, 18 * u); ctx.fill();
      logo(ctx, a.logo, words.x + 40 * u, words.y + 36 * u, 44 * u, C.ink);
      block(ctx, { x: words.x + 40 * u, y: words.y + 110 * u, w: words.w - 80 * u, h: words.h - 150 * u }, w, { color: C.ink, accent: C.terra, muted: C.muted, kicker: null, size: 80 * u, maxLines: 3, footer: null }, "center", u);
    }
  },
  nat: {
    photo: (W, H) => { const u = unit(W, H); return land(W, H) ? { x: W - 110 * u - H * 0.62, y: H * 0.19, w: H * 0.62, h: H * 0.62, shape: "circle" } : { x: W / 2 - 230 * u, y: 140 * u, w: 460 * u, h: 460 * u, shape: "circle" }; },
    draw(ctx, W, H, w, a) {
      const u = unit(W, H), L = land(W, H), spot = this.photo(W, H)!;
      ctx.fillStyle = "#1f1a16"; ctx.fillRect(0, 0, W, H);
      const glow = ctx.createRadialGradient(spot.x + spot.w / 2, spot.y + spot.h / 2, spot.w * 0.3, spot.x + spot.w / 2, spot.y + spot.h / 2, spot.w * 0.95);
      glow.addColorStop(0, "rgba(217,182,122,.28)"); glow.addColorStop(1, "rgba(217,182,122,0)");
      ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = G.gold; ctx.lineWidth = 2 * u; ctx.beginPath(); ctx.arc(spot.x + spot.w / 2, spot.y + spot.h / 2, spot.w / 2 + 16 * u, 0, Math.PI * 2); ctx.stroke();
      photoIn(ctx, a.photo, spot);
      logo(ctx, a.logo, L ? 84 * u : W / 2 - 150 * u, L ? 72 * u : H - 110 * u, 52 * u, G.gold);
      const r = L ? { x: 84 * u, y: 170 * u, w: W * 0.5, h: H - 280 * u } : { x: 80 * u, y: 680 * u, w: W - 160 * u, h: H - 680 * u - 170 * u };
      block(ctx, r, w, { color: "#f3ead9", accent: G.gold, muted: "#cbbfa8", size: 98 * u, maxLines: 3, align: L ? "left" : "center" }, "center", u);
    }
  }
};
