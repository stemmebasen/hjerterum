import { describe, expect, it } from "vitest";
import { testDatabase } from "../saga/test-support.js";
import { cirklerKnowledge, cirklerText } from "./cirkler.js";

// Requested: "hun skal vide alt om cirkler fra cirklers hjemmeside" - and not the old summary.
describe("Saga's CIRKLER knowledge comes from cirkler.net", () => {
  it("uses the pages read from cirkler.net, with Hjerterum's own side, when the conversation is about CIRKLER", async () => {
    const db = testDatabase();
    await db.prepare("INSERT INTO cirkler_site (path, title, text, fetched_at_ms) VALUES ('/praktisk-info', 'Praktisk info', 'Nye cirkler starter som udgangspunkt i januar, april og oktober.', ?)").bind(Date.parse("2026-11-01T03:20:00Z")).run();
    const text = await cirklerKnowledge(db, [{ text: "Kan du fortælle mere om cirkler" }]);
    expect(text).toContain("januar, april og oktober");
    expect(text).toContain("https://cirkler.net/praktisk-info");
    expect(text).toContain("læst 1. november 2026");
    expect(text).toContain("selvstændigt koncept, som Jacob Hauge driver og ejer");
    expect(text).not.toMatch(/F\.M\.B\.A\.|under oprettelse/);
    expect(await cirklerKnowledge(db, [{ text: "Hvad koster et medlemskab?" }])).toBe("");
  });
  it("says to look on cirkler.net before the site has been read", () => {
    expect(cirklerText([])).toContain("henvis til https://cirkler.net");
  });
});
