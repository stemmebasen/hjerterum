import { describe, expect, it } from "vitest";
import indexHtml from "../index.html?raw";
import { LYS_CSS, LYS_FONTS_URL, lysArt } from "../lys";

// Requested: "Det bør være den samme styling og det samme design" - one source for the website, the member area and admin.

describe("Hjerterum Lys", () => {
  it("is light by default, follows dark mode and keeps still", () => {
    expect(LYS_CSS).toContain("--lys-bg:#fbfaf8");
    expect(LYS_CSS).toContain("prefers-color-scheme:dark");
    // Requested: "Fjern animationen" - the geometry stands still and pages do not fade in.
    expect(LYS_CSS).not.toMatch(/animation|@keyframes/);
    expect(lysArt()).not.toContain("arc");
  });

  it("draws the geometry as fixed markup, in the shared colours", () => {
    for (const size of ["hero", "mini"] as const) {
      const svg = lysArt(size);
      expect(svg).toMatch(/^<svg class="lys-art/);
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).not.toMatch(/<script|on\w+=/i);
      expect(svg).toContain("var(--lys-blob-1)");
    }
  });

  it("loads the same fonts on the React pages", () => {
    expect(indexHtml.replaceAll("&amp;", "&")).toContain(LYS_FONTS_URL);
  });

  it("dresses the board's cockpit in the same design", async () => {
    const { layout } = await import("./cockpit/page.js");
    const html = layout("", "Overblik", "<main><h1>Overblik</h1></main>", { section: "/", who: "Jacob Hauge" });
    expect(html).toContain(LYS_FONTS_URL.replaceAll("&", "&amp;"));
    expect(html).toContain("--lys-bg:#fbfaf8");
    expect(html).toContain("<b>Hjerterum</b>");
    expect(html).not.toMatch(/Bricolage|#2446d8|--glow/);
  });
});
