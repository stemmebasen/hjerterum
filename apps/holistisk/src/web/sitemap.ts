import { ACTIVITIES } from "../activities.js";
import type { D1Database } from "../db.js";
import { activeAreas } from "../geo.js";
import { ORGANIZERS, organizersFor } from "../organizers.js";
import { activityFilters } from "./pages.js";
import { areaCounts, countByArea } from "./queries.js";

/** The landing pages worth a search engine's time: every activity and city, and every activity in a city, that has
 * upcoming events or an organiser offering it. Empty combinations stay out (and are noindex on the page itself). */
export async function sitemapPages(db: D1Database, regions: string[], now: number): Promise<string[]> {
  const areas = activeAreas(regions);
  const inRegions = ORGANIZERS.filter(o => areas.some(a => a.slug === o.area));
  const byArea = await areaCounts(db, regions, now);
  const perActivity = await Promise.all(ACTIVITIES.map(a => countByArea(db, activityFilters(a), regions, now)));
  const pages = ["/", "/kalender", "/i-dag", "/weekend", "/kort", "/kategorier", "/arrangoerer", "/om", ...inRegions.map(o => `/arrangoerer/${o.slug}`)];
  for (const area of areas) if ((byArea.get(area.slug) ?? 0) > 0 || inRegions.some(o => o.area === area.slug)) pages.push(`/${area.slug}`);
  ACTIVITIES.forEach((activity, i) => {
    const counts = perActivity[i]!;
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    if (total > 0 || organizersFor(activity.slug, null).some(o => inRegions.includes(o))) pages.push(`/${activity.slug}`);
    for (const area of areas) if ((counts.get(area.slug) ?? 0) > 0 || organizersFor(activity.slug, area.slug).length) pages.push(`/${activity.slug}/${area.slug}`);
  });
  return pages;
}
