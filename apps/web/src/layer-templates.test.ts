import { describe, expect, it } from "vitest";
import { C } from "./event-poster";
import { LAYER_DESIGNS, layerDesign, roomBelow, type Layer } from "./layer-templates";

// Asked (the chair, 7 Nov 2026): "Altså et lille mini Photoshop ... Jeg synes heller ikke, at de designforslag, der er, er fyldestgørende. Det kommer til at ligne det samme, det hele."
const words = { title: "Lydbad med gongs", rest: null, teacher: "Kasper Holm", kicker: "Lyd", day: "Lørdag 21. november", time: "18.30–20.00", number: "21", month: "november" };

describe("the designs made of layers", () => {
  it("each has its picture, its title, its date and the logo, inside the page, in every format", () => {
    expect(LAYER_DESIGNS.length).toBeGreaterThanOrEqual(10);
    for (const [W, H] of [[1080, 1350], [1080, 1920], [1920, 1005]] as const) for (const m of LAYER_DESIGNS) {
      const d = layerDesign(m.key, { W, H, words, colors: C, site: "hjerterum.info", quote: null })!;
      const kinds = d.layers.map(l => l.kind);
      expect(kinds, `${m.key} ${W}x${H}`).toContain("photo");
      const texts = d.layers.filter(l => l.kind === "text").map(l => (l as { text: string }).text).join(" ");
      expect(texts, m.key).toContain("Lydbad med gongs");
      expect(texts, m.key).toMatch(/18\.30|21/);
      if (m.key !== "minimal") expect(kinds, m.key).toContain("logo");
      for (const l of d.layers) if (l.kind === "text" || l.kind === "logo") {
        expect(l.x, `${m.key} ${W}x${H}`).toBeGreaterThanOrEqual(0);
        expect(l.y, `${m.key} ${W}x${H}`).toBeLessThan(H);
        expect(l.x + ("w" in l ? l.w : l.size), `${m.key} ${W}x${H}`).toBeLessThanOrEqual(W + 1);
      }
    }
  });
  it("are different compositions, not one layout in other colours", () => {
    const shapes = new Set(LAYER_DESIGNS.map(m => {
      const d = layerDesign(m.key, { W: 1080, H: 1350, words, colors: C, site: "x", quote: null })!;
      const photo = d.layers.find(l => l.kind === "photo") as { x: number; y: number; w: number; frame?: string };
      return `${Math.round(photo.x / 50)}-${Math.round(photo.y / 50)}-${Math.round(photo.w / 50)}-${photo.frame ?? "rect"}-${d.background}`;
    }));
    expect(shapes.size).toBe(LAYER_DESIGNS.length);
  });

  // Reported (the chair, 8 Nov 2026): "Der er så mange layout fejl" - a long title ran into the teacher's name below it.
  it("gives every title room that ends above the words under it", () => {
    for (const m of LAYER_DESIGNS) {
      const d = layerDesign(m.key, { W: 1080, H: 1350, words, colors: C as never, site: "holistisk.org", quote: null })!;
      const title = d.layers.find((l): l is Extract<Layer, { kind: "text" }> => l.kind === "text" && l.role === "title" && !l.angle)!;
      const sub = d.layers.find((l): l is Extract<Layer, { kind: "text" }> => l.kind === "text" && l.role === "sub" && l.y > title.y && l.x < title.x + title.w && l.x + l.w > title.x);
      if (sub) expect(roomBelow(d.layers, title)).toBeLessThanOrEqual(sub.y);
    }
  });
});
