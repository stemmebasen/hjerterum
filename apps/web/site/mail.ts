/** Douglas (6 Nov 2026): "Do you have Hjerterum's email addresses on the new website encrypted somehow, so you don't get hundreds of spam
 * mails?" - the chair: "Ja". The address is not written anywhere in the website's code or pages: it is put together in the browser, so the
 * robots that comb pages and scripts for addresses do not find it. People see and click it as before. In the pages' text it is [[mail]]. */
export const TEAM_MAIL = atob("dGVhbUBoamVydGVydW0uaW5mbw==");
export const MAIL_TOKEN = "[[mail]]";
/** The token as a Markdown link (site/markdown.ts) or as plain words (Saga reads the pages, site-knowledge.ts). */
export const withMail = (text: string, asLink = true) => text.split(MAIL_TOKEN).join(asLink ? `[${TEAM_MAIL}](mailto:${TEAM_MAIL})` : TEAM_MAIL);
