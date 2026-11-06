import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as playfair } from "@remotion/google-fonts/PlayfairDisplay";
import { loadFont as inter } from "@remotion/google-fonts/Inter";
import type { Picture } from "./props";

/** The house's colours (as apps/web's poster templates). */
export const C = { cream: "#f6f1e7", sand: "#efe4d6", ink: "#2a2622", muted: "#5b534b", terra: "#94503f", camel: "#c9976f", dusk: "#2a1e18" };
export const serif = playfair("normal", { weights: ["400", "500"], subsets: ["latin", "latin-ext"] }).fontFamily;
playfair("italic", { weights: ["400"], subsets: ["latin", "latin-ext"] });
export const sans = inter("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin", "latin-ext"] }).fontFamily;

export const ease = Easing.bezier(0.33, 0, 0.2, 1);
export const rise = (f: number, delay: number, len = 30) => interpolate(f - delay, [0, len], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });

/** Centred: text and the rising words ("Alt centreret"). */
/** Reported (the chair, 6 Nov 2026): "Overskriften bliver næsten klippet. Hvorfor er der ikke mere luft?" Instagram shows a reel cut to 4:5 in the feed (y 285-1635 of
 * 1920) and lays its own name, words and buttons over the top and bottom of the full reel. Everything that must be read stays between SAFE_TOP and SAFE_BOTTOM. */
export const SAFE_TOP = 320, SAFE_BOTTOM = 1580;

export const CENTER = { textAlign: "center", alignItems: "center", "--rise-justify": "center" } as React.CSSProperties;

/** A size for words in Playfair that fits `width` in at most `lines` lines. */
export function fit(text: string, width: number, max: number, lines = 3, min = 52): number {
  const longest = Math.max(...text.split(/\s+/).map(w => w.length), 1);
  let size = Math.min(max, Math.floor(width / (longest * 0.56)));
  while (size > min && Math.ceil((text.length * size * 0.5) / width) > lines) size -= 4;
  return Math.max(min, size);
}

/** Words into lines of about `chars` characters (for titles set line by line). */
export function lines(text: string, chars: number, max = 4): string[] {
  const out: string[] = [];
  for (const w of text.split(/\s+/)) {
    const last = out[out.length - 1];
    if (last && (last + " " + w).length <= chars) out[out.length - 1] = last + " " + w; else out.push(w);
  }
  return out.length > max ? [...out.slice(0, max - 1), out.slice(max - 1).join(" ")] : out;
}

/** Hjerterum's own stamp (apps/web/public/brand/hjerterum-stempel.png, copied in), in one colour, turning from 270 degrees into place. */
export const Stamp: React.FC<{ size: number; color: string; delay?: number; style?: React.CSSProperties }> = ({ size, color, delay = 0, style }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const t = interpolate(f - delay, [0, fps * 1.6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return <div style={{ width: size, height: size, flex: "none", backgroundColor: color, WebkitMaskImage: `url(${staticFile("stempel.png")})`, WebkitMaskSize: "contain",
    WebkitMaskRepeat: "no-repeat", transform: `rotate(${270 * (1 - t)}deg)`, opacity: interpolate(t, [0, 0.15], [0, 1]), ...style }} />;
};

/** The top of every page: a small word on the left, the stamp large in the top right ("Logoet i højre top skal være større på alle"). */
export const Head: React.FC<{ kicker: string; color: string; stamp: string }> = ({ kicker, color, stamp }) =>
  <div style={{ position: "absolute", top: SAFE_TOP, left: 90, right: 80, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
    <Kicker text={kicker} color={color} /><Stamp size={200} color={stamp} /></div>;

/** Words rising into place one after another. */
export const Rise: React.FC<{ text: string; delay?: number; step?: number; style?: React.CSSProperties }> = ({ text, delay = 0, step = 3, style }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  return <div style={{ display: "flex", flexWrap: "wrap", gap: "0 0.28em", justifyContent: "var(--rise-justify, flex-start)", ...style }}>{text.split(" ").map((w, i) => {
    const s = spring({ frame: f - delay - i * step, fps, config: { damping: 200 } });
    return <span key={i} style={{ display: "inline-block", overflow: "hidden", paddingBottom: "0.08em" }}>
      <span style={{ display: "inline-block", transform: `translateY(${(1 - s) * 110}%)`, opacity: s }}>{w}</span></span>;
  })}</div>;
};

export const Kicker: React.FC<{ text: string; color: string; delay?: number }> = ({ text, color, delay = 0 }) => {
  const f = useCurrentFrame();
  const o = interpolate(f - delay, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 34, letterSpacing: "0.32em", color, opacity: o, transform: `translateX(${(1 - o) * -30}px)` }}>{text}</div>;
};

/** The teacher's picture, always whole (their own words on it are never cut): as wide as `width`, and no taller than `maxHeight` - a taller picture
 * stands whole on a blurred copy of itself. */
/** Asked (the chair, 6 Nov 2026): "Den fungerer heller ikke så godt, fordi eventbilledet bliver så lille." A picture that fills its whole box, and glides
 * slowly across itself, so a wide banner is seen at full height - all of it, over the video's first seconds. */
export const PanPic: React.FC<{ p: Picture; width: number; height: number; radius?: number | string; frames?: number }> = ({ p, width, height, radius = 0, frames = 200 }) => {
  const f = useCurrentFrame();
  const wide = p.ratio > width / height;
  const iw = wide ? height * p.ratio : width, ih = wide ? height : width / p.ratio;
  const t = interpolate(f, [0, frames], [0, 1], { extrapolateRight: "clamp", easing: (x: number) => x * x * (3 - 2 * x) });
  const x = wide ? -(iw - width) * t : 0, y = wide ? 0 : -(ih - height) * t * 0.6;
  return <div style={{ width, height, borderRadius: radius, overflow: "hidden", position: "relative", background: C.dusk }}>
    <Img src={staticFile(p.file)} style={{ position: "absolute", left: x, top: y, width: iw, height: ih }} />
  </div>;
};

export const Pic: React.FC<{ p: Picture; width: number; maxHeight: number; radius?: number | string; border?: string; style?: React.CSSProperties }> = ({ p, width, maxHeight, radius = 26, border, style }) => {
  const natural = width / p.ratio, height = Math.min(natural, maxHeight);
  const src = staticFile(p.file);
  return <div style={{ width, height, borderRadius: radius, overflow: "hidden", position: "relative", border, boxSizing: "content-box", background: C.dusk, ...style }}>
    {natural > maxHeight && <Img src={src} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: "blur(40px)", transform: "scale(1.2)" }} />}
    <Img src={src} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: natural > maxHeight ? "contain" : "cover" }} />
  </div>;
};

/** Soft organic shapes in the house's colours, slowly breathing. */
export const Blobs: React.FC<{ colors: string[] }> = ({ colors }) => {
  const f = useCurrentFrame();
  const blob = (i: number, x: number, y: number, r: number) => {
    const t = f / 30;
    const k = (n: number) => 50 + 12 * Math.sin(t * (0.5 + i * 0.13) + n * 1.7);
    return <div key={i} style={{ position: "absolute", left: x + Math.sin(t * 0.4 + i) * 40, top: y + Math.cos(t * 0.35 + i) * 50, width: r, height: r * 1.1, background: colors[i % colors.length],
      borderRadius: `${k(1)}% ${100 - k(2)}% ${k(3)}% ${100 - k(4)}% / ${k(5)}% ${k(6)}% ${100 - k(7)}% ${100 - k(8)}%`, opacity: interpolate(f, [i * 6, i * 6 + 20], [0, 1], { extrapolateRight: "clamp" }) }} />;
  };
  return <AbsoluteFill>{blob(0, -220, -160, 760)}{blob(1, 660, -180, 560)}{blob(2, -160, 1320, 700)}{blob(3, 620, 1500, 520)}</AbsoluteFill>;
};

/** The date as a soft pebble, the weekday and the time beside it. */
export const DateBadge: React.FC<{ dayNo: string; month: string; day: string; time: string; delay?: number; bg: string; ink: string; accent: string }> = ({ dayNo, month, day, time, delay = 0, bg, ink, accent }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const s = spring({ frame: f - delay, fps, config: { damping: 12 } });
  return <div style={{ display: "flex", alignItems: "center", gap: 28, transform: `scale(${s})`, textAlign: "left" }}>
    <div style={{ width: 190, height: 190, borderRadius: "46% 54% 52% 48% / 52% 46% 54% 48%", background: bg, display: "grid", placeItems: "center", color: ink }}>
      <div style={{ textAlign: "center", lineHeight: 1 }}><div style={{ fontFamily: serif, fontSize: 96 }}>{dayNo}</div><div style={{ fontFamily: sans, fontWeight: 600, fontSize: 17, letterSpacing: "0.14em", marginTop: 6 }}>{month.toUpperCase()}</div></div>
    </div>
    <div style={{ fontFamily: sans, color: accent, fontSize: 40, lineHeight: 1.3 }}><b style={{ fontWeight: 700 }}>{day}</b><br />kl. {time}</div>
  </div>;
};

/** The end of every video - the chair's own words (4 Nov 2026): "LOGO / EVENT TITEL / DATO OG TIDSPUNKT / Vi ses i Hjerterum / Guldsmedgade 26 i
 * Aarhus", all centred, no address on the web, and "lidt bevægelse": the page settles from a little closer while a soft light drifts across it. */
export const Farewell: React.FC<{ title: string; date: string; time: string; bg: string; ink: string; accent: string; backdrop?: React.ReactNode; top?: string }> = ({ title, date, time, bg, ink, accent, backdrop, top }) => {
  const f = useCurrentFrame();
  const o = (d: number) => interpolate(f - d, [0, 22], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  const up = (d: number): React.CSSProperties => ({ opacity: o(d), transform: `translateY(${(1 - o(d)) * 30}px)` });
  const zoom = interpolate(f, [0, 90], [1.12, 1], { extrapolateRight: "clamp", easing: Easing.bezier(0.2, 0, 0, 1) });
  const lx = 30 + 40 * Math.sin(f / 45), ly = 30 + 25 * Math.cos(f / 60);
  return <AbsoluteFill style={{ background: bg, opacity: o(0) }}>
    {backdrop}
    <AbsoluteFill style={{ background: `radial-gradient(circle at ${lx}% ${ly}%, rgba(255,250,240,.22) 0%, rgba(255,250,240,0) 55%)` }} />
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 90px", transform: `scale(${zoom})` }}>
      <Stamp size={280} color={ink} />
      {top && <div style={{ fontFamily: serif, fontSize: fit(top, 900, 130, 1, 80), color: ink, lineHeight: 1.08, marginTop: 80, whiteSpace: "nowrap", ...up(12) }}>{top}</div>}
      {title && <div style={{ fontFamily: serif, fontSize: fit(title, 900, 120, 3, 72), color: ink, lineHeight: 1.08, marginTop: 80, ...up(12) }}>{title}</div>}
      {date && <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 66, color: accent, marginTop: 44, lineHeight: 1.3, ...up(22) }}><div>{date}</div><div>{time}</div></div>}
      <div style={{ marginTop: 90, ...up(36) }}>
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 76, color: ink }}>Vi ses i Hjerterum</div>
        <div style={{ fontFamily: sans, fontSize: 46, color: ink, marginTop: 14, opacity: 0.85 }}>Guldsmedgade 26 i Aarhus</div>
      </div>
    </AbsoluteFill>
  </AbsoluteFill>;
};

/** "minimalistisk og bevægende sacred geometric symbol": the Flower of Life in thin lines, drawn in, slowly turning and breathing. */
export const SacredGeometry: React.FC<{ size: number; color: string; opacity?: number; style?: React.CSSProperties }> = ({ size, color, opacity = 0.22, style }) => {
  const f = useCurrentFrame();
  const r = size / 6, c = size / 2;
  const centres: Array<[number, number]> = [[0, 0]];
  for (let ring = 1; ring <= 2; ring++) for (let k = 0; k < 6 * ring; k++) {
    const side = Math.floor(k / ring), step = k % ring, a1 = (Math.PI / 3) * side, a2 = (Math.PI / 3) * (side + 1);
    centres.push([ring * r * Math.cos(a1) + step * r * (Math.cos(a2) - Math.cos(a1)), ring * r * Math.sin(a1) + step * r * (Math.sin(a2) - Math.sin(a1))]);
  }
  const draw = interpolate(f, [0, 90], [0, 1], { extrapolateRight: "clamp", easing: ease });
  const len = 2 * Math.PI * r;
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ opacity, transform: `rotate(${f * 0.12}deg) scale(${1 + 0.025 * Math.sin(f / 40)})`, overflow: "visible", ...style }}>
    <circle cx={c} cy={c} r={3 * r} fill="none" stroke={color} strokeWidth={2.2} strokeDasharray={6 * Math.PI * r} strokeDashoffset={(1 - draw) * 6 * Math.PI * r} />
    {centres.map(([x, y], i) => <circle key={i} cx={c + x} cy={c + y} r={r} fill="none" stroke={color} strokeWidth={1.8} strokeDasharray={len}
      strokeDashoffset={len * (1 - interpolate(draw, [(i / centres.length) * 0.6, (i / centres.length) * 0.6 + 0.4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }))} />)}
  </svg>;
};

/** A night of slowly twinkling stars. */
export const Stars: React.FC<{ color: string; count?: number }> = ({ color, count = 46 }) => {
  const f = useCurrentFrame();
  return <AbsoluteFill>{Array.from({ length: count }, (_, i) => {
    const x = (i * 263) % 1080, y = (i * 491) % 1920, r = 2 + (i % 3);
    return <div key={i} style={{ position: "absolute", left: x, top: y, width: r * 2, height: r * 2, borderRadius: r, background: color,
      boxShadow: i % 5 === 0 ? `0 0 ${8 + r * 3}px ${color}` : undefined, opacity: 0.2 + 0.6 * Math.abs(Math.sin(f / (16 + (i % 7) * 3) + i)) }} />;
  })}</AbsoluteFill>;
};

/** "lidt mere abstrakt minimalist baggrund ... bevægeligt og blødt": a few thin rings drifting, and one soft light. */
export const SoftLines: React.FC<{ color: string; glow: string }> = ({ color, glow }) => {
  const f = useCurrentFrame();
  const rings = [[300, 520, 380], [820, 1350, 520], [180, 1600, 260], [900, 300, 220]];
  return <AbsoluteFill style={{ overflow: "hidden" }}>
    <div style={{ position: "absolute", left: 540 - 600 + Math.sin(f / 70) * 160, top: 960 - 600 + Math.cos(f / 85) * 220, width: 1200, height: 1200, borderRadius: 600,
      background: `radial-gradient(circle, ${glow} 0%, rgba(0,0,0,0) 65%)`, filter: "blur(30px)" }} />
    {rings.map(([x, y, r], i) => <div key={i} style={{ position: "absolute", left: x - r + Math.sin(f / (60 + i * 9) + i) * 50, top: y - r + Math.cos(f / (70 + i * 7) + i) * 60,
      width: r * 2, height: r * 2, borderRadius: r, border: `2px solid ${color}`, opacity: 0.35, transform: `scale(${1 + 0.05 * Math.sin(f / 50 + i)})` }} />)}
  </AbsoluteFill>;
};

/** A slow zoom out through the whole video ("langsom zoom ud ... lidt moderne liv"). */
export const Camera: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const f = useCurrentFrame(), { durationInFrames } = useVideoConfig();
  return <AbsoluteFill style={{ transform: `scale(${interpolate(f, [0, durationInFrames], [1.07, 1])})` }}>{children}</AbsoluteFill>;
};
