import { describe, expect, it } from "vitest";
import { memberSagaChat, parseAnswer } from "./member-saga.js";
import { testDatabase } from "./saga/test-support.js";

// Requested: Saga on the member site helps set up an event, and can fill the form.
describe("Saga on the member site", () => {
  it("returns a draft only with a title, a real day and times", () => {
    const ok = parseAnswer('{"reply":"Her er et udkast","draft":{"title":"Breathwork","description":"Rolig","date":"2026-10-20","start":"11:30","end":"13:30","booking_type":"free","max_attendees":12,"member_price_kr":null,"non_member_price_kr":150}}');
    expect(ok.draft).toMatchObject({ title: "Breathwork", date: "2026-10-20", booking_type: "free", non_member_price_kr: 150 });
    expect(parseAnswer('{"reply":"Hvornår?","draft":{"title":"Breathwork","date":"","start":"","end":""}}').draft).toBeNull();
    expect(parseAnswer("bare tekst").reply).toBe("bare tekst");
  });
  it("answers only signed-in members", async () => {
    const response = await memberSagaChat(new Request("https://x/api/members/saga/chat", { method: "POST", body: "{}" }), { DB: testDatabase(), AI_API_KEY: "k", AI_MODEL: "m" } as never, { fetcher: fetch, now: () => 0 });
    expect(response.status).toBe(401);
  });
});
