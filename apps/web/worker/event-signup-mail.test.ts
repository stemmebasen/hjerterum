import { describe, expect, it, vi } from "vitest";
import { notifyOrganiser, readSignupSettings, saveSignupSettings, signupSettingsByBooking } from "./event-signup-mail.js";
import { guestReceipt, publicEvent } from "./guest-signup.js";
import { linkParts, plainLine } from "../site/event-links.js";
import { testDatabase } from "./saga/test-support.js";

// Douglas (13 Nov 2026): a mail to the teacher when people book, the teacher's own words in the confirmation, and an editor for the text - the chair: "Ja".
const STARTS = Date.parse("2026-12-04T17:00:00Z");
async function event(db: ReturnType<typeof testDatabase>) {
  return Number((await db.prepare(`INSERT INTO room_bookings (clerk_user_id, teacher_name, teacher_email, title, description, starts_at_ms, ends_at_ms, max_attendees, review_status, status, created_at_ms, updated_at_ms)
    VALUES ('teacher', 'Anna Ananda', 'anna@x.dk', 'Lydbad', 'Gongs.', ?, ?, 10, 'approved', 'scheduled', 1, 1)`).bind(STARTS, STARTS + 7_200_000).run()).meta!.last_row_id);
}
const mails = () => {
  const sent: Array<Record<string, unknown>> = [];
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => { sent.push(JSON.parse(String(init?.body))); return new Response("{}"); }) as unknown as typeof fetch;
  return { sent, fetcher };
};
const ENV = { RESEND_API_KEY: "re_test", RESEND_FROM_EMAIL: "Hjerterum <login@hjerterum.info>" };

describe("the organiser's sign-up mails", () => {
  it("keeps the organiser's choice and words with the event, and only the organiser changes them", async () => {
    const db = testDatabase();
    const id = await event(db);
    expect((await signupSettingsByBooking(db, [id])).get(id)).toEqual({ notifySignups: true, confirmationNote: null });
    expect(readSignupSettings({ notifySignups: false, confirmationNote: "  Tag en måtte med.\r\n" })).toEqual({ notifySignups: false, confirmationNote: "Tag en måtte med." });
    await saveSignupSettings(db, id, "someone-else", { notifySignups: false, confirmationNote: "Nej" });
    expect((await signupSettingsByBooking(db, [id])).get(id)).toEqual({ notifySignups: true, confirmationNote: null });
    await saveSignupSettings(db, id, "teacher", { notifySignups: true, confirmationNote: "Tag en måtte med." });
    expect((await signupSettingsByBooking(db, [id])).get(id)!.confirmationNote).toBe("Tag en måtte med.");
  });

  it("tells the organiser who signed up, with their e-mail and whether they are a member - and not when they turned it off or signed up themselves", async () => {
    const db = testDatabase();
    const id = await event(db);
    await db.prepare(`INSERT INTO room_booking_attendees (room_booking_id, clerk_user_id, member_name, member_email, created_at_ms) VALUES (?, 'guest:bo@x.dk', 'Bo', 'bo@x.dk', 1)`).bind(id).run();
    const { sent, fetcher } = mails();
    await notifyOrganiser({ ...ENV, DB: db }, fetcher, id, { name: "Bo", email: "bo@x.dk", clerkUserId: "guest:bo@x.dk" }, "https://www.hjerterum.info");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: ["anna@x.dk"], reply_to: "bo@x.dk", subject: "Ny tilmelding: Lydbad" });
    expect(String(sent[0]!.text)).toContain("Bo (bo@x.dk) har tilmeldt sig");
    expect(String(sent[0]!.text)).toContain("Ikke-medlem");
    expect(String(sent[0]!.text)).toContain("1 af 10 tilmeldt");
    await notifyOrganiser({ ...ENV, DB: db }, fetcher, id, { name: "Anna", email: "anna@x.dk", clerkUserId: "teacher" }, "https://www.hjerterum.info");
    await saveSignupSettings(db, id, "teacher", { notifySignups: false, confirmationNote: null });
    await notifyOrganiser({ ...ENV, DB: db }, fetcher, id, { name: "Eva", email: "eva@x.dk", clerkUserId: "guest:eva@x.dk" }, "https://www.hjerterum.info");
    expect(sent).toHaveLength(1);
  });

  it("puts the organiser's own words in the participant's confirmation", async () => {
    const db = testDatabase();
    const id = await event(db);
    await saveSignupSettings(db, id, "teacher", { notifySignups: true, confirmationNote: "Tag en måtte med.\nDøren åbner 18.45." });
    const { sent, fetcher } = mails();
    await guestReceipt(ENV, fetcher, (await publicEvent(db, id))!, { name: "Bo", email: "bo@x.dk" }, "https://www.hjerterum.info/events/h1");
    expect(String(sent[0]!.text)).toContain("Besked fra Anna Ananda:\nTag en måtte med.\nDøren åbner 18.45.");
    expect(String(sent[0]!.html)).toContain("Tag en måtte med.<br>Døren åbner 18.45.");
  });
});

describe("the event text's formatting", () => {
  it("reads **fed**, *kursiv* and links, and leaves them out where the text is plain", () => {
    expect(linkParts("Kom **i god tid** og *nyd* det [her](https://x.dk) - 2*3")).toEqual([{ text: "Kom " }, { text: "i god tid", strong: true }, { text: " og " },
      { text: "nyd", em: true }, { text: " det " }, { text: "her", href: "https://x.dk" }, { text: " - 2*3" }]);
    expect(plainLine("- **Fed** og *kursiv* [link](https://x.dk)")).toBe("• Fed og kursiv link");
    expect(plainLine("5 * 3 = 15")).toBe("5 * 3 = 15");
  });
});
