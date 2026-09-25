import { describe, expect, it } from "vitest";
import pages from "./legacy-content.json";

describe("imported public content", () => {
  it("contains static content without executable legacy widgets", () => {
    for (const page of Object.values(pages)) {
      expect(page.html).not.toMatch(/<(script|style|iframe|form|input|button|object|embed|svg)\b/i);
      expect(page.html).not.toMatch(/\son[a-z]+\s*=/i);
      expect(page.html).not.toMatch(/(?:href|src)=["']\s*(?:javascript|data|vbscript):/i);
    }
  });
  it("keeps legacy registration links on their actual external service", () => {
    expect(pages["/bliv-medlem"].html).toContain('href="https://holistisk.org/bliv-medlem/"');
    expect(pages["/lejepriser"].html).toContain('href="https://prisberegner.replit.app/beregner"');
  });
  it("does not import WiFi credentials or newsletter subscriber tracking", () => {
    for (const page of Object.values(pages)) {
      expect(page.html).not.toMatch(/(?:password|adgangskode)\s*:/i);
      expect(page.html).not.toMatch(/mailchi\.mp\/[^"']*[?&]e=/i);
    }
  });
});
