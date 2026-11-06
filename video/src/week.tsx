import React from "react";
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from "remotion";
import { Blobs, C, Camera, CENTER, Farewell, fit, Kicker, Pic, Rise, rise, SAFE_BOTTOM, SAFE_TOP, sans, serif, Stamp } from "./parts";
import type { WeekEvent, WeekProps } from "./props";

/** Ugens events as a reel (the chair, 4 Nov 2026): "blødere, langsommere, mere samlende grafik og så måske to events pr side", the first page
 * "2.- 8. nov. (Uge 46) / i Hjerterum" (the week's own dates) and the last "Kom som du er! / Vi ses i Hjerterum / Guldsmedgade 26 i Aarhus". */
export const INTRO = 96, PAGE = 120, OUTRO = 120;
export const weekFrames = (p: WeekProps) => INTRO + Math.ceil(p.events.length / 2) * PAGE + OUTRO;
const soft = (f: number, dur: number, edge = 24) => interpolate(f, [0, edge, dur - edge, dur], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

const Card: React.FC<{ e: WeekEvent; delay: number; tilt: number }> = ({ e, delay, tilt }) => {
  const f = useCurrentFrame();
  const t = rise(f, delay, 42), w = rise(f, delay + 14);
  return <div style={{ display: "grid", gap: 14, justifyItems: "center", textAlign: "center" }}>
    <div style={{ transform: `translateY(${(1 - t) * 60}px) rotate(${tilt * (0.4 + 0.6 * t)}deg) scale(${1 + f * 0.0002})`, opacity: t, boxShadow: "0 30px 70px rgba(60,35,20,.28)", borderRadius: "44px 70px 52px 80px / 60px 48px 74px 50px" }}>
      <Pic p={e.picture} width={660} maxHeight={230} radius="44px 70px 52px 80px / 60px 48px 74px 50px" border={`10px solid ${C.cream}`} /></div>
    <div style={{ opacity: w, transform: `translateY(${(1 - w) * 24}px)` }}>
      <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 32, letterSpacing: "0.18em", color: C.terra }}>{e.day.toUpperCase()} {e.date} · KL. {e.time}</div>
      <div style={{ fontFamily: serif, fontSize: fit(e.title, 860, 58, 2), color: C.ink, lineHeight: 1.08, marginTop: 6 }}>{e.title}</div>
      {e.host && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 40, color: C.muted, marginTop: 4 }}>med {e.host}</div>}
    </div>
  </div>;
};

const Page: React.FC<{ two: WeekEvent[] }> = ({ two }) => {
  const f = useCurrentFrame();
  // Within what Instagram shows (parts.tsx SAFE_TOP/SAFE_BOTTOM), under the week and the stamp.
  return <AbsoluteFill style={{ ...CENTER, justifyContent: "center", padding: `${SAFE_TOP + 220}px 90px ${1920 - SAFE_BOTTOM}px`, gap: 30, opacity: soft(f, PAGE + 24, 22) }}>
    {two.map((e, j) => <Card key={j} e={e} delay={8 + j * 18} tilt={j ? 1.5 : -1.5} />)}
  </AbsoluteFill>;
};

export const UgensEvents: React.FC<WeekProps> = p => {
  const f = useCurrentFrame();
  const pages = Array.from({ length: Math.ceil(p.events.length / 2) }, (_, i) => p.events.slice(i * 2, i * 2 + 2));
  const end = INTRO + pages.length * PAGE;
  return <Camera><AbsoluteFill style={{ background: C.sand, overflow: "hidden" }}>
    <Blobs colors={["#e6d2bd", "#ead8c4", "#dcc0a5", "#e9d6c2"]} />
    <Sequence durationInFrames={INTRO + 10}><AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 40, opacity: soft(f, INTRO + 10, 20), ...CENTER }}>
      <Stamp size={300} color={C.ink} />
      <Kicker text="UGENS EVENTS" color={C.terra} delay={16} />
      <Rise text={p.range} delay={24} step={6} style={{ fontFamily: serif, fontSize: 170, color: C.ink, lineHeight: 1 }} />
      <Rise text={`(Uge ${p.weekNo})`} delay={34} step={6} style={{ fontFamily: serif, fontStyle: "italic", fontSize: 90, color: C.ink, lineHeight: 1 }} />
      <Rise text="i Hjerterum" delay={44} step={4} style={{ fontFamily: sans, fontSize: 56, color: C.muted }} />
    </AbsoluteFill></Sequence>
    {/* What holds the pages together: the week and the stamp stay at the top. */}
    <div style={{ position: "absolute", top: SAFE_TOP, left: 90, right: 80, display: "flex", justifyContent: "space-between", alignItems: "center", opacity: rise(f, INTRO - 20, 30) * (1 - rise(f, end - 10, 24)) }}>
      <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 32, letterSpacing: "0.28em", color: C.ink }}>UGENS EVENTS · UGE {p.weekNo}</div>
      <Stamp size={200} color={C.ink} delay={INTRO - 20} />
    </div>
    {pages.map((two, i) => <Sequence key={i} from={INTRO + i * PAGE - 12} durationInFrames={PAGE + 24}><Page two={two} /></Sequence>)}
    <Sequence from={end}><Farewell title="" date="" time="" top="Kom som du er!" bg={C.sand} ink={C.ink} accent={C.terra} backdrop={<Blobs colors={["#e6d2bd", "#ead8c4", "#dcc0a5", "#e9d6c2"]} />} /></Sequence>
  </AbsoluteFill></Camera>;
};
