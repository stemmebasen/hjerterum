import { describe, expect, it } from "vitest";
import { archiveSiteMedia, pageText, scheduledSiteSync, siteForSaga, syncSite } from "./site.js";
import { claimJob } from "../saga/store.js";
import { deps, sagaEnv, testDatabase } from "../saga/test-support.js";

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
    const claim = (key: string, slot: number) => claimJob(db, key, slot, NOW);
    await scheduledSiteSync(deps(site(PAGES), NOW), db, claim);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM site_pages").first<{ n: number }>())?.n).toBe(12);

    const text = await siteForSaga(db, "Hvordan kommer man med i en tribe?");
    expect(text).toContain("- Historien bag Hjerterum: https://holistisk.org/historien-bag-hjerterum/ [kun titel]");
    expect(text).toContain("--- Hjerterum Tribes (https://holistisk.org/tribes/) ---\n## Hvad er en tribe?\nEn lille gruppe på 5-8 deltagere");
    expect(text).toContain("--- Forside (https://holistisk.org/) ---\nVelkommen til Hjerterum i Aarhus");
  });

  // Requested: "Jo men holistisk.org indhold bliver ikke ved med at være tilgængelig så det skal lagres".
  it("keeps the site for good: the archive answers before any read, nothing is deleted, and changes keep the earlier text", async () => {
    const db = testDatabase();
    // Before anything is read - and after the site is gone - Saga has the archive, PDFs included.
    const before = await siteForSaga(db, "Hvad stod der i resultatopgørelsen for 2024?");
    expect(before).toContain("Hjemmesiden er gemt permanent (arkiv fra 2. okt. 2026)");
    expect(before).toContain("https://holistisk.org/lejepriser/");
    expect(before).toContain("DOKUMENTER FRA HJEMMESIDEN (PDF");
    expect(before).toMatch(/--- Resultatopgørelse 2024 \(2025-10-05, del 1\) ---\n\S/);
    expect(before).toContain("Forretningsorden 2025:6 (https://holistisk.org/wp-content/uploads/2025/05/Forretningsorden-20256-.pdf) [scannet - ingen tekst]");

    // A broken or half-empty read changes nothing.
    await syncSite(deps(site(PAGES), NOW), db);
    await expect(syncSite(deps(site([], 500), NOW + 1), db)).rejects.toThrow();
    await expect(syncSite(deps(site(PAGES.slice(0, 3)), NOW + 1), db)).rejects.toThrow("site_too_small_3");
    expect((await db.prepare("SELECT COUNT(*) AS n FROM site_pages WHERE removed_at_ms IS NULL").first<{ n: number }>())?.n).toBe(12);

    // A page gone from the site stays, marked; a changed page keeps its earlier text.
    const changed = PAGES.slice(1).map(p => p.link.endsWith("/tribes/") ? { ...p, content: { rendered: "<p>Tribes er sat på pause indtil videre, men kom gerne og spørg.</p>" } } : p);
    await syncSite(deps(site(changed), NOW + 2), db);
    expect(await db.prepare("SELECT removed_at_ms FROM site_pages WHERE url = 'https://holistisk.org/'").first()).toEqual({ removed_at_ms: NOW + 2 });
    expect(await db.prepare("SELECT text FROM site_page_versions WHERE url = 'https://holistisk.org/tribes/'").first<{ text: string }>())
      .toEqual({ text: expect.stringContaining("En lille gruppe på 5-8 deltagere") });
    const after = await siteForSaga(db, "velkommen");
    expect(after).toContain("--- Forside (https://holistisk.org/) [ikke længere på hjemmesiden - gemt fra 2. okt. 2026] ---\nVelkommen til Hjerterum");
  });

  it("copies the site's media files to R2 a few at a time, and gives up on one that cannot be had after three tries", async () => {
    const db = testDatabase();
    const stored = new Map<string, { size: number; type: string | undefined }>();
    const bucket = { put: async (key: string, value: ArrayBuffer | ReadableStream, options?: { httpMetadata?: { contentType?: string } }) => {
      stored.set(key, { size: (value as ArrayBuffer).byteLength, type: options?.httpMetadata?.contentType }); return {}; }, get: async () => null };
    let calls = 0;
    const fetcher: typeof fetch = async input => { calls++; return String(input).endsWith(".pdf") ? new Response("missing", { status: 404 }) : new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }); };
    const env = sagaEnv(db, { BOARD_RECORDINGS: bucket });
    expect(await archiveSiteMedia(env, deps(fetcher, NOW), db)).toBeLessThanOrEqual(8);
    expect(calls).toBe(8);
    const [key, file] = [...stored.entries()][0]!;
    expect(key).toMatch(/^holistisk-org\/\d{4}\/\d{2}\/[^/]+$/);
    expect(file).toEqual({ size: 3, type: "image/jpeg" });
    for (let i = 0; i < 400; i++) if (!(await archiveSiteMedia(env, deps(fetcher, NOW + i), db)) && calls > 2000) break;
    const left = await db.prepare("SELECT COUNT(*) AS n FROM site_media WHERE stored_at_ms IS NULL AND tries < 3").first<{ n: number }>();
    expect(left?.n).toBe(0);
    expect((await db.prepare("SELECT MAX(tries) AS t FROM site_media WHERE stored_at_ms IS NULL").first<{ t: number }>())?.t).toBe(3);
    expect(await archiveSiteMedia(sagaEnv(db), deps(fetcher, NOW), db)).toBe(0);
  });
});
