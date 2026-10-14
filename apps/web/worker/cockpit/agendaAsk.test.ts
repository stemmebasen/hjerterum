import { describe, expect, it } from "vitest";
import { handleSagaRequest } from "../saga/handler.js";
import { claimJob, saveBoardMessage } from "../saga/store.js";
import { BOARD, deps, fakeServices, OWNER, sagaEnv, testDatabase } from "../saga/test-support.js";
import { scheduledAgendaAsk } from "./agendaAsk.js";
import { meetingOn, saveMeeting } from "./data.js";
import { setMemberLang } from "./i18n.js";

// Requested: "24 hours before a team meeting she should write to each and every board member directly and ask if they have anything to add to
// the agenda and she should tell them that they can just write it to her in the chat and she will add it" - "Is there any way that she can write
// in that language that the member has chosen in admin?"
const NOW = Date.parse("2026-10-14T13:00:00Z"); // 15.00 in Copenhagen, the day before
const text = (call: { body: unknown }) => (call.body as { chat_id: string; text: string });

async function setup(fail: string[] = []) {
  const db = testDatabase();
  const seen: string[] = [];
  const services = fakeServices({ ai: (_system, first) => { seen.push(first); return "Det sætter jeg på.\n[[DAGSORDEN dato=2026-10-15 punkt=Budget for julefrokosten]]"; } });
  const fetcher: typeof fetch = async (input, init) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as { chat_id?: string } : {};
    if (String(input).endsWith("/sendMessage") && fail.includes(String(body.chat_id)))
      return new Response(JSON.stringify({ ok: false, description: "Forbidden: bot can't initiate conversation with a user" }), { status: 403 });
    return services.fetcher(input, init);
  };
  const env = sagaEnv(db, { COCKPIT_URL: "https://admin.hjerterum.example" });
  for (const [i, [name, id]] of ([["Jacob Hauge", OWNER], ["Lisbeth", "201"], ["Douglas Crawford", "203"]] as const).entries())
    await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: id, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
  await setMemberLang(db, "Douglas Crawford", "en", NOW);
  await saveMeeting(db, { date: "2026-10-15", time: "13:30", place: "Hjerterum", agenda: "Økonomi", kind: "team" }, "Jacob Hauge", NOW);
  const claim = (key: string, slot: number) => claimJob(db, key, slot, NOW);
  return { db, env, services, fetcher, seen, claim };
}

describe("Saga asks each board member for agenda points the day before a team meeting", () => {
  it("writes to each of them privately, in their own language, once", async () => {
    const { db, env, services, fetcher, claim } = await setup();
    // Two days before: not yet.
    expect(await scheduledAgendaAsk(env, deps(fetcher, NOW - 26 * 3_600_000), db, claim)).toBe(0);
    expect(await scheduledAgendaAsk(env, deps(fetcher, NOW), db, claim)).toBe(3);
    const sent = services.telegram("sendMessage").map(text);
    expect(sent.map(m => m.chat_id).sort()).toEqual([OWNER, "201", "203"].sort());
    expect(sent.find(m => m.chat_id === "201")!.text).toBe("Hej Lisbeth 🙂 I morgen, torsdag 15. oktober kl. 13.30, har vi teammøde (Hjerterum). "
      + "Har du noget, der skal på dagsordenen? Skriv det bare til mig her i chatten, så sætter jeg det på.\n\nDagsordenen indtil nu: https://admin.hjerterum.example/moder/1");
    expect(sent.find(m => m.chat_id === "203")!.text).toContain("Hi Douglas 🙂 Tomorrow, Thursday 15 October at 13.30, we have a team meeting");
    expect(sent.find(m => m.chat_id === "203")!.text).toContain("Just write it to me here in the chat, and I will add it.");
    expect(await scheduledAgendaAsk(env, deps(fetcher, NOW + 600_000), db, claim)).toBe(0);
  });

  it("tells the chair whom she could not write to", async () => {
    const { db, env, services, fetcher, claim } = await setup(["203"]);
    expect(await scheduledAgendaAsk(env, deps(fetcher, NOW), db, claim)).toBe(2);
    const toChair = services.telegram("sendMessage").map(text).filter(m => m.chat_id === OWNER).map(m => m.text);
    expect(toChair).toContain("Jeg kunne ikke skrive privat til Douglas om dagsordenen - de skal først åbne en chat med mig (skrive /start til mig i Telegram).");
  });

  it("puts what a member writes back to her on the agenda, and answers in the private chat", async () => {
    const { db, env, services, fetcher, seen, claim } = await setup();
    await scheduledAgendaAsk(env, deps(fetcher, NOW), db, claim);
    const update = { update_id: 1, message: { message_id: 50, date: NOW / 1000, chat: { id: 201, type: "private" }, from: { id: 201, first_name: "Lisbeth" }, text: "Budget for julefrokosten" } };
    const response = await handleSagaRequest(new Request("https://hjerterum.test/api/saga/telegram", { method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "hook-secret" }, body: JSON.stringify(update) }), env, deps(fetcher, NOW + 3_600_000));
    expect(response.status).toBe(200);
    // She knows what she asked about.
    expect(seen.at(-1)).toBe("(Det, du skrev til mig privat i Telegram:)");
    expect((await meetingOn(db, "2026-10-15"))?.agenda).toBe("Velkommen\nØkonomi\nBudget for julefrokosten\nEvt.");
    const reply = services.telegram("sendMessage").map(text).filter(m => m.chat_id === "201").at(-1)!.text;
    expect(reply).toContain("✓ Sat på dagsordenen torsdag 15. oktober: Budget for julefrokosten - se mødet: https://admin.hjerterum.example/moder/1");
  });
});
