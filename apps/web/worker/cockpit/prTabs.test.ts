import { describe, expect, it } from "vitest";
import { prPage, PR_TABS } from "./prPage.js";

// Requested (the chair, 3 Nov 2026): "Jeg synes, at siden bliver ret rodet, når der er så meget indhold. Kan du ikke dele det op i underpunkter?"
describe("PR og SoMe in tabs", () => {
  const data = { ready: true, account: null, shares: [], weeks: [{ monday: "2026-11-09", key: "2026-W46", label: "Næste uge (uge 46)" }], week: { monday: "2026-11-09", key: "2026-W46", posts: [] },
    recent: [], aiReady: true, plan: { todo: [], next: [], campaign: { now: null, next: { months: [1], title: "Nyt år", about: "x" } } }, insight: [], calendar: { mondays: ["2026-11-09"], posts: [], nowMs: 0 }, nowMs: 0, notice: "", error: "" };
  it("shows one part at a time, with the tabs on every one", () => {
    const parts = { overblik: ["Det kræver dig lige nu", "Forbindelse"], kalender: ["Kalender", "Uge 46"], events: ["Ingen events de næste seks uger"], tagget: ["Tagget i"], uge: ["Ugens opslag", 'href="/pr/uge?uge=2026-11-09"'], sendt: ["Publiceret og fejlet", "Indsigt"] } as const;
    for (const [tab] of PR_TABS) {
      const html = prPage("", "Jacob Hauge", data, tab);
      for (const [, path, label] of PR_TABS) { expect(html).toContain(`href="${path}"`); expect(html).toContain(label); }
      for (const text of parts[tab]) expect(html, `${tab}: ${text}`).toContain(text);
      for (const [other, texts] of Object.entries(parts)) if (other !== tab && other !== "events") expect(html).not.toContain(`<h2>${texts[0]}`);
      expect(html).toContain(`class="on" aria-current="page"`);
    }
  });
});
