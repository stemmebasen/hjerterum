import { describe, expect, it } from "vitest";
import indexHtml from "../index.html?raw";
import { LYS_CSS, LYS_FONTS_URL, lysArt } from "../lys";

// Requested: "Det bør være den samme styling og det samme design" - one source for the website, the member area and admin.

describe("Hjerterum Lys", () => {
  it("is light by default, follows dark mode and keeps still", () => {
    expect(LYS_CSS).toContain("--lys-bg:#f7f3ee");
    expect(LYS_CSS).toContain("prefers-color-scheme:dark");
    // Requested: "Fjern animationen" - the geometry stands still and pages do not fade in.
    expect(LYS_CSS).not.toMatch(/animation|@keyframes/);
    expect(lysArt()).not.toContain("arc");
  });

  it("keeps the sand and cream palette readable: text meets 4.5:1 in light and dark", () => {
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    };
    const [light, dark] = LYS_CSS.split("@media (prefers-color-scheme:dark)");
    const token = (css: string, name: string) => css.match(new RegExp(`--lys-${name}:(#[0-9a-f]{6})`))![1]!;
    for (const [mode, css] of [["light", light!], ["dark", dark!]] as const) {
      const pairs: Array<[string, string]> = [["ink", "bg"], ["muted", "bg"], ["terra", "bg"], ["ink", "surface"], ["muted", "surface"], ["accent-ink", "accent"], ["clay-ink", "clay"], ["sage-ink", "sage"]];
      for (const [fg, bg] of pairs) expect(contrast(token(css, fg), token(css, bg)), `${mode}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
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
    expect(html).toContain("--lys-bg:#f7f3ee");
    expect(html).toContain("<b>Hjerterum</b>");
    expect(html).not.toMatch(/Bricolage|#2446d8|--glow/);
  });
});
