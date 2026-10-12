import { describe, expect, it } from "vitest";
import { homePage } from "./home.js";

// Requested: "\"Referatet godkendes med bemærkning om fejl i tidligere referat.\" er ikke vigtigt nok til at stå på forsiden.
// Overskriften bør være sådan: Vigtigste punkter fra sidste møde / Torsdag den 1. oktober 2026 (Husk at godkende referatet)".
const page = (unsigned: boolean) => homePage("", { who: "Jacob", isChair: true, today: "2026-10-02", toSign: unsigned ? [{ id: 7 }] : [], tasks: [], todos: [], forMe: [], next: null, found: [],
  picture: null, summary: null, at: null, events: [], eventsMonth: 0, progress: { working: 0, waiting: 0 }, boardNow: null,
  latest: { id: 7, date: "2026-10-01", approved: 0, members: 5, decisions: ["Referatet godkendes med bemærkning om fejl i tidligere referat.", "Dagsordenen godkendt",
    "Lisbeth er dirigent for generalforsamlingen, medmindre en anden melder sig.", "Der anbefales op til fire suppleanter på generalforsamlingen."] } } as never);

describe("the latest meeting on the front page", () => {
  it("shows the important points, not the formalities, under the meeting's date, and reminds to approve", () => {
    const html = page(true);
    expect(html).toContain("<h2>Vigtigste punkter fra sidste møde</h2>");
    expect(html).toContain("Torsdag den 1. oktober 2026");
    expect(html).toContain('<a href="/referat/7">Husk at godkende referatet</a>');
    // Requested: "Jeg mangler bullet points, hjerter eller andet til hver linje".
    expect(html).toContain('<ul class="items hearts">');
    expect(html).toContain("Lisbeth er dirigent for generalforsamlingen");
    expect(html).toContain("Der anbefales op til fire suppleanter");
    expect(html).not.toContain("Referatet godkendes med bemærkning");
    expect(html).not.toContain("Dagsordenen godkendt");
    expect(page(false)).not.toContain("Husk at godkende referatet");
  });
});

// Requested: "Til mig bør ordlyden ikke være: Ser på automatisk opsætning af nyhedsbrev ... Sender preview-link ... Men: Se på ...
// Send preview-link" - and "Hvor er det jeg stiller forslag?".
describe("tasks as instructions", () => {
  it("shows a task's leading verb in the imperative, leaves nouns alone, and links to the proposals", async () => {
    const { imperative } = await import("./data.js");
    expect(imperative("ser på automatisk opsætning af nyhedsbrev i nyt system")).toBe("se på automatisk opsætning af nyhedsbrev i nyt system");
    expect(imperative("Sender preview-link til nyt system til Douglas")).toBe("Send preview-link til nyt system til Douglas");
    expect(imperative("Tjekker nøgler")).toBe("Tjek nøgler");
    expect(imperative("Billeder til GF")).toBe("Billeder til GF");
    expect(imperative("Send mail")).toBe("Send mail");
    const html = homePage("", { who: "Jacob", isChair: false, today: "2026-10-02", toSign: [], todos: [], forMe: [], next: null, found: [], picture: null, summary: null, at: null,
      events: [], eventsMonth: 0, progress: { working: 0, waiting: 0 }, latest: null, boardNow: null,
      tasks: [{ who: "Jacob", what: "ser på automatisk opsætning af nyhedsbrev i nyt system", due: "", meeting: "2026-10-01", source: "referat" },
        { who: "Jacob", what: "sender preview-link til nyt system til Douglas", due: "", meeting: "2026-10-01", source: "referat" }] } as never);
    expect(html).toContain("Se på automatisk opsætning af nyhedsbrev i nyt system");
    expect(html).toContain("Send preview-link til nyt system til Douglas");
    expect(html).toContain('href="/opslag?art=afstemning#nyt">Stil et forslag til afstemning →');
  });
});

// Reported (iPhone, Chrome): "Fejl på mobil" - the page was wider than the screen, because the glow behind the top
// reached 200 px past the right edge. Nothing in the page's own style may reach past the edge.
describe("the page on a phone", () => {
  it("has no decoration that reaches past the screen's right edge", () => {
    const html = page(false);
    expect(html).not.toMatch(/right:-\d/);
    expect(html).not.toMatch(/width:min\(\d+px,1\d\dvw\)/);
  });
});
