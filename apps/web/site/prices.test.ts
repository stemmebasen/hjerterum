import { afterEach, describe, expect, it } from "vitest";
import { applyMembershipLevels } from "../membership.js";
import { renderMarkdown } from "./markdown.js";
import { sitePage } from "./redirects.js";

// Asked (the chair, 17 Nov 2026): the FAQ's prices follow what is saved in admin.
describe("the prices in the FAQ", () => {
  afterEach(() => applyMembershipLevels([]));

  it("are written from the membership levels in use", () => {
    const page = sitePage("/medlemskab")!;
    expect(page.body).toContain("[[medlemspriser]]");
    expect(renderMarkdown(page.body)).toContain("<strong>Standard:</strong> 222 kr. pr. måned eller 2.310 kr. pr. år.");
    applyMembershipLevels([{ tier: "standard", name: "Standard medlemskab", description: "x", month: 23_000, year: 240_000 }]);
    const html = renderMarkdown(page.body);
    expect(html).toContain("<strong>Standard:</strong> 230 kr. pr. måned eller 2.400 kr. pr. år.");
    expect(html).not.toContain("[[medlemspriser]]");
  });
});
