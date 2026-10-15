import { describe, expect, it } from "vitest";
import { teacherFor, type SiteProfile } from "./public-profiles";

// Requested (Gitta): "at events, bliver connected til underviseren på en måde (måske har de hver deres side, man kan trykke ind på, ved at trykke på deres navn?)"
const p = (id: string, name: string): SiteProfile => ({ id, name, title: "", bio: "", topics: "", teaching: true, treatment: false });
describe("an event's host to their page", () => {
  it("finds the visit card by the host's name, or a full name in a host line with two", () => {
    const all = [p("a1", "Anna Andersen"), p("b2", "Douglas Crawford"), p("c3", "Bo")];
    expect(teacherFor("Douglas Crawford", all)?.href).toBe("/behandlere/douglas-crawford");
    expect(teacherFor("anna andersen & Bo Bach", all)?.profile.id).toBe("a1");
    expect(teacherFor("Bo Bach", all)).toBeNull();
    expect(teacherFor("Ukendt", all)).toBeNull();
  });
});
