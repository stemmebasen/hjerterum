import { describe, expect, it } from "vitest";
import indexHtml from "../index.html?raw";
import { LYS_CSS, LYS_FONTS_URL, lysArt } from "../lys";

// Requested: "Det bør være den samme styling og det samme design" - one source for the website, the member area and admin.

describe("Hjerterum Lys", () => {
  it("is light by default, follows dark mode and keeps still for those who ask", () => {
    expect(LYS_CSS).toContain("--lys-bg:#fbfaf8");
    expect(LYS_CSS).toContain("prefers-color-scheme:dark");
    expect(LYS_CSS).toMatch(/prefers-reduced-motion:reduce\)\{[^}]*animation:none/);
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
});
