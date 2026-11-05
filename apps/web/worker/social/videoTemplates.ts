import type { SocialPost } from "./social.js";

/** The video templates the chair kept (video/src/templates.tsx; the chair, 4 Nov 2026: 6 and 9 "kan ikke bruges"). The numbers are the
 * templates' own, as the chair first saw them - and as video/jobs.mjs chooseTemplate reads source.videoTemplate. */
export const VIDEO_TEMPLATES: ReadonlyArray<{ no: number; name: string; needs: "nothing" | "picture" | "quote" | "portrait" }> = [
  { no: 1, name: "Organisk", needs: "picture" },
  { no: 2, name: "Organisk uden foto", needs: "nothing" },
  { no: 3, name: "Plakat", needs: "picture" },
  { no: 4, name: "Stribe", needs: "picture" },
  { no: 5, name: "Polaroid", needs: "picture" },
  { no: 7, name: "Nat", needs: "picture" },
  { no: 8, name: "Citat", needs: "quote" },
  { no: 10, name: "Mød underviseren", needs: "portrait" },
];

export const templateName = (no: number | undefined) => VIDEO_TEMPLATES.find(t => t.no === no)?.name ?? null;

/** The templates this post can be made in: one without a picture always; the rest need the event's picture (and "Citat" the teacher's sentence,
 * "Mød underviseren" the teacher's photo). */
export function templatesFor(post: Pick<SocialPost, "images" | "source">): number[] {
  const picture = Boolean(post.images[0]);
  return VIDEO_TEMPLATES.filter(t => t.needs === "nothing" || (picture && (t.needs === "picture" || (t.needs === "quote" && Boolean(post.source.quote))
    || (t.needs === "portrait" && Boolean(post.source.portrait))))).map(t => t.no);
}
