import { describe, expect, it } from "vitest";
import { askInput, askSagaMarkdown } from "./ask.js";
import { savedTexts, savedTextsCard, savedTextsForSaga, textToKeep } from "./savedTexts.js";
import { deps, fakeServices, sagaEnv, testDatabase } from "../saga/test-support.js";

// Asked: "Hvorfor kan hun ikke hjælpe?" - "Vil du gemme formandens tale fra Generalforsamlingen:" was cut at 1,500 characters and got
// "Jacob, det kan jeg desværre ikke gemme."
const NOW = Date.parse("2026-10-15T12:00:00Z");
const SPEECH = `Kære alle sammen.\n\nHjerterum har faktisk eksisteret i ti år nu.\n\n${"Når jeg tænker over det, bliver jeg både ydmyg og taknemmelig. ".repeat(60)}\n\nTak for i aften.`;
const QUESTION = `Vil du gemme formandens tale fra Generalforsamlingen:\n\n${SPEECH}`;

describe("Saga keeps a text when asked", () => {
  it("takes the whole speech, keeps it from where it starts, and reads it back later", async () => {
    expect(QUESTION.length).toBeGreaterThan(3000);
    expect(askInput({ question: QUESTION, history: [] })?.question).toBe(QUESTION);
    expect(textToKeep(QUESTION, "Kære alle sammen")).toBe(SPEECH);
    expect(textToKeep(QUESTION, "findes ikke")).toBe(QUESTION);
    const db = testDatabase();
    let system = "";
    const services = fakeServices({ ai: s => { system = s; return "Den er gemt 💛\n[[GEM titel=Formandens tale ved generalforsamlingen 2026 fra=Kære alle sammen]]"; } });
    const out = await askSagaMarkdown(sagaEnv(db), deps(services.fetcher, NOW), db, "Jacob Hauge", { question: QUESTION, history: [] });
    expect(out).toMatch(/^Den er gemt 💛\n\n✓ Gemt: "Formandens tale ved generalforsamlingen 2026" \([\d.]+ tegn\) - \[læs den i admin\]\(\/tekster\/1\)$/);
    const [kept] = await savedTexts(db);
    expect(kept).toMatchObject({ title: "Formandens tale ved generalforsamlingen 2026", body: SPEECH, saved_by: "Jacob Hauge" });
    expect(savedTextsForSaga([kept!], "Hvad sagde jeg i talen?")).toContain(`--- "Formandens tale ved generalforsamlingen 2026" (fuld tekst) ---\n${SPEECH}`);
    expect(savedTextsCard("", [kept!])).toContain('<a href="/tekster/1"><strong>Formandens tale ved generalforsamlingen 2026</strong></a>');
    // The next question has it in what she knows.
    await askSagaMarkdown(sagaEnv(db), deps(services.fetcher, NOW + 60_000), db, "Jacob Hauge", { question: "Hvad stod der i min tale?", history: [] });
    expect(system).toContain("GEMTE TEKSTER");
    expect(system).toContain("Tak for i aften.");
  });
});
