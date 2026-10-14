import { describe, expect, it } from "vitest";
import { claimJob } from "../saga/store.js";
import { deps, fakeServices, sagaEnv, testDatabase } from "../saga/test-support.js";
import { frameComingAgendas, prioritizeAgenda, scheduledAgendaPriority } from "./agendaPriority.js";
import { framedAgenda, meeting, meetingHeading, reorderAgendaPoints, saveMeeting } from "./data.js";

// Requested: "Hun skal selv prioritere hvad der virker til at haste mest på dagsordenen og hvad der kan vente til senere.
// Start altid med et Velkommen punkt, samt slut med Evt."
const START = Date.parse("2026-10-15T11:30:00Z"); // 13.30 in Copenhagen
const HOUR = 3_600_000;

async function setup(order: unknown = [2, 3, 1]) {
  const db = testDatabase();
  let calls = 0, asked = "";
  const services = fakeServices({ ai: (_system, user) => { calls++; asked = user; return JSON.stringify({ order }); } });
  const env = sagaEnv(db);
  const id = await saveMeeting(db, { date: "2026-10-15", time: "13:30", place: "Hjerterum", agenda: "Idé: sommerfest\nRegnskabet skal være klar til revisor 20. oktober\nEventuelt\nHusleje stiger fra 1. november", kind: "team" }, "Jacob Hauge", START - 30 * HOUR);
  return { db, env, services, id, calls: () => calls, asked: () => asked };
}

describe("the agenda in order", () => {
  it("frames it with Velkommen and Evt., keeping the board's own wording of them", () => {
    expect(framedAgenda(["Økonomi"])).toEqual(["Velkommen", "Økonomi", "Evt."]);
    expect(framedAgenda(["Eventuelt", "Økonomi", "Velkomst og check-in"])).toEqual(["Velkomst og check-in", "Økonomi", "Eventuelt"]);
  });

  it("puts what is most urgent first and what can wait last, between Velkommen and Evt. - nothing added or lost", async () => {
    const { db, env, services, id, asked } = await setup();
    expect(await prioritizeAgenda(env, deps(services.fetcher, START - 20 * HOUR), db, id)).toBe(true);
    expect(asked()).toBe("Dagsorden til teammødet 2026-10-15:\n1. Idé: sommerfest\n2. Regnskabet skal være klar til revisor 20. oktober\n3. Husleje stiger fra 1. november");
    expect((await meeting(db, id))?.agenda.split("\n")).toEqual(["Velkommen", "Regnskabet skal være klar til revisor 20. oktober", "Husleje stiger fra 1. november", "Idé: sommerfest", "Eventuelt"]);
  });

  it("keeps every point when the answer leaves some out or is unreadable", async () => {
    const half = await setup([3]);
    await prioritizeAgenda(half.env, deps(half.services.fetcher, START - 20 * HOUR), half.db, half.id);
    expect((await meeting(half.db, half.id))?.agenda.split("\n")).toEqual(["Velkommen", "Husleje stiger fra 1. november", "Idé: sommerfest", "Regnskabet skal være klar til revisor 20. oktober", "Eventuelt"]);
    const bad = await setup("nonsens");
    await prioritizeAgenda(bad.env, deps(bad.services.fetcher, START - 20 * HOUR), bad.db, bad.id);
    expect((await meeting(bad.db, bad.id))?.agenda.split("\n")).toEqual(["Velkommen", "Idé: sommerfest", "Regnskabet skal være klar til revisor 20. oktober", "Husleje stiger fra 1. november", "Eventuelt"]);
  });

  it("orders a day before and again three hours before - and leaves an order a member made by hand", async () => {
    const { db, env, services, id, calls } = await setup();
    const claim = (key: string, slot: number) => claimJob(db, key, slot, START);
    expect(await scheduledAgendaPriority(env, deps(services.fetcher, START - 30 * HOUR), db, claim)).toBe(false);
    expect(await scheduledAgendaPriority(env, deps(services.fetcher, START - 23 * HOUR), db, claim)).toBe(true);
    expect(await scheduledAgendaPriority(env, deps(services.fetcher, START - 22 * HOUR), db, claim)).toBe(false);
    expect(calls()).toBe(1);
    // A member moves the house rent to the top by hand: three hours before, Saga leaves their order.
    await reorderAgendaPoints(db, id, ["Husleje stiger fra 1. november"], "Lisbeth", START - 10 * HOUR);
    await scheduledAgendaPriority(env, deps(services.fetcher, START - 2 * HOUR), db, claim);
    expect(calls()).toBe(1);
    expect((await meeting(db, id))?.agenda.split("\n").slice(0, 2)).toEqual(["Velkommen", "Husleje stiger fra 1. november"]);
  });

  // Reported: "Jeg kan ikke se, at velkommen og eventuelt er på endnu."
  it("frames each coming team meeting every round, without AI - and an agenda whose AI call fails still gets its frame", async () => {
    const { db, id } = await setup();
    const other = await saveMeeting(db, { date: "2026-10-20", time: "19:00", place: "", agenda: "Valg af dirigent", kind: "andet" }, "Jacob Hauge", START);
    expect(await frameComingAgendas(db, START - 20 * HOUR)).toBe(1);
    expect((await meeting(db, id))?.agenda.split("\n")).toEqual(["Velkommen", "Idé: sommerfest", "Regnskabet skal være klar til revisor 20. oktober", "Husleje stiger fra 1. november", "Eventuelt"]);
    expect((await meeting(db, other))?.agenda).toBe("Valg af dirigent");
    expect(await frameComingAgendas(db, START - 19 * HOUR)).toBe(0);
    const failing = testDatabase();
    const services = fakeServices({ ai: () => { throw new Error("down"); } });
    const fid = await saveMeeting(failing, { date: "2026-10-15", time: "13:30", place: "", agenda: "Økonomi", kind: "team" }, "Jacob Hauge", START);
    await prioritizeAgenda(sagaEnv(failing), deps(services.fetcher, START - 20 * HOUR), failing, fid);
    expect((await meeting(failing, fid))?.agenda).toBe("Velkommen\nØkonomi\nEvt.");
  });

  // Requested: "Mødeoverskrift: Torsdag d. 15. oktober kl. 13.30-15.30"
  it("heads a meeting with its day and time, from start to end", () => {
    expect(meetingHeading({ meeting_date: "2026-10-15", start_time: "13:30", end_time: null, kind: "team" })).toBe("Torsdag d. 15. oktober kl. 13.30-15.30");
    expect(meetingHeading({ meeting_date: "2026-10-15", start_time: "13:30", end_time: "16:00", kind: "team" })).toBe("Torsdag d. 15. oktober kl. 13.30-16.00");
    expect(meetingHeading({ meeting_date: "2026-10-20", start_time: "19:00", end_time: null, kind: "andet" })).toBe("Tirsdag d. 20. oktober kl. 19.00");
    expect(meetingHeading({ meeting_date: "2026-10-20", start_time: null, end_time: null, kind: "team" })).toBe("Tirsdag d. 20. oktober");
  });
});
