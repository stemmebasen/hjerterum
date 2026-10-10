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

  it("has Saga write about tomorrow, once a day, under 'I morgen i Hjerterum'", async () => {
    const db = testDatabase();
    const asked: string[] = [];
    const services = fakeServices({ ai: (_sys, user) => { asked.push(user); return "Om formiddagen guider Jørgen os gennem breathwork."; } });
    const env = sagaEnv(db);
    // NOW is Sunday 11 October 09.00; Breathwork is today, Yoga and Sang tomorrow, Healing the day after.
    const external = [ev("1", "2026-10-11T09:30:00Z", "Breathwork"), ev("2", "2026-10-12T09:30:00Z", "Yoga"), ev("4", "2026-10-12T16:30:00Z", "Sang"), ev("3", "2026-10-13T09:30:00Z", "Healing")];
    expect(await writeProgramIntro(env, deps(services.fetcher, NOW), db, external, async () => true)).toBe(true);
    expect(await writeProgramIntro(env, deps(services.fetcher, NOW), db, external, async () => true)).toBe(false);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("Yoga");
    expect(asked[0]).toContain("Sang");
    expect(asked[0]).not.toContain("Breathwork");
    expect(asked[0]).not.toContain("Healing");
    expect(await program(db, external, NOW + 3_600_000)).toMatchObject({ heading: "I morgen i Hjerterum", intro: "Om formiddagen guider Jørgen os gennem breathwork." });
    // A new day: new words about the next day.
    const monday = Date.parse("2026-10-12T05:00:00Z");
    expect((await program(db, external, monday)).intro).toBeNull();
    expect(await writeProgramIntro(env, deps(services.fetcher, monday), db, external, async () => true)).toBe(true);
    expect(asked[1]).toContain("Healing");
    expect(asked[1]).not.toContain("Yoga");
  });

  it("names the day when tomorrow is quiet", async () => {
    const db = testDatabase();
    const services = fakeServices({ ai: () => "Om aftenen synger vi." });
    const external = [ev("5", "2026-10-15T17:00:00Z", "Sang")];
    expect(await writeProgramIntro(sagaEnv(db), deps(services.fetcher, NOW), db, external, async () => true)).toBe(true);
    expect((await program(db, external, NOW)).heading).toBe("Torsdag i Hjerterum");
  });
});
