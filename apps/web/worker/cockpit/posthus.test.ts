import { describe, expect, it } from "vitest";
import { waited } from "./enquiries.js";

// Requested: "Ved hver mail skal der stå hvor længe afsenderen har ventet på svar."
describe("how long a sender has waited", () => {
  it("says it in plain words", () => {
    const now = Date.parse("2026-10-02T10:00:00Z"), h = 3_600_000;
    expect(waited(now - 20 * 60_000, now)).toBe("under en time");
    expect(waited(now - h, now)).toBe("1 time");
    expect(waited(now - 5 * h, now)).toBe("5 timer");
    expect(waited(now - 26 * h, now)).toBe("1 dag");
    expect(waited(now - 9 * 24 * h, now)).toBe("9 dage");
    expect(waited(now - 30 * 24 * h, now)).toBe("4 uger");
  });
});
