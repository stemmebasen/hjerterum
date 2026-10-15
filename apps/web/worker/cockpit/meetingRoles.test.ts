import { describe, expect, it } from "vitest";
import { claimJob, saveBoardMessage } from "../saga/store.js";
import { BOARD, deps, fakeServices, OWNER, sagaEnv, testDatabase } from "../saga/test-support.js";
import { meetingOn, meetings, saveMeeting } from "./data.js";
import { setMemberLang } from "./i18n.js";
import { ensureNextTeamMeeting, isoWeek, nextEvenThursday, pickRoles, scheduledMeetingRoles, scheduledRoleReminders } from "./meetingRoles.js";

// Requested: "The day after the last board meeting, a new mødeleder and ordstyrer will get chosen. Saga will be picking two and letting them know directly.
// For mødelederen er det vigtigt at huske vedkommende på at gøre dagsordenen klar 3 dage inden." - "Hele bestyrelsen"; "Saga må gerne automatisk sætte
// teammøder op på torsdage i lige uger 13.30-15.30"; "Når hele gruppen får at vide hvem der er valgt, behøver individerne ikke at få det at vide direkte" -
// "Men de skal mindes om at de er valgt nogle dage inden".
const DAY_AFTER = Date.parse("2026-10-16T07:30:00Z"); // 09.30 in Copenhagen
const text = (call: { body: unknown }) => call.body as { chat_id: string; text: string };

async function setup() {
  const db = testDatabase();
  const services = fakeServices();
  const env = sagaEnv(db, { COCKPIT_URL: "https://admin.hjerterum.example" });
  for (const [i, [name, id]] of ([["Jacob Hauge", OWNER], ["Lisbeth", "201"], ["Gitta", "202"], ["Douglas Crawford", "203"]] as const).entries())
    await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: id, text: "Hej", sentAtMs: DAY_AFTER - 86_400_000, fromAssistant: false });
  await setMemberLang(db, "Douglas Crawford", "en", DAY_AFTER);
  await saveMeeting(db, { date: "2026-10-15", time: "13:30", end: "15:30", place: "Hjerterum", agenda: "Velkommen\nEvt.", kind: "team", leader: "Jacob Hauge", moderator: "Lisbeth" }, "Jacob Hauge", DAY_AFTER - 86_400_000);
  const claim = (now: number) => (key: string, slot: number) => claimJob(db, key, slot, now);
  return { db, env, services, claim };
}

describe("the meeting's leader and moderator in turn", () => {
  it("knows the Thursdays of the even weeks", () => {
    expect(isoWeek("2026-10-15")).toBe(42);
    expect(isoWeek("2027-01-01")).toBe(53);
    expect(nextEvenThursday("2026-10-15")).toBe("2026-10-29");
    expect(nextEvenThursday("2026-10-22")).toBe("2026-10-29");
  });

  it("takes the one who has had the role longest ago, never both roles, and keeps what the chair picked", () => {
    const m = (date: string, leader: string, moderator: string) => ({ id: 1, meeting_date: date, start_time: "13:30", place: null, agenda: "", updated_at_ms: 0, updated_by: null, kind: "team" as const, leader, moderator });
    const members = ["Douglas Crawford", "Gitta", "Jacob Hauge", "Lisbeth"];
    const history = [m("2026-10-01", "Gitta", "Douglas"), m("2026-10-15", "Jacob Hauge", "Lisbeth")];
    expect(pickRoles(members, history, {}, history[1]!, 0)).toEqual({ leader: "Douglas Crawford", moderator: "Gitta" });
    expect(pickRoles(members, history, { leader: "Lisbeth" }, history[1]!, 0)).toEqual({ leader: "Lisbeth", moderator: "Gitta" });
    expect(pickRoles(["Jacob Hauge", "Lisbeth"], history, {}, history[1]!, 0)).toEqual({ leader: "Lisbeth", moderator: "Jacob Hauge" });
  });

  it("picks them the day after a team meeting, sets up the next meeting when there is none, and tells only the group", async () => {
    const { db, env, services, claim } = await setup();
    // Before 09: not yet.
    expect(await scheduledMeetingRoles(env, deps(services.fetcher, DAY_AFTER - 2 * 3_600_000), db, claim(DAY_AFTER - 2 * 3_600_000))).toBeNull();
    const next = await scheduledMeetingRoles(env, deps(services.fetcher, DAY_AFTER), db, claim(DAY_AFTER));
    expect(next).toMatchObject({ meeting_date: "2026-10-29", start_time: "13:30", end_time: "15:30", kind: "team", leader: "Douglas Crawford", moderator: "Gitta" });
    expect(await meetingOn(db, "2026-10-29")).toMatchObject({ leader: "Douglas Crawford", moderator: "Gitta", updated_by: "Saga" });
    const sent = services.telegram("sendMessage").map(text);
    expect(sent).toEqual([expect.objectContaining({ chat_id: BOARD, text: "Næste teammøde: torsdag d. 29. oktober kl. 13.30-15.30 i Hjerterum 🌿\nMødeleder: Douglas · Ordstyrer: Gitta\n"
      + "Douglas, jeg minder dig om at gøre dagsordenen klar 3 dage før.\nhttps://admin.hjerterum.example/moder/2" })]);
    // Once per meeting.
    expect(await scheduledMeetingRoles(env, deps(services.fetcher, DAY_AFTER + 600_000), db, claim(DAY_AFTER + 600_000))).toBeNull();
    expect((await meetings(db)).length).toBe(2);
  });

  it("uses the next meeting already in the calendar, and keeps a role the chair has set", async () => {
    const { db, env, services, claim } = await setup();
    await saveMeeting(db, { date: "2026-10-22", time: "17:00", place: "Hjerterum", kind: "team", leader: "Lisbeth" }, "Jacob Hauge", DAY_AFTER);
    expect(await scheduledMeetingRoles(env, deps(services.fetcher, DAY_AFTER), db, claim(DAY_AFTER))).toMatchObject({ meeting_date: "2026-10-22", leader: "Lisbeth", moderator: "Douglas Crawford" });
    expect((await meetings(db)).length).toBe(2);
  });

  it("reminds both privately three days before, in their own language, the leader to get the agenda ready", async () => {
    const { db, env, services, claim } = await setup();
    await scheduledMeetingRoles(env, deps(services.fetcher, DAY_AFTER), db, claim(DAY_AFTER));
    const THREE_BEFORE = Date.parse("2026-10-26T09:00:00Z");
    expect(await scheduledRoleReminders(env, deps(services.fetcher, THREE_BEFORE - 86_400_000), db, claim(THREE_BEFORE - 86_400_000))).toBe(0);
    expect(await scheduledRoleReminders(env, deps(services.fetcher, THREE_BEFORE), db, claim(THREE_BEFORE))).toBe(2);
    expect(await scheduledRoleReminders(env, deps(services.fetcher, THREE_BEFORE + 600_000), db, claim(THREE_BEFORE + 600_000))).toBe(0);
    const sent = services.telegram("sendMessage").map(text).filter(m => m.chat_id !== BOARD);
    expect(sent.find(m => m.chat_id === "203")!.text).toBe("Hi Douglas 🙂 You are leading the team meeting on Thursday 29 October at 13.30. Remember to get the agenda ready today - "
      + "you can edit it here: https://admin.hjerterum.example/moder/2#dagsorden, or just write the points to me here, and I will add them.");
    expect(sent.find(m => m.chat_id === "202")!.text).toBe("Hej Gitta 🙂 Lige en påmindelse: Du er ordstyrer på teammødet torsdag d. 29. oktober kl. 13.30-15.30. Douglas er mødeleder. Jeg sender dig dagsordenen på dagen.");
    expect(await db.prepare("SELECT member, meeting_id FROM agenda_asks").all()).toMatchObject({ results: [{ member: "Douglas Crawford", meeting_id: 2 }] });
  });

  // Requested: "Husk at Saga skal sætte teammøde op automatisk. Lige nu er der ikke sat noget op."
  it("sets up the next team meeting as soon as the last one is over, once", async () => {
    const { db, claim } = await setup();
    const during = Date.parse("2026-10-15T12:00:00Z"), after = Date.parse("2026-10-15T14:00:00Z"); // 14.00 and 16.00 in Copenhagen
    expect(await ensureNextTeamMeeting(db, during, claim(during))).toBeNull();
    expect(await ensureNextTeamMeeting(db, after, claim(after))).toMatchObject({ meeting_date: "2026-10-29", start_time: "13:30", end_time: "15:30", kind: "team", place: "Hjerterum", leader: null });
    expect(await ensureNextTeamMeeting(db, after + 600_000, claim(after + 600_000))).toBeNull();
    expect((await meetings(db)).length).toBe(2);
  });
});
