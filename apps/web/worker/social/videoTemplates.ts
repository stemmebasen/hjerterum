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
  // Requested (the chair, 13 Nov 2026): "Can you create something else which is much better and more fitting to the event photo?"
  { no: 11, name: "Billedets farver", needs: "picture" },
];

export const templateName = (no: number | undefined) => VIDEO_TEMPLATES.find(t => t.no === no)?.name ?? null;

/** The templates this post can be made in: one without a picture always; the rest need the event's picture (and "Citat" the teacher's sentence,
 * "Mød underviseren" the teacher's photo). */
export function templatesFor(post: Pick<SocialPost, "images" | "source">): number[] {
  const picture = Boolean(post.images[0]);
  return VIDEO_TEMPLATES.filter(t => t.needs === "nothing" || (picture && (t.needs === "picture" || (t.needs === "quote" && Boolean(post.source.quote))
    || (t.needs === "portrait" && Boolean(post.source.portrait))))).map(t => t.no);
}

export type TemplateUse = { atMs: number; title: string };

/** Asked (the chair, 5 Nov 2026): "Det kunne også være fint, hvis jeg kan se, hvornår en skabelon sidste gang er brugt, og til hvilket event". The newest
 * video made in each template, and the event it was for (a video made again in another template no longer counts for the first). */
export async function templateUses(db: import("../db.js").D1Database): Promise<Map<number, TemplateUse>> {
  // SQLite gives the other columns of the row that holds the max.
  const rows = await db.prepare(`SELECT json_extract(source, '$.videoTemplate') AS no, MAX(json_extract(source, '$.videoAtMs')) AS at, json_extract(source, '$.title') AS title
      FROM social_posts WHERE kind = 'event' AND json_extract(source, '$.video') IS NOT NULL AND json_extract(source, '$.videoAtMs') IS NOT NULL GROUP BY no`)
    .all<{ no: number | null; at: number | null; title: string | null }>().then(r => r.results ?? []).catch(() => []);
  return new Map(rows.filter(r => r.no && r.at).map(r => [Number(r.no), { atMs: Number(r.at), title: r.title ?? "et event" }]));
}

const USED_DAY = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", timeZone: "Europe/Copenhagen" });
/** "sidst 4. nov.: Lydhealing" / "ikke brugt endnu". */
export const usedLabel = (use: TemplateUse | undefined) => use ? `sidst ${USED_DAY.format(use.atMs)}: ${use.title.length > 32 ? `${use.title.slice(0, 31)}…` : use.title}` : "ikke brugt endnu";
