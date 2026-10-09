import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The deploy reads wrangler.jsonc with JSON.parse (.github/scripts/configure-staging-d1.mjs): a comment in it stopped a deploy once.
describe("wrangler.jsonc", () => {
  it("is plain JSON, with no comments, so the deploy script can read it", () => {
    const source = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    expect(() => JSON.parse(source)).not.toThrow();
    const config = JSON.parse(source) as { env?: Record<string, { vars?: Record<string, string> }> };
    expect(config.env?.staging?.vars?.AI_CHEAP_MODEL).toBe("deepseek-v4-flash");
  });
});
