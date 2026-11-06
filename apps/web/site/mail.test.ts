import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";
import { SITE_PAGES } from "./pages";
import { TEAM_MAIL } from "./mail";
import { sitePageText } from "../worker/site-knowledge";

// Douglas (6 Nov 2026): "Do you have Hjerterum's email addresses on the new website encrypted somehow, so you don't get hundreds of spam mails?"
describe("Hjerterum's address on the website", () => {
  it("is not written in the pages, and is shown and linked as before", () => {
    expect(TEAM_MAIL).toBe(["team", "hjerterum.info"].join("@"));
    for (const page of SITE_PAGES) expect(page.body).not.toContain("@hjerterum.info");
    expect(renderMarkdown("Skriv til [[mail]].")).toBe(`<p>Skriv til <a href="mailto:${TEAM_MAIL}">${TEAM_MAIL}</a>.</p>`);
    // Saga reads the pages with the address in plain words.
    const contact = SITE_PAGES.find(page => page.lang === "da" && page.body.includes("[[mail]]"))!;
    expect(sitePageText(contact)).toContain(TEAM_MAIL);
    expect(sitePageText(contact)).not.toContain("[[mail]]");
  });
});
