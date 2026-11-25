import { describe, expect, it } from "vitest";
import { monthEvents } from "./newsletter.js";
import { plainEventText } from "./social/plan.js";
import { prNames, shownAs } from "./teacher-names.js";
import { testDatabase } from "./saga/test-support.js";
import { saveContact, teacherRecord, teacherKey } from "./cockpit/teachers.js";

// Mari-Anne (25 Nov 2026), through the chair: "Måske kan I ændre de fremtidige posts til 'Yin Yoga med Yin Yogi'?"
describe("a teacher's own name in Hjerterum's posts", () => {
  it("is Yin Yogi for Mari-Anne - by her full name or her first name - and changes her name in a title too", async () => {
    const db = testDatabase();
    const names = await prNames(db);
    expect(shownAs(names, "Mari-Anne Christoffersen", "Yin yoga")).toEqual({ host: "Yin Yogi", title: "Yin yoga" });
    expect(shownAs(names, "Mari-Anne", "Yin yoga med Mari-Anne")).toEqual({ host: "Yin Yogi", title: "Yin yoga med Yin Yogi" });
    expect(shownAs(names, "Mari-Anne Christoffersen", "Yin Yoga med Mari-Anne Christoffersen").title).toBe("Yin Yoga med Yin Yogi");
    expect(shownAs(names, "Maria Lærke", "Hatha yoga med Maria Lærke")).toEqual({ host: "Maria Lærke", title: "Hatha yoga med Maria Lærke" });
    expect(shownAs(names, "Mari-Anne Jensen", "Yoga")).toEqual({ host: "Mari-Anne Jensen", title: "Yoga" });
  });

  it("goes into the month's events, the posts and their words - whole, not as a first name", async () => {
    const db = testDatabase();
    const at = Date.parse("2026-12-10T09:30:00Z");
    await db.prepare("INSERT INTO house_events (id, title, starts_at_ms, host, content_hash, updated_at_ms) VALUES ('SFy', 'Yin yoga', ?, 'Mari-Anne Christoffersen', 'x', 0)").bind(at).run();
    const [event] = await monthEvents(db, "2026-12");
    expect(event).toMatchObject({ host: "Yin Yogi", teacher: "Mari-Anne Christoffersen", title: "Yin yoga" });
    expect(plainEventText(event!)).toContain("✨ Yin yoga med Yin Yogi\n");
  });

  it("is set and taken away on the teacher's card in admin", async () => {
    const db = testDatabase();
    const form = (pr: string) => { const f = new FormData(); f.set("email", ""); f.set("pr_name", pr); return f; };
    await saveContact(db, "Anna Ananda", form("Anna Lyd"), "Jacob Hauge", 1);
    expect((await teacherRecord(db, teacherKey("Anna Ananda")))!.pr_name).toBe("Anna Lyd");
    expect(shownAs(await prNames(db), "Anna Ananda", "Lydbad").host).toBe("Anna Lyd");
    await saveContact(db, "Anna Ananda", form(""), "Jacob Hauge", 2);
    expect(shownAs(await prNames(db), "Anna Ananda", "Lydbad").host).toBe("Anna Ananda");
    // Mari-Anne's card shows her name for posts, though the board has written nothing else there.
    expect((await teacherRecord(db, teacherKey("Mari-Anne Christoffersen")))!.pr_name).toBe("Yin Yogi");
  });
});
