import { describe, expect, it } from "vitest";
import { boardPage, boardPosts, closePost, createPost, markSeen, placePending, postsForSaga, reply, toMeeting, waitingOn } from "./board.js";
import { testDatabase } from "../saga/test-support.js";

// Requested (Gitta): "en opslagstavle for bestyrelsen ... Stille noget op til afstemning/afklaring/beslutning som ikke behøver være til et møde. Så kun det vigtigste når med til mødet."
const NOW = Date.parse("2026-10-12T10:00:00Z");

describe("the board's notice board", () => {
  it("answers an Afklaring in a thread, closes it online with what was settled, and keeps it on the others' to-do until they answer", async () => {
    const db = testDatabase();
    const id = (await createPost(db, { kind: "afklaring", title: "Forlænger vi prøveperioden?", text: "Den slutter 15. okt.", who: "Gitta" }, NOW))!;
    let posts = await boardPosts(db, NOW);
    expect(waitingOn(posts, "Jacob Hauge").map(p => p.id)).toEqual([id]);
    expect(waitingOn(posts, "Gitta")).toEqual([]);
    expect(await reply(db, id, "Jacob Hauge", "Ja, en måned mere", NOW + 1000)).toBe(true);
    posts = await boardPosts(db, NOW);
    expect(waitingOn(posts, "Jacob Hauge")).toEqual([]);
    expect(postsForSaga(posts)).toContain("Afklaring: Forlænger vi prøveperioden? (Gitta) · 1 svar, senest Jacob Hauge: Ja, en måned mere");
    expect(await closePost(db, id, "Gitta", "Forlænget til 15. nov.", NOW + 2000)).toBe(true);
    posts = await boardPosts(db, NOW);
    expect(posts[0]).toMatchObject({ status: "closed", outcome: "Forlænget til 15. nov.", closed_by: "Gitta" });
    expect(waitingOn(posts, "Lisbeth")).toEqual([]);
    expect(boardPage("/c", { posts, votes: [], who: "Lisbeth", members: ["Gitta", "Lisbeth", "Jacob Hauge"], notice: "" })).toContain("Afklaret:</b> Forlænget til 15. nov.");
  });

  it("asks each to mark an orientation seen, and shows who has", async () => {
    const db = testDatabase();
    const id = (await createPost(db, { kind: "orientering", title: "Nyt nøglesystem fra mandag", text: "", who: "Frederik" }, NOW))!;
    await markSeen(db, id, "Gitta", NOW);
    const posts = await boardPosts(db, NOW);
    expect(waitingOn(posts, "Gitta")).toEqual([]);
    expect(waitingOn(posts, "Jacob Hauge").map(p => p.id)).toEqual([id]);
    expect(boardPage("/c", { posts, votes: [], who: "Jacob Hauge", members: ["Gitta", "Frederik", "Jacob Hauge"], notice: "" })).toContain("Set af Gitta (1 af 3)");
  });

  it("puts a post sent 'Til mødet' on the next team meeting - at once, or once one is planned", async () => {
    const db = testDatabase();
    const id = (await createPost(db, { kind: "afklaring", title: "Hjerteland-aftalen", text: "", who: "Jacob Hauge", forMeeting: true }, NOW))!;
    expect((await boardPosts(db, NOW))[0]).toMatchObject({ for_meeting_by: "Jacob Hauge", meeting_id: null });
    await db.prepare("INSERT INTO board_meetings (meeting_date, start_time, agenda, kind, created_at_ms, updated_at_ms) VALUES ('2026-10-15', '19:00', '', 'team', ?, ?)").bind(NOW, NOW).run();
    expect(await placePending(db, NOW)).toBe(1);
    expect(await placePending(db, NOW)).toBe(0);
    expect((await db.prepare("SELECT agenda FROM board_meetings").first<{ agenda: string }>())!.agenda).toBe("Hjerteland-aftalen (fra opslagstavlen, ønsket af Jacob)");
    expect(await toMeeting(db, id, "Gitta", NOW)).toBe("added");
    expect((await db.prepare("SELECT agenda FROM board_meetings").first<{ agenda: string }>())!.agenda).toBe("Hjerteland-aftalen (fra opslagstavlen, ønsket af Jacob)");
  });
});
