import { expect, it } from "vitest";
import { lastMonthTasks } from "./data.js";

// Requested: "Jeg synes godt, at det må være opgaver fra den sidste måned, der er samlet her."
it("keeps the board's tasks from the last month, newest first", () => {
  const task = (what: string, meeting: string) => ({ who: "Lisbeth", what, due: "", meeting, source: "referat" as const });
  const list = lastMonthTasks([task("Gammel", "2026-08-20"), task("September", "2026-09-17"), task("Oktober", "2026-10-01"), task("Dokument", "5/9")], Date.parse("2026-10-02T10:00:00Z"));
  expect(list.map(t => t.what)).toEqual(["Oktober", "September", "Dokument"]);
});
