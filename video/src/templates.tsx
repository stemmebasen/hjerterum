import React from "react";
import { AbsoluteFill, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Blobs, C, Camera, CENTER, DateBadge, Farewell, fit, Head, lines, PanPic, Pic, Rise, rise, SacredGeometry, sans, serif, SoftLines, Stamp, Stars } from "./parts";
import { FAREWELL_AT, type EventProps } from "./props";

/** The event videos, one per template the chair kept (4 Nov 2026). Each is 9 seconds: the event, then the farewell page. The picture is always the
 * teacher's whole picture; the words are the post's own (title, teacher, time, one sentence of Saga's approved text). */

const date = (p: EventProps) => `${p.dayName} ${p.dayNo}. ${p.month}`;
const End: React.FC<{ p: EventProps; bg: string; ink: string; accent: string; backdrop?: React.ReactNode }> = ({ p, ...rest }) =>
  <Sequence from={FAREWELL_AT}><Farewell title={p.title} date={date(p)} time={`kl. ${p.time}`} {...rest} /></Sequence>;
const Line: React.FC<{ text: string | null; color: string; delay: number; style?: React.CSSProperties }> = ({ text, color, delay, style }) => {
  const f = useCurrentFrame();
  return text ? <div style={{ fontFamily: sans, fontSize: 38, lineHeight: 1.4, color, maxWidth: 880, opacity: rise(f, delay), ...style }}>{text}</div> : null;
};
const away = (f: number) => rise(f, FAREWELL_AT, 30);

/** 1. Organisk: soft shapes, the picture in a pebble frame, the title, the date as a pebble. */
const Organisk: React.FC<{ p: EventProps }> = ({ p }) => {
  const f = useCurrentFrame();
  const t = rise(f, 10, 42);
  return <AbsoluteFill style={{ background: C.sand, overflow: "hidden" }}>
    <Blobs colors={[C.camel, "#e3cdb6", "#ead8c4", "#d9b99b"]} />
    <Head kicker={p.kicker} color={C.ink} stamp={C.ink} />
    <AbsoluteFill style={{ ...CENTER, padding: "400px 80px 110px", gap: 44, opacity: 1 - away(f) }}>
      {p.picture && <div style={{ transform: `translateY(${(1 - t) * 60}px) rotate(${-2 * (0.4 + 0.6 * t)}deg)`, opacity: t, boxShadow: "0 30px 70px rgba(60,35,20,.28)", borderRadius: "44px 70px 52px 80px / 60px 48px 74px 50px" }}>
        <Pic p={p.picture} width={880} maxHeight={640} radius="44px 70px 52px 80px / 60px 48px 74px 50px" border={`10px solid ${C.cream}`} /></div>}
      <Rise text={p.title} delay={34} step={4} style={{ fontFamily: serif, fontSize: fit(p.title, 900, 104, 3), color: C.ink, lineHeight: 1.05 }} />
      {p.host && <Rise text={`med ${p.host}`} delay={58} style={{ fontFamily: serif, fontStyle: "italic", fontSize: 52, color: C.ink }} />}
      <DateBadge dayNo={p.dayNo} month={p.month} day={p.dayName} time={p.timeRange} delay={74} bg={C.cream} ink={C.ink} accent={C.ink} />
      <Line text={p.line} color={C.ink} delay={96} />
    </AbsoluteFill>
    <End p={p} bg={C.sand} ink={C.ink} accent={C.terra} />
  </AbsoluteFill>;
};

/** 2. Organisk uden foto: the soft shapes, and the words as the picture. */
const OrganiskTypografi: React.FC<{ p: EventProps }> = ({ p }) => {
  const f = useCurrentFrame();
  const rows = lines(p.title, 14, 4);
  const size = Math.min(150, ...rows.map(r => fit(r, 900, 150, 1)));
  return <AbsoluteFill style={{ background: C.sand, overflow: "hidden" }}>
    <Blobs colors={[C.camel, "#e3cdb6", "#ead8c4", "#d9b99b"]} />
    <Head kicker={p.kicker} color={C.ink} stamp={C.ink} />
    <AbsoluteFill style={{ ...CENTER, padding: "430px 80px 130px", justifyContent: "space-between", opacity: 1 - away(f), transform: `scale(${1 - away(f) * 0.06})` }}>
      <div>{rows.map((l, i) => <Rise key={i} text={l} delay={14 + i * 9} style={{ fontFamily: serif, fontStyle: i % 2 ? "italic" : "normal", fontSize: size, color: C.ink, lineHeight: 1.02 }} />)}
        {p.host && <Rise text={`med ${p.host}`} delay={56} style={{ fontFamily: serif, fontStyle: "italic", fontSize: 56, color: C.ink, marginTop: 34 }} />}</div>
      <div style={{ display: "grid", justifyItems: "center", gap: 44 }}>
        <DateBadge dayNo={p.dayNo} month={p.month} day={p.dayName} time={p.timeRange} delay={70} bg={C.cream} ink={C.ink} accent={C.ink} />
        <Line text={p.line} color={C.ink} delay={95} />
      </div>
    </AbsoluteFill>
    <End p={p} bg={C.sand} ink={C.ink} accent={C.terra} />
  </AbsoluteFill>;
};

/** 3. Plakat: the picture across the whole width, the title large on the dark below, the Flower of Life turning slowly behind the words. */
const Plakat: React.FC<{ p: EventProps }> = ({ p }) => {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{ background: C.dusk }}>
    <Head kicker={p.kicker} color={C.camel} stamp={C.cream} />
    <div style={{ position: "absolute", left: 90, top: 990 }}><SacredGeometry size={900} color={C.camel} opacity={0.3} /></div>
    {p.picture && <div style={{ position: "absolute", top: 400, left: 0, opacity: rise(f, 0, 24) }}>
      <PanPic p={p.picture} width={1080} height={680} /></div>}
    <div style={{ ...CENTER, position: "absolute", left: 80, right: 80, top: 1100, opacity: 1 - away(f) }}>
      <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 34, letterSpacing: "0.32em", color: C.camel, opacity: rise(f, 18) }}>{`${p.dayName} ${p.dayNo}/${monthNo(p.month)} · kl. ${p.time}`.toUpperCase()}</div>
      <Rise text={p.title} delay={26} step={4} style={{ fontFamily: serif, fontSize: fit(p.title, 920, 140, 3), color: C.cream, lineHeight: 1.02, marginTop: 30 }} />
      <Line text={p.line} color={C.sand} delay={54} style={{ marginTop: 40 }} />
    </div>
    <End p={p} bg={C.dusk} ink={C.cream} accent={C.camel} />
  </AbsoluteFill>;
};

/** 4. Stribe: a caramel stripe with the date, the words beside it, and the picture large across both. */
const Stribe: React.FC<{ p: EventProps }> = ({ p }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const w = interpolate(spring({ frame: f, fps, config: { damping: 200 } }), [0, 1], [0, 330]);
  return <AbsoluteFill style={{ background: C.cream }}>
    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: w, background: C.camel }} />
    <div style={{ position: "absolute", left: 50, top: 140, width: 250, opacity: rise(f, 14), color: C.ink }}>
      <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 30, letterSpacing: "0.2em" }}>{p.dayName.toUpperCase()}</div>
      <div style={{ fontFamily: serif, fontSize: 220, lineHeight: 1, marginTop: 40 }}>{p.dayNo}.</div>
      <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 24, letterSpacing: "0.1em" }}>{p.month.toUpperCase()}</div>
      <div style={{ fontFamily: "monospace", fontSize: 30, marginTop: 30 }}>kl. {p.timeRange}</div>
    </div>
    <div style={{ position: "absolute", left: 390, right: 70, top: 70, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 30, letterSpacing: "0.32em", color: C.ink, opacity: rise(f, 10, 12) }}>HJERTERUM</div>
      <Stamp size={300} color={C.ink} />
    </div>
    <div style={{ ...CENTER, position: "absolute", left: 390, right: 60, top: 450, opacity: 1 - away(f) }}>
      <Rise text={p.title} delay={22} step={4} style={{ fontFamily: serif, fontSize: fit(p.title, 630, 104, 4), color: C.ink, lineHeight: 1.04 }} />
      {p.host && <Rise text={`med ${p.host}`} delay={46} step={3} style={{ fontFamily: serif, fontStyle: "italic", fontSize: 44, color: C.muted, marginTop: 22 }} />}
    </div>
    {p.picture && <div style={{ position: "absolute", left: 150, top: 1130, opacity: rise(f, 40), transform: `translateX(${(1 - rise(f, 40, 40)) * 300}px)`, boxShadow: "0 30px 70px rgba(60,35,20,.35)", borderRadius: "30px 0 0 30px" }}>
      <PanPic p={p.picture} width={930} height={640} radius="30px 0 0 30px" /></div>}
    <End p={p} bg={C.camel} ink={C.ink} accent={C.ink} />
  </AbsoluteFill>;
};

/** 5. Polaroid: the picture as a photograph laid on the table, with the time written under it. */
const Polaroid: React.FC<{ p: EventProps }> = ({ p }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const drop = spring({ frame: f - 6, fps, config: { damping: 14, mass: 1.2 } });
  return <AbsoluteFill style={{ background: C.sand }}>
    <Head kicker={p.kicker} color={C.terra} stamp={C.ink} />
    {p.picture && <div style={{ position: "absolute", left: 40, top: 430, width: 1000, background: "#fffdf8", padding: "36px 36px 156px", boxSizing: "border-box", boxShadow: "0 30px 60px rgba(60,35,20,.3)",
      transform: `translateY(${(1 - drop) * -900}px) rotate(${-4 + (1 - drop) * -12}deg)` }}>
      <Pic p={p.picture} width={928} maxHeight={640} radius={0} />
      <div style={{ position: "absolute", bottom: 46, left: 0, right: 0, textAlign: "center", fontFamily: serif, fontStyle: "italic", fontSize: 54, color: C.ink, opacity: rise(f, 34) }}>{p.dayName.toLowerCase()} {p.dayNo}/{monthNo(p.month)}, kl. {p.time}</div>
      <div style={{ position: "absolute", top: -26, left: 410, width: 180, height: 56, background: "rgba(201,151,111,.55)", transform: "rotate(3deg)" }} />
    </div>}
    <div style={{ ...CENTER, position: "absolute", left: 90, right: 90, top: 1330, opacity: 1 - away(f) }}>
      <Rise text={p.title} delay={40} step={5} style={{ fontFamily: serif, fontSize: fit(p.title, 900, 130, 2), color: C.ink, lineHeight: 1.05 }} />
      {p.host && <Rise text={`med ${p.host}`} delay={50} step={4} style={{ fontFamily: serif, fontStyle: "italic", fontSize: 56, color: C.muted, marginTop: 10 }} />}
      <Line text={p.line} color={C.ink} delay={62} style={{ marginTop: 30 }} />
    </div>
    <End p={p} bg={C.sand} ink={C.ink} accent={C.terra} />
  </AbsoluteFill>;
};

/** 7. Nat: dark, a golden light behind the picture, stars that go on twinkling to the end. For the evening. */
const Nat: React.FC<{ p: EventProps }> = ({ p }) => {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{ background: "radial-gradient(circle at 50% 35%, #3a2a22 0%, #1d1512 60%, #120d0b 100%)" }}>
    <Stars color={C.sand} />
    <div style={{ position: "absolute", left: 140, top: 470, width: 800, height: 800, borderRadius: 400, background: "radial-gradient(circle, rgba(201,151,111,.85) 0%, rgba(201,151,111,.25) 55%, rgba(201,151,111,0) 70%)",
      transform: `scale(${0.6 + 0.4 * rise(f, 0, 50) + 0.03 * Math.sin(f / 18)})` }} />
    <Head kicker={`${p.dayName.toUpperCase()} AFTEN`} color={C.camel} stamp={C.camel} />
    {p.picture && <div style={{ position: "absolute", left: 130, top: 620, opacity: rise(f, 12, 40), boxShadow: "0 0 80px rgba(201,151,111,.5)", borderRadius: 26 }}>
      <Pic p={p.picture} width={820} maxHeight={560} /></div>}
    <div style={{ ...CENTER, position: "absolute", left: 90, right: 90, top: 1220, opacity: 1 - away(f) }}>
      <Rise text={p.title} delay={36} step={5} style={{ fontFamily: serif, fontSize: fit(p.title, 900, 130, 2), color: C.cream, lineHeight: 1.05 }} />
      {p.host && <Rise text={`med ${p.host}`} delay={46} step={4} style={{ fontFamily: serif, fontStyle: "italic", fontSize: 60, color: C.camel, marginTop: 6 }} />}
      <div style={{ fontFamily: sans, fontSize: 42, color: C.sand, marginTop: 40, opacity: rise(f, 58) }}>{p.dayName} {p.dayNo}/{monthNo(p.month)} · kl. {p.time}</div>
    </div>
    <End p={p} bg="#1d1512" ink={C.cream} accent={C.camel} backdrop={<Stars color={C.sand} />} />
  </AbsoluteFill>;
};

/** 8. Citat: the teacher's own sentence first, then the picture and the title (the date only at the end). */
const Citat: React.FC<{ p: EventProps }> = ({ p }) => {
  const f = useCurrentFrame();
  const card = rise(f, 96, 36);
  return <AbsoluteFill style={{ background: C.cream }}>
    <Head kicker={p.kicker} color={C.terra} stamp={C.ink} />
    <div style={{ ...CENTER, position: "absolute", left: 90, right: 90, top: 460, transform: `translateY(${-card * 120}px)`, opacity: 1 - away(f) }}>
      <div style={{ fontFamily: serif, fontSize: 320, color: C.terra, lineHeight: 0.6, opacity: rise(f, 0, 20) }}>“</div>
      <Rise text={p.quote ?? ""} delay={12} step={3} style={{ fontFamily: serif, fontStyle: "italic", fontSize: fit(p.quote ?? "", 900, 88, 5, 56), color: C.ink, lineHeight: 1.15, marginTop: 30 }} />
      {p.host && <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 36, color: C.muted, marginTop: 40, opacity: rise(f, 60) }}>{p.host}, underviser</div>}
    </div>
    <div style={{ position: "absolute", left: 90, right: 90, top: 1110, opacity: card * (1 - away(f)), transform: `translateY(${(1 - card) * 120}px)`, display: "grid", gap: 30, justifyItems: "center", textAlign: "center" }}>
      {p.picture && <div style={{ boxShadow: "0 30px 60px rgba(60,35,20,.25)", borderRadius: 26 }}><Pic p={p.picture} width={900} maxHeight={520} /></div>}
      <div style={{ fontFamily: serif, fontSize: fit(p.title, 900, 72, 2), color: C.ink }}>{p.title}</div>
    </div>
    <End p={p} bg={C.cream} ink={C.ink} accent={C.terra} backdrop={<SoftLines color={C.camel} glow="rgba(201,151,111,.35)" />} />
  </AbsoluteFill>;
};

/** 10. Mød underviseren: the teacher's own photo first (given with their PR material and consent), their name, then what they bring (no date on
 * the first page). */
const MoedUnderviseren: React.FC<{ p: EventProps }> = ({ p }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 16 } });
  const face = p.portrait ?? p.picture;
  return <AbsoluteFill style={{ background: C.cream, overflow: "hidden" }}>
    <Head kicker="MØD UNDERVISEREN" color={C.terra} stamp={C.ink} />
    {face && <div style={{ position: "absolute", left: 220, top: 450, width: 640, height: 640, borderRadius: 320, overflow: "hidden", border: `14px solid ${C.camel}`, transform: `scale(${s})` }}>
      <Img src={staticFile(face.file)} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>}
    <div style={{ ...CENTER, position: "absolute", left: 90, right: 90, top: 1170, opacity: 1 - away(f) }}>
      <Rise text={p.host ?? ""} delay={20} step={5} style={{ fontFamily: serif, fontSize: fit(p.host ?? "", 900, 130, 2), color: C.ink, lineHeight: 1.05 }} />
      <Line text={p.line} color={C.muted} delay={32} style={{ fontFamily: serif, fontStyle: "italic", fontSize: 50, marginTop: 16 }} />
      <div style={{ display: "inline-block", marginTop: 50, padding: "22px 44px", borderRadius: 60, background: C.terra, color: C.cream, fontFamily: sans, fontWeight: 600, fontSize: 42, opacity: rise(f, 50) }}>{p.title}</div>
    </div>
    <End p={p} bg={C.cream} ink={C.ink} accent={C.terra} backdrop={<SoftLines color={C.terra} glow="rgba(148,80,63,.22)" />} />
  </AbsoluteFill>;
};

const MONTHS = ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober", "november", "december"];
const monthNo = (month: string) => MONTHS.indexOf(month.toLowerCase()) + 1;

const BY_NO = { 1: Organisk, 2: OrganiskTypografi, 3: Plakat, 4: Stribe, 5: Polaroid, 7: Nat, 8: Citat, 10: MoedUnderviseren } as const;
export const EventVideo: React.FC<EventProps> = p => {
  const T = BY_NO[p.template] ?? Organisk;
  return <Camera><T p={p} /></Camera>;
};
