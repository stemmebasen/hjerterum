/** What a video is made from. The jobs (video/jobs.mjs) build these from the posts Saga has proposed, so a video says what the post says. */

/** The templates the chair chose (4 Nov 2026), by their numbers in the preview: "6eren kan ikke bruges", "9eren kan ikke bruges". */
export type TemplateNo = 1 | 2 | 3 | 4 | 5 | 7 | 8 | 10;
export const TEMPLATES: Record<TemplateNo, string> = {
  1: "Organisk", 2: "Organisk uden foto", 3: "Plakat", 4: "Stribe", 5: "Polaroid", 7: "Nat", 8: "Citat", 10: "Mød underviseren",
};

/** A picture copied in for the render (public/jobs/...), with its shape, so it is always shown whole. */
export type Picture = { file: string; ratio: number };

export type EventProps = {
  template: TemplateNo;
  title: string;
  host: string | null;
  picture: Picture | null;
  /** The teacher's own photo, given with their PR material and consent (no. 10). */
  portrait: Picture | null;
  /** A sentence from the teacher, given with their PR material and consent (no. 8). */
  quote: string | null;
  kicker: string;
  /** "Søndag", "15", "november", "9.45", "9.45-12.15". */
  dayName: string;
  dayNo: string;
  month: string;
  time: string;
  timeRange: string;
  /** One sentence from the post's own words (Saga's, approved by the chair). */
  line: string | null;
};

export type WeekEvent = { picture: Picture; day: string; date: string; time: string; title: string; host: string | null };
export type WeekProps = { weekNo: number; range: string; events: WeekEvent[] };

export const EVENT_FRAMES = 270;
export const FAREWELL_AT = 186;

/** The chair's own design in motion (still.tsx): "ryste, zoom eller slør ind". */
export type StillEffect = "zoom" | "ryst" | "slor";
export type StillProps = { picture: Picture; effect: StillEffect };
