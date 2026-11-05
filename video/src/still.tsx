import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { StillProps } from "./props";

/** Requested (the chair, 5 Nov 2026): "Er det muligt at bruge disse skabeloner, med lidt bevægelse? Gerne i starten må de gerne have en synlig og markant
 * effekt, så man ser dem, om det så er ryste, zoom eller slør ind". The chair's own design from Plakater og opslag as a reel: a marked start - a zoom that
 * lands, a shake, or a blur that clears - then a slow, calm drift, on a soft, blurred copy of itself. The design is drawn by the studio; nothing is added. */
export const STILL_FRAMES = 240;

export const DesignInMotion: React.FC<StillProps> = ({ picture, effect }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const src = staticFile(picture.file);
  // The calm part: a slow push in over the whole video.
  const drift = interpolate(f, [0, STILL_FRAMES], [1, 1.06]);
  let scale = 1, x = 0, y = 0, rotate = 0, blur = 0, opacity = 1, flash = 0;
  if (effect === "zoom") {
    // From far in, landing with a small overshoot - and a short light as it lands.
    const s = spring({ frame: f, fps, config: { damping: 9, stiffness: 120, mass: 0.8 } });
    scale = interpolate(s, [0, 1], [2.2, 1]);
    opacity = interpolate(f, [0, 4], [0, 1], { extrapolateRight: "clamp" });
    flash = interpolate(f, [8, 12, 24], [0, 0.45, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  } else if (effect === "ryst") {
    // A clear shake that settles within a second.
    const k = Math.max(0, 1 - f / 26);
    x = Math.sin(f * 2.1) * 46 * k; y = Math.cos(f * 2.7) * 30 * k; rotate = Math.sin(f * 1.7) * 2.6 * k;
    scale = 1 + 0.08 * k;
  } else {
    // "slør ind": out of a strong blur, a little large, into focus.
    blur = interpolate(f, [0, 26], [44, 0], { extrapolateRight: "clamp" });
    opacity = interpolate(f, [0, 10], [0, 1], { extrapolateRight: "clamp" });
    scale = interpolate(f, [0, 26], [1.14, 1], { extrapolateRight: "clamp" });
  }
  const width = 1000, height = width / picture.ratio;
  return <AbsoluteFill style={{ background: "#1c1714", overflow: "hidden" }}>
    <Img src={src} style={{ position: "absolute", inset: -80, width: "calc(100% + 160px)", height: "calc(100% + 160px)", objectFit: "cover", filter: "blur(48px) brightness(.72)",
      transform: `scale(${1.1 * drift})` }} />
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ width, height: Math.min(height, 1780), borderRadius: 28, overflow: "hidden", boxShadow: "0 40px 120px rgba(0,0,0,.45)", opacity,
        transform: `translate(${x}px, ${y}px) rotate(${rotate}deg) scale(${scale * drift})`, filter: blur ? `blur(${blur}px)` : undefined }}>
        <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      </div>
    </AbsoluteFill>
    {flash > 0 && <AbsoluteFill style={{ background: "#fff8ee", opacity: flash }} />}
  </AbsoluteFill>;
};
