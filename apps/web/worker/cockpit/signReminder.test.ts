import { describe, expect, it } from "vitest";
import { reminderLevel, signReminder } from "./signReminder.js";

// Requested: "Hvis et medlem ikke har godkendt referatet efter to dage ... gul ... fem dage ... rød" - "en bar med farvet baggrund - enten grå,
// orange/gul eller rød baggrund lige under headeren".
const NOW = Date.parse("2026-10-13T10:00:00Z");
const DAY = 86_400_000;
const minutes = (id: number, date: string, ageDays: number) =>
  ({ id, source: "upload", meeting_date: date, draft_markdown: "# Referat", drive_document_url: null, created_at_ms: NOW - ageDays * DAY - 60_000, updated_at_ms: NOW - ageDays * DAY - 60_000 });

describe("the reminder to approve minutes", () => {
  it("turns amber after two days and red after five, counted from when the minutes were put up or corrected", () => {
    expect([0, 1, 2, 4, 5, 9].map(reminderLevel)).toEqual(["ny", "ny", "gul", "gul", "roed", "roed"]);
    expect(signReminder("", [], NOW)).toBe("");
    expect(signReminder("/c", [minutes(3, "2026-10-06", 0)], NOW)).toBe('<div class="sign-bar ny" role="status"><div class="sign-inner"><span>Husk at godkende referatet fra mødet 6. oktober.</span><a class="button" href="/c/referat/3">Læs og godkend →</a></div></div>');
    expect(signReminder("/c", [minutes(3, "2026-10-06", 3)], NOW)).toContain('<div class="sign-bar gul" role="status"><div class="sign-inner"><span>Husk at godkende referatet fra mødet 6. oktober. Det har ventet på dig i 3 dage.</span>');
    // Corrected yesterday: everyone approves again, and the count starts over.
    expect(signReminder("/c", [{ ...minutes(3, "2026-10-06", 8), updated_at_ms: NOW - DAY }], NOW)).toContain('class="sign-bar ny"');
    // Two waiting: the oldest decides the colour and is the one to read.
    const two = signReminder("/c", [minutes(4, "2026-10-09", 1), minutes(3, "2026-10-06", 6)], NOW);
    expect(two).toContain('<div class="sign-bar roed" role="status"><div class="sign-inner"><span>2 referater venter på din godkendelse. Det ældste har ventet i 6 dage.</span><a class="button" href="/c/referat/3">');
  });
});
