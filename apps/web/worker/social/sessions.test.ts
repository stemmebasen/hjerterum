import { describe, expect, it } from "vitest";
import { listTitle, type NewsletterEvent } from "../newsletter.js";
import { pickWeekEvents, plainEventText, weekList, whenLines } from "./plan.js";

// Lisbeth (19 Nov 2026): "der er 3 tidspunkter/events i løbet af aftenen med hver 3 tider og de skal ikke forstås som enkeltstående events plus at der står
// tydeligt i event beskrivelsen at man ikke bare skal møde op men booke og betale i forvejen" - the chair: "Ja".
const at = (iso: string) => Date.parse(iso);
const ev = (key: string, title: string, starts: string): NewsletterEvent => ({ key, title, startsMs: at(starts), endsMs: null, host: null, category: null, imageUrl: null,
  link: `https://www.hjerterum.info/events/${key}`, description: "Der er tre tidspunkter, som du kan booke til.", mornings: false });

describe("an offer in the calendar once per time", () => {
  const evening = [ev("a", "Healing tilbud i Hjerterum - kl. 19.00", "2026-11-23T18:00:00Z"), ev("b", "Healing tilbud i Hjerterum - kl. 19.45", "2026-11-23T18:45:00Z"),
    ev("c", "Healing tilbud i Hjerterum - kl. 20.30", "2026-11-23T19:30:00Z"), ev("d", "Lydbad", "2026-11-24T18:00:00Z")];

  it("is one post with all its times, and the post says to book", () => {
    expect(listTitle("Healing tilbud i Hjerterum - kl. 19.45")).toBe("Healing tilbud i Hjerterum");
    const picked = pickWeekEvents(evening, new Set(), 30);
    expect(picked.map(e => e.key)).toEqual(["a", "d"]);
    expect(picked[0]!.times).toHaveLength(3);
    expect(whenLines(picked[0]!.startsMs, picked[0]!.times)).toContain("Kl. 19.00, 19.45 og 20.30");
    const text = plainEventText(picked[0]!);
    expect(text).toContain("✨ Healing tilbud i Hjerterum\n");
    expect(text).toContain("book i forvejen");
    expect(weekList(picked)).toContain("19.00, 19.45 og 20.30 · Healing tilbud i Hjerterum");
    expect(picked[1]!.times).toBeUndefined();
    expect(plainEventText(picked[1]!)).toContain("Kl. 19.00\n");
  });
});
