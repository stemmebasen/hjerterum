import { expect, it } from "vitest";
import { profileSlug } from "./public-profiles";

// Requested: "man skal så kunne klikke ind på en behandler" - each visit card at /behandlere/<navn>.
it("gives each profile an address from the name, and tells two of the same name apart", () => {
  const all = [{ name: "Jacob Hauge", id: "abc12345-x" }, { name: "Anna Ø", id: "def67890-y" }, { name: "Anna Ø", id: "aaa11111-z" }];
  expect(profileSlug(all[0]!, all)).toBe("jacob-hauge");
  expect(profileSlug(all[1]!, all)).toBe("anna-oe-def678");
  expect(profileSlug(all[2]!, all)).toBe("anna-oe-aaa111");
});
