import { describe, expect, it } from "vitest";
import { complete, REQUESTY_EU } from "./ai.js";

// Requested: "Saga skal bruge Requesty API fremover".
describe("Saga's AI provider", () => {
  const reply = async () => new Response(JSON.stringify({ choices: [{ message: { content: "Hej" } }] }));
  it("asks Requesty's EU router unless another address is set", async () => {
    const urls: string[] = [];
    const fetcher: typeof fetch = async (input, init) => { urls.push(String(input)); expect((init?.headers as Record<string, string>).authorization).toBe("Bearer key"); return reply(); };
    expect(await complete({ AI_API_KEY: "key", AI_MODEL: "deepseek-v4-flash" } as never, { fetcher, now: () => 0 }, [{ role: "user", content: "Hej" }])).toBe("Hej");
    await complete({ AI_API_KEY: "key", AI_MODEL: "m", AI_BASE_URL: "https://other.test/v1/" } as never, { fetcher, now: () => 0 }, [{ role: "user", content: "Hej" }]);
    expect(urls).toEqual([`${REQUESTY_EU}/chat/completions`, "https://other.test/v1/chat/completions"]);
    expect(REQUESTY_EU).toBe("https://router.eu.requesty.ai/v1");
  });
});
