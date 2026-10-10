import { expect, it } from "vitest";
import { parseMemberProfileUpdate } from "./member-profile.js";

// Requested: no addresses, but the birthday (for the star sign some day).
it("takes a real birthday and no address", () => {
  expect(parseMemberProfileUpdate({ birthday: "1985-05-03" })).toEqual({ birthday: "1985-05-03" });
  expect(parseMemberProfileUpdate({ birthday: "" })).toEqual({ birthday: null });
  for (const bad of ["1985-02-30", "3/5/1985", "2999-01-01", "1800-01-01"]) expect(() => parseMemberProfileUpdate({ birthday: bad })).toThrow("invalid_birthday");
  expect(() => parseMemberProfileUpdate({ streetAddress: "Vej 1" })).toThrow("invalid_empty_update");
});
