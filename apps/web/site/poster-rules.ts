/** Requested: "Uploader man sit eget skal Saga tjekke ... om dimensionerne er rigtige". The sizes an organiser's own poster may
 * have - shared by the event form (src/poster-choice.tsx), which says it at once, and the worker (worker/event-posters.ts), which decides. */

/** Post (4:5), square (1:1) or story/reel (9:16), at least 1080 px wide. */
export const POSTER_SHAPES = [
  { label: "opslag 4:5", ratio: 4 / 5, example: "1080 × 1350" },
  { label: "kvadrat 1:1", ratio: 1, example: "1080 × 1080" },
  { label: "story 9:16", ratio: 9 / 16, example: "1080 × 1920" }
] as const;
export const POSTER_MIN_WIDTH = 1080;
/** Saga looks at the file itself, and the model takes pictures up to 5 MB - so a poster is at most 4.5 MB. */
export const POSTER_MAX_BYTES = 4.5 * 1024 * 1024;

/** What is wrong with the poster's measurements, in plain Danish - or null when they are right. */
export function posterSizeProblem(width: number, height: number): string | null {
  const wanted = POSTER_SHAPES.map(s => s.example).join(", ");
  if (!width || !height) return "Billedets størrelse kunne ikke læses. Gem det som jpg eller png, og prøv igen.";
  const shape = POSTER_SHAPES.find(s => Math.abs(width / height - s.ratio) / s.ratio <= 0.01);
  if (!shape) return `Opslaget er ${width} × ${height} px. Det skal have formatet til opslag, kvadrat eller story - fx ${wanted} px.`;
  if (width < POSTER_MIN_WIDTH) return `Opslaget er ${width} × ${height} px - for lille til Instagram og Facebook. Det skal være mindst ${POSTER_MIN_WIDTH} px bredt (${shape.example} px til ${shape.label}).`;
  return null;
}

/** The poster designs an organiser can choose (src/event-poster.ts VARIANTS draws them), and "eget": their own poster. */
export const POSTER_DESIGNS = ["rolig", "foto", "organisk", "typografi", "split", "datoblok", "cirkel", "boks", "aften", "stribe",
  "plakat", "billet", "polaroid", "baand", "mosaik", "nat", "underviser", "eget"] as const;
export type PosterDesign = (typeof POSTER_DESIGNS)[number];
export const isPosterDesign = (value: unknown): value is PosterDesign => typeof value === "string" && (POSTER_DESIGNS as readonly string[]).includes(value);
