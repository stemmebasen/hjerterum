import { SITE_PAGES, type SitePage } from "../site/pages.js";

/** Asked: "tjek også om der er andre områder hun skal have opdateret sin viden". hjerterum.info is the site now - holistisk.org is the
 * old one. Every Saga (website, member area, admin) reads the current site from the same pages the site itself shows (site/pages.ts),
 * so what she says follows the site the day it is deployed. */

export const CURRENT_SITE = "https://www.hjerterum.info";

/** One Danish page as Saga reads it: title, address, lead and text, without image and block markers. */
export function sitePageText(page: SitePage): string {
  const body = page.body.replace(/^\{\{[^}]+\}\}\s*$/gm, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return `### ${[page.title, page.em].filter(Boolean).join(" ")} (${CURRENT_SITE}${page.path})\n${page.lead ?? ""}\n${body}`;
}

export const danishPages = (): SitePage[] => SITE_PAGES.filter((page) => page.lang === "da");

export const sitePage = (path: string): SitePage | undefined => danishPages().find((page) => page.path === path);

const words = (text: string) => [...new Set(text.toLocaleLowerCase("da-DK").match(/[a-zæøå0-9]{4,}/g) ?? [])]
  // Danish endings vary ("medlemskabet", "lejepriserne"): match on the word's stem.
  .map((w) => w.slice(0, Math.max(4, w.length - 3)));

/** For the board's Saga: every page of hjerterum.info by title and address, and in full the ones the question's words find (titles
 * weigh most) as long as they fit - the whole site is too long to send every time. */
export function currentSiteForSaga(question: string, budget = 24_000): string {
  const pages = danishPages();
  const asked = words(question);
  const score = (page: SitePage) => {
    const title = `${page.title} ${page.em ?? ""} ${page.path}`.toLocaleLowerCase("da-DK"), body = page.body.toLocaleLowerCase("da-DK");
    return asked.reduce((sum, w) => sum + (title.includes(w) ? 5 : 0) + Math.min(5, body.split(w).length - 1), 0);
  };
  const ranked = pages.map((page) => ({ page, s: score(page) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.page);
  const chosen: SitePage[] = [];
  let used = 0;
  for (const page of [sitePage("/om-hjerterum"), ...ranked].filter((p): p is SitePage => !!p)) {
    const length = sitePageText(page).length;
    if (chosen.includes(page) || used + length > budget) continue;
    chosen.push(page);
    used += length;
  }
  const index = pages.map((page) => `- ${[page.title, page.em].filter(Boolean).join(" ")}: ${CURRENT_SITE}${page.path}${chosen.includes(page) ? "" : " [kun titel]"}`);
  return `ALLE ${pages.length} SIDER:\n${index.join("\n")}\n\n${chosen.map(sitePageText).join("\n\n")}`;
}
