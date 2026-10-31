/** Requested: "Man skal ikke vælge mellem Facebook eller Instagram. Det er blot sociale medier. Her bør blot være to muligheder:
 * Ja tak. Nej tak." and "Man skal ikke eftersende foto. Man kan gå ind og redigere sit event senere hen."
 * The steps with fixed answers in "Opret med Saga": the same buttons every time, one click answers, no model involved.
 * Shared by the worker (worker/event-guide.ts) and the page (src/saga-event-guide.tsx). */
export const GUIDE_CHOICES = {
  sociale: ["Ja tak", "Nej tak"],
  billeder: ["Upload foto nu", "Spring over"]
} as const;

/** The photo button opens the file picker on the page; it is never sent as an answer. */
export const UPLOAD_NOW = GUIDE_CHOICES.billeder[0];

export type FixedStep = keyof typeof GUIDE_CHOICES;
export const isFixedStep = (step: string): step is FixedStep => step in GUIDE_CHOICES;
