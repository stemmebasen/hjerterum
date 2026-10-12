import { describe, expect, it } from "vitest";
import { program, writeProgramIntro } from "./program.js";
import type { ExternalEvent } from "./external-events.js";
import { deps, fakeServices, sagaEnv, testDatabase } from "./saga/test-support.js";

// Requested: a TV-guide programme of the next five events with photos, and a short warm intro to the next two by Saga.
const NOW = Date.parse("2026-10-11T07:00:00Z");
const ev = (id: string, startsAt: string, title: string): ExternalEvent =>
  ({ id, source: "membershipworks", title, startsAt, endsAt: null, location: null, imageUrl: `https://img/${id}.jpg`, link: `https://mw/${id}`, host: "Jørgen Arvid", description: "En rolig rejse ind i åndedrættet.", category: null });

describe("the overview's programme", () => {
  it("takes the next five, in time order", async () => {
    const db = testDatabase();
    const p = await program(db, [ev("6", "2026-10-16T08:00:00Z", "F"), ev("1", "2026-10-11T09:30:00Z", "A"), ev("0", "2026-10-01T09:30:00Z", "Gammel"),
      ev("2", "2026-10-11T11:30:00Z", "B"), ev("3", "2026-10-12T08:30:00Z", "C"), ev("4", "2026-10-13T08:30:00Z", "D"), ev("5", "2026-10-14T08:30:00Z", "E")], NOW);
    expect(p.items.map(i => i.title)).toEqual(["A", "B", "C", "D", "E"]);
    expect(p.intro).toBeNull();
  });

  it("has Saga write about the next three events under 'Snart i Hjerterum', and again when one begins", async () => {
    const db = testDatabase();
    const asked: string[] = [];
    const services = fakeServices({ ai: (_sys, user) => { asked.push(user); return "Kl. 11.30 guider Jørgen os gennem Breathwork. I morgen kl. 11.30 er der Yoga. Tirsdag kl. 18.30 synger vi Sang."; } });
    const env = sagaEnv(db);
    // NOW is Sunday 11 October 09.00.
    const external = [ev("1", "2026-10-11T09:30:00Z", "Breathwork"), ev("2", "2026-10-12T09:30:00Z", "Yoga"), ev("4", "2026-10-13T16:30:00Z", "Sang"), ev("3", "2026-10-14T09:30:00Z", "Healing")];
    expect(await writeProgramIntro(env, deps(services.fetcher, NOW), db, external, async () => true)).toBe(true);
    expect(await writeProgramIntro(env, deps(services.fetcher, NOW), db, external, async () => true)).toBe(false);
    expect(asked).toHaveLength(1);
    for (const title of ["Breathwork", "Yoga", "Sang"]) expect(asked[0]).toContain(title);
    expect(asked[0]).not.toContain("Healing");
    expect(await program(db, external, NOW + 600_000)).toMatchObject({ heading: "Snart i Hjerterum", intro: expect.stringContaining("Sang") });
    // When Breathwork begins, the three are Yoga, Sang and Healing - and Saga writes again.
    const begun = Date.parse("2026-10-11T09:31:00Z");
    expect((await program(db, external, begun)).intro).toBeNull();
    expect(await writeProgramIntro(env, deps(services.fetcher, begun), db, external, async () => true)).toBe(true);
    expect(asked[1]).toContain("Healing");
    expect(asked[1]).not.toContain("Breathwork");
  });

  it("writes again when one of the three is left out", async () => {
    const db = testDatabase();
    const answers = ["I morgen kl. 9.30 guider Jørgen os gennem Breathwork.", "I morgen kl. 9.30 guider Jørgen os gennem Breathwork. Kl. 13.30 synger Henriette. Kl. 19.30 er der Healing."];
    const services = fakeServices({ ai: () => answers.shift() ?? "" });
    const external = [ev("1", "2026-10-12T07:30:00Z", "Breathwork"), ev("2", "2026-10-12T11:30:00Z", "Sang"), ev("3", "2026-10-12T17:30:00Z", "Healing")];
    expect(await writeProgramIntro(sagaEnv(db), deps(services.fetcher, NOW), db, external, async () => true)).toBe(true);
    expect((await program(db, external, NOW)).intro).toContain("Kl. 19.30 er der Healing.");
  });

  // Requested: "aldrig skrive 'tirsdag d. 13. oktober', men 'I morgen'" - the day as a word, and new words after midnight.
  it("tells Saga the day as 'i dag', 'i morgen' or a weekday, and writes again on a new day", async () => {
    const db = testDatabase();
    const asked: string[] = [];
    const services = fakeServices({ ai: (_sys, user) => { asked.push(user); return "I morgen byder på tre ting: Kl. 11.30 A. Kl. 13.30 B. Kl. 15.30 C."; } });
    const external = [ev("1", "2026-10-12T09:30:00Z", "A"), ev("2", "2026-10-12T11:30:00Z", "B"), ev("3", "2026-10-12T13:30:00Z", "C")];
    expect(await writeProgramIntro(sagaEnv(db), deps(services.fetcher, NOW), db, external, async () => true)).toBe(true);
    expect(asked[0]).toContain('"dag":"i morgen"');
    expect(asked[0]).not.toContain("oktober");
    // Monday, after midnight: the same three, but "i morgen" is now "i dag" - new words.
    const monday = Date.parse("2026-10-11T22:30:00Z");
    expect((await program(db, external, monday)).intro).toBeNull();
    expect(await writeProgramIntro(sagaEnv(db), deps(services.fetcher, monday), db, external, async () => true)).toBe(true);
    expect(asked[1]).toContain('"dag":"i dag"');
  });
});
