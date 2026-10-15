import { describe, expect, it } from "vitest";
import { testDatabase } from "../saga/test-support.js";
import { addTodo, editTodo, todosFor } from "./data.js";
import { isPrOwner, openPrWishes, setPrWishes } from "./prWishes.js";
import { todosPage } from "./todosPage.js";
import { comingNames } from "./page.js";

// Gitta's comments (via the chair): "Det ville være nice hvis man kunne redigere sine egne to do's", "i andres PR ønsker, dukker op på min todo" - "Ja på Gittas
// liste" - and "Det ville også være nice at kunne sortere to do listen, så jeg feks kan vælge at få alle pr ønsker efter hinanden".
const NOW = Date.parse("2026-10-15T10:00:00Z");

describe("the to-do list after Gitta's comments", () => {
  it("lets you correct your own to-do, and nobody else's", async () => {
    const db = testDatabase();
    await addTodo(db, { owner: "Gitta Hansen", text: "Ring til trykkeriet om flyerre", due: null, createdBy: "Gitta Hansen" }, NOW);
    const [todo] = await todosFor(db, "Gitta Hansen");
    expect(await editTodo(db, todo!.id, "Lisbeth", "Noget andet")).toBe(false);
    expect(await editTodo(db, todo!.id, "Gitta Hansen", "  Ring til trykkeriet om flyerne ")).toBe(true);
    expect((await todosFor(db, "Gitta Hansen"))[0]!.text).toBe("Ring til trykkeriet om flyerne");
    const page = todosPage("", { who: "Gitta Hansen", members: ["Gitta Hansen"], tasks: [], checked: new Map(), todos: await todosFor(db, "Gitta Hansen"), notice: "" });
    expect(page).toContain(`<form class="todo-edit" method="post" action="/opgaver/ret"><input type="hidden" name="id" value="${todo!.id}">`);
    expect(page).toContain('aria-label="Ret opgaven">Ring til trykkeriet om flyerne</textarea>');
  });

  it("puts the PR wishes not yet made on Gitta's list, and lets her see one kind at a time", async () => {
    const db = testDatabase();
    await db.prepare("INSERT INTO house_events (id, title, starts_at_ms, ends_at_ms, location, content_hash, updated_at_ms) VALUES ('k', 'Koncert med Victoria', ?, ?, 'Hjerterum', 'h', ?)")
      .bind(NOW + 5 * 86_400_000, NOW + 5 * 86_400_000 + 7_200_000, NOW).run();
    await setPrWishes(db, "k", "Lisbeth", ["story", "reel"], "", NOW);
    expect(isPrOwner("Gitta Hansen")).toBe(true);
    expect(isPrOwner("Lisbeth")).toBe(false);
    const prs = await openPrWishes(db, NOW);
    expect(prs.map(p => p.kind).sort()).toEqual(["reel", "story"]);
    await addTodo(db, { owner: "Gitta Hansen", text: "Svar på mail fra Pia", due: null, createdBy: "Saga" }, NOW);
    const page = todosPage("", { who: "Gitta Hansen", members: ["Gitta Hansen"], tasks: [], checked: new Map(), todos: await todosFor(db, "Gitta Hansen"), notice: "", prs });
    expect(page).toContain('<li data-cat="pr"><a href="/arrangementer#pr"><strong>Story - Koncert med Victoria</strong></a><span class="ctx">PR-ønske · ');
    expect(page).toContain('<input type="hidden" name="back" value="opgaver"><button class="linkbtn">Markér lavet</button>');
    expect(page).toContain('<li data-cat="mails" class="todo">');
    expect(page).toContain('<div class="cat-filter" role="group" aria-label="Vis kun"><button type="button" class="cat" aria-pressed="true" data-cat="">Alle</button><button type="button" class="cat" aria-pressed="false" data-cat="mails">Mails</button><button type="button" class="cat" aria-pressed="false" data-cat="pr">PR/SoMe</button></div>');
  });

  // Asked: 'Kommer: Jacob, Gitta (2) - Hvad betyder "(2)"?'
  it("says who is coming in words, without a count", () => {
    expect(comingNames(["Jacob Hauge", "Gitta Hansen"])).toBe("Jacob og Gitta");
    expect(comingNames(["Jacob Hauge", "Gitta Hansen", "Lisbeth"])).toBe("Jacob, Gitta og Lisbeth");
  });
});

// Requested: "Når der står + eller - ved siden af medlemstallet, skal det være beregnet ift. en uge tidligere. Og det skal nævnes f.eks. '5 nye ift. sidste uge'".
describe("the members' change over a week", () => {
  it("compares with the count from at least a week before, and says it in words", async () => {
    const { changeWords, membersTile, weekBefore } = await import("./members.js");
    const row = (taken_on: string, paying: number) => ({ id: 0, taken_on, total_accounts: 0, with_membership: null, paying, free: null, past_due: null, pending_cancellation: null, cancelled: null, annual_revenue_kr: null, plans: [], added_by: "", created_at_ms: 0 });
    const rows = [row("2026-10-15", 177), row("2026-10-12", 175), row("2026-10-08", 172), row("2026-10-06", 171)];
    expect(weekBefore(rows)?.taken_on).toBe("2026-10-08");
    expect(changeWords(177, 172)).toBe("5 nye ift. sidste uge");
    expect(changeWords(169, 172)).toBe("3 færre ift. sidste uge");
    expect(changeWords(173, 172)).toBe("1 ny ift. sidste uge");
    expect(membersTile("", rows)).toContain('<b>177<span class="delta up">+5</span></b><span class="sub">betalende medlemmer · 5 nye ift. sidste uge</span>');
    expect(weekBefore(rows.slice(0, 2))).toBeUndefined();
  });
});
