import { describe, expect, it } from "vitest";
import { pageText, scheduledSiteSync, siteForSaga, syncSite } from "./site.js";
import { claimJob } from "../saga/store.js";
import { deps, testDatabase } from "../saga/test-support.js";

// Requested: "Generelt må hun gerne have al data fra den nuværende hjemmeside tilgængelig".
const NOW = Date.parse("2026-10-02T10:00:00Z");
const page = (slug: string, title: string, html: string) => ({ link: `https://holistisk.org/${slug}`, title: { rendered: title }, content: { rendered: html }, modified: "2026-09-01T10:00:00" });
const PAGES = [
  page("", "", "<p>Velkommen til Hjerterum i Aarhus - et fællesskab for personlig udvikling.</p>"),
  page("tribes/", "Hjerterum Tribes", "<h2>Hvad er en tribe?</h2><p>En lille gruppe på 5-8 deltagere, der mødes jævnligt.</p><ul><li>Skriv til tribes@holistisk.org</li></ul>"),
  page("historien-bag-hjerterum/", "Historien bag Hjerterum", "<p>Hjerterum blev startet af en flok ildsjæle, der ville skabe et hjem for healing &amp; nærvær.</p>"),
  ...Array.from({ length: 9 }, (_, i) => page(`side-${i}/`, `Side ${i}`, `<p>Almindelig tekst på side nummer ${i}, som ikke handler om noget særligt.</p>`))
];

function site(pages: unknown[], status = 200): typeof fetch {
  return async input => String(input).includes("/wp-json/wp/v2/pages") ? new Response(JSON.stringify(pages), { status }) : new Response("[]");
}

describe("the website for Saga", () => {
  it("turns a page into readable lines", () => {
    expect(pageText("<h2>Fordele</h2><p>Rabat &amp; tilbud</p><ul><li>Kaffe</li><li>Kage</li></ul><script>x()</script>[vc_row]<p>/* real people should not fill this in */</p>"))
      .toBe("## Fordele\nRabat & tilbud\n- Kaffe\n- Kage");
  });

  it("reads the whole site once a day, without AI, and gives Saga the list plus the pages her question points to", async () => {
    const db = testDatabase();
    expect(await siteForSaga(db, "tribes")).toBe("(hjemmesiden er ikke hentet endnu)");
    const claim = (key: string, slot: number) => claimJob(db, key, slot, NOW);
    await scheduledSiteSync(deps(site(PAGES), NOW), db, claim);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM site_pages").first<{ n: number }>())?.n).toBe(12);

    const text = await siteForSaga(db, "Hvordan kommer man med i en tribe?");
    expect(text).toContain("ALLE 12 SIDER:");
    expect(text).toContain("- Historien bag Hjerterum: https://holistisk.org/historien-bag-hjerterum/ [kun titel]");
    expect(text).toContain("--- Hjerterum Tribes (https://holistisk.org/tribes/) ---\n## Hvad er en tribe?\nEn lille gruppe på 5-8 deltagere");
    expect(text).toContain("--- Forside (https://holistisk.org/) ---\nVelkommen til Hjerterum i Aarhus");

    // A broken or half-empty read never wipes what Saga has; a page gone from the site goes after a full read.
    await expect(syncSite(deps(site([], 500), NOW + 1), db)).rejects.toThrow();
    await expect(syncSite(deps(site(PAGES.slice(0, 3)), NOW + 1), db)).rejects.toThrow("site_too_small_3");
    expect((await db.prepare("SELECT COUNT(*) AS n FROM site_pages").first<{ n: number }>())?.n).toBe(12);
    await syncSite(deps(site(PAGES.slice(1)), NOW + 2), db);
    expect(await siteForSaga(db, "velkommen")).not.toContain("Forside");
  });
});
