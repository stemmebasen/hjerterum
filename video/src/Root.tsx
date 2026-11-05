import React from "react";
import { Composition } from "remotion";
import { EventVideo } from "./templates";
import { UgensEvents, weekFrames } from "./week";
import { DesignInMotion, STILL_FRAMES } from "./still";
import { EVENT_FRAMES, type EventProps, type StillProps, type WeekProps } from "./props";

const sampleEvent: EventProps = { template: 1, title: "Somatisk Yin Yoga, Ansigtsyoga og Meditation", host: "Mari-Anne Christoffersen", picture: null, portrait: null, quote: null,
  kicker: "WORKSHOP", dayName: "Søndag", dayNo: "15", month: "november", time: "9.45", timeRange: "9.45-12.15", line: "Sæt tiden på pause midt i november." };
const sampleWeek: WeekProps = { weekNo: 46, range: "9.–15. nov.", events: [] };
const sampleStill: StillProps = { picture: { file: "stempel.png", ratio: 1 }, effect: "zoom" };

export const Root: React.FC = () => <>
  <Composition id="Event" component={EventVideo as unknown as React.FC<Record<string, unknown>>} durationInFrames={EVENT_FRAMES} fps={30} width={1080} height={1920}
    defaultProps={sampleEvent as unknown as Record<string, unknown>} />
  <Composition id="Week" component={UgensEvents as unknown as React.FC<Record<string, unknown>>} durationInFrames={weekFrames(sampleWeek)} fps={30} width={1080} height={1920}
    defaultProps={sampleWeek as unknown as Record<string, unknown>}
    calculateMetadata={({ props }) => ({ durationInFrames: weekFrames(props as unknown as WeekProps) })} />
  <Composition id="Still" component={DesignInMotion as unknown as React.FC<Record<string, unknown>>} durationInFrames={STILL_FRAMES} fps={30} width={1080} height={1920}
    defaultProps={sampleStill as unknown as Record<string, unknown>} />
</>;
