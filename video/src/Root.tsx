import React from "react";
import { AbsoluteFill, Composition, Freeze, interpolate, useCurrentFrame } from "remotion";
import { EventVideo } from "./templates";
import { UgensEvents, weekFrames } from "./week";
import { DesignInMotion, STILL_FRAMES } from "./still";
import { EVENT_FRAMES, type EventProps, type StillProps, type WeekProps } from "./props";

const sampleEvent: EventProps = { template: 1, title: "Somatisk Yin Yoga, Ansigtsyoga og Meditation", host: "Mari-Anne Christoffersen", picture: null, portrait: null, quote: null,
  kicker: "WORKSHOP", dayName: "Søndag", dayNo: "15", month: "november", time: "9.45", timeRange: "9.45-12.15", line: "Sæt tiden på pause midt i november." };
const sampleWeek: WeekProps = { weekNo: 46, range: "9.–15. nov.", events: [] };
const sampleStill: StillProps = { picture: { file: "stempel.png", ratio: 1 }, effect: "zoom" };

/** Reported (the chair, 9 Nov 2026): "Det er er helt bart miniature billede" - Facebook (and the story Meta makes of a reel) takes the video's first frame,
 * which was the empty background before the words rise. The video now opens on its finished cover (the frame Instagram is told to take, social.ts
 * REEL_COVER_MS), which dissolves into the build-up within half a second. */
export const COVER_FRAME = { event: 135, week: 75 };
function coverFirst<P extends object>(Video: React.FC<P>, cover: number): React.FC<P> {
  return props => {
    const f = useCurrentFrame();
    const veil = interpolate(f, [0, 4, 16], [1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return <AbsoluteFill><Video {...props} />{veil > 0 && <AbsoluteFill style={{ opacity: veil }}><Freeze frame={cover}><Video {...props} /></Freeze></AbsoluteFill>}</AbsoluteFill>;
  };
}
const EventOpening = coverFirst(EventVideo, COVER_FRAME.event);
const WeekOpening = coverFirst(UgensEvents, COVER_FRAME.week);

export const Root: React.FC = () => <>
  <Composition id="Event" component={EventOpening as unknown as React.FC<Record<string, unknown>>} durationInFrames={EVENT_FRAMES} fps={30} width={1080} height={1920}
    defaultProps={sampleEvent as unknown as Record<string, unknown>} />
  <Composition id="Week" component={WeekOpening as unknown as React.FC<Record<string, unknown>>} durationInFrames={weekFrames(sampleWeek)} fps={30} width={1080} height={1920}
    defaultProps={sampleWeek as unknown as Record<string, unknown>}
    calculateMetadata={({ props }) => ({ durationInFrames: weekFrames(props as unknown as WeekProps) })} />
  <Composition id="Still" component={DesignInMotion as unknown as React.FC<Record<string, unknown>>} durationInFrames={STILL_FRAMES} fps={30} width={1080} height={1920}
    defaultProps={sampleStill as unknown as Record<string, unknown>} />
</>;
