import { describe, expect, it } from "vitest";
import { insertMail } from "../saga/store.js";
import { testDatabase } from "../saga/test-support.js";
import { minutesForQuestion, teamMail } from "./ask.js";
import type { ApprovedMinutes } from "./data.js";

// Requested: "Saga skal også have adgang til team@holistisk.org og skal kunne gennemse alle referater".
const DAY = 86_400_000, NOW = Date.UTC(2026, 9, 2, 10);
const minutes = (day: string, text: string, id = Number(day.replace(/-/g, ""))): ApprovedMinutes =>
  ({ id, source: "telegram", meeting_date: day, draft_markdown: text, drive_document_url: null, created_at_ms: 1, updated_at_ms: 1 });

describe("Saga's reach", () => {
  it("lists every approved minutes and reads the ones the question points to in full", () => {
    const all = [...Array.from({ length: 12 }, (_, i) => minutes(`2026-${String(10 - Math.floor(i / 2)).padStart(2, "0")}-${i % 2 ? "01" : "15"}`, `# Referat\n## Økonomi\n- Punkt ${i}`)),
      minutes("2025-03-04", "# Referat\n## Lejekontrakt\n- Udlejeren hæver huslejen"), minutes("2024-11-20", "# Referat\n## Generalforsamling\n- Dirigent valgt")];
    // All of them, when they fit; with less room, the newest and the ones the question points to.
    expect(minutesForQuestion(all, "Hvad blev der sagt om huslejen?")).toContain("Dirigent valgt");
    const budget = 9 * 30 + 50;
    const text = minutesForQuestion(all, "Hvad blev der sagt om huslejen?", budget);
    expect(text).toContain("ALLE 14 GODKENDTE REFERATER");
    expect(text).toContain("Udlejeren hæver huslejen");
    expect(text).not.toContain("Dirigent valgt");
    expect(text).toContain("2024-11-20 [kun overskrifter - spørg efter datoen]: Generalforsamling");
    expect(minutesForQuestion(all, "Hvad står der i referatet fra 20. november 2024?", budget)).toContain("Dirigent valgt");
    expect(minutesForQuestion(all, "Referatet fra 2024-11-20?", budget)).toContain("Dirigent valgt");
    expect(text.indexOf("NYESTE REFERAT (gældende) 2026-10-15")).toBeGreaterThan(0);
  });

  it("reads team@: the last 30 days in short and older mails the question finds", async () => {
    const db = testDatabase();
    await insertMail(db, { ref: "a", sender: "Maria <maria@example.com>", subject: "Leje af salen", receivedAtMs: NOW - DAY, preview: "Hej, kan jeg leje salen til yoga?", nowMs: NOW });
    await insertMail(db, { ref: "b", sender: "Udlejer <udlejer@example.com>", subject: "Varsling af huslejestigning", receivedAtMs: NOW - 200 * DAY, preview: "Huslejen stiger med 4 procent fra 1. januar.", nowMs: NOW });
    // The same mail again under another reference (the year before the connection is relayed too) is kept once.
    expect(await insertMail(db, { ref: "a2", sender: "Maria <maria@example.com>", subject: "Leje af salen", receivedAtMs: NOW - DAY, preview: "Hej", nowMs: NOW })).toBeNull();
    const plain = await teamMail(db, NOW, "Hvad skriver folk til os?");
    expect(plain).toContain("Leje af salen");
    expect(plain).not.toContain("Varsling af huslejestigning");
    const found = await teamMail(db, NOW, "Hvad har udlejeren skrevet om huslejen?");
    expect(found).toContain("Huslejen stiger med 4 procent");
  });

  it("knows the room prices and rules from the price calculator", async () => {
    const { boardKnowledge } = await import("./ask.js");
    const { sagaEnv, fakeServices, testDatabase: fresh } = await import("../saga/test-support.js");
    const db = fresh();
    const services = fakeServices();
    const text = await boardKnowledge(sagaEnv(db), { fetcher: services.fetcher, now: () => NOW } as never, db, "Hvad koster det at leje salen en lørdag?");
    expect(text).toContain("LEJE AF SALEN - PRISER OG REGLER");
    expect(text).toContain("https://prisberegner.replit.app/beregner");
  });
});
