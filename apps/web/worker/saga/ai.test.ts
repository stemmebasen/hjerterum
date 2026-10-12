import { describe, expect, it } from "vitest";
import { complete, completeAs, costUsd, DAILY_BUDGET_USD, REQUESTY_EU, SAGA_MODEL, spentToday } from "./ai.js";
import { testDatabase } from "./test-support.js";
import { adminsPage, aiUsage } from "../cockpit/admins.js";

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

  // Requested: "Claude Sonnet 5.5 er standard".
  it("runs on Claude Sonnet 5.5 in the EU, without sampling settings, with a limit on the answer", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher: typeof fetch = async (_input, init) => { bodies.push(JSON.parse(String(init?.body))); return reply(); };
    await complete({ AI_API_KEY: "key", AI_MODEL: SAGA_MODEL } as never, { fetcher, now: () => 0 }, [{ role: "user", content: "Hej" }]);
    await complete({ AI_API_KEY: "key", AI_MODEL: "deepseek-v4-flash" } as never, { fetcher, now: () => 0 }, [{ role: "user", content: "Hej" }]);
    expect(bodies[0]).toEqual({ model: "vertex/claude-sonnet-5-5@eu", messages: [{ role: "user", content: "Hej" }], max_tokens: 4000 });
    expect(bodies[1]).toMatchObject({ model: "deepseek-v4-flash", temperature: 0.2 });
  });

  // Requested: "We spend around $3 to $4 each day on AI calls ... save money" - "brug gerne den billige deep seek model hvorend det giver mening".
  it("measures every call, sends the simple ones to the cheap model, and falls back on the main one when the cheap one fails", async () => {
    const db = testDatabase();
    const models: string[] = [];
    let cheapWorks = true;
    const fetcher: typeof fetch = async (_input, init) => {
      const model = String(JSON.parse(String(init?.body)).model);
      models.push(model);
      if (model === "deepseek-v4-flash" && !cheapWorks) return new Response(JSON.stringify({ error: { message: "no such model" } }), { status: 404 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "Hej" } }], usage: { prompt_tokens: 1200, completion_tokens: 30 } }));
    };
    const env = { AI_API_KEY: "key", AI_MODEL: SAGA_MODEL, AI_CHEAP_MODEL: "deepseek-v4-flash", DB: db } as never;
    const now = () => 1_000;
    const messages = [{ role: "user" as const, content: "Hej" }];
    // A simple task goes to the cheap model; a big one stays on the main model.
    await completeAs("oversaet-tekster", true)(env, { fetcher, now }, messages);
    await completeAs("spoergsmaal")(env, { fetcher, now }, messages);
    expect(models).toEqual(["deepseek-v4-flash", SAGA_MODEL]);
    // The cheap model failing is no failure for the member: the main model answers, and the row says so.
    cheapWorks = false;
    expect(await completeAs("beslutningsart", true)(env, { fetcher, now }, messages)).toBe("Hej");
    expect(models.slice(2)).toEqual(["deepseek-v4-flash", SAGA_MODEL]);
    expect(await db.prepare("SELECT purpose, model, prompt_tokens, completion_tokens, ok, fallback FROM ai_usage ORDER BY id").all()).toMatchObject({ results: [
      { purpose: "oversaet-tekster", model: "deepseek-v4-flash", prompt_tokens: 1200, completion_tokens: 30, ok: 1, fallback: 0 },
      { purpose: "spoergsmaal", model: SAGA_MODEL, ok: 1, fallback: 0 },
      { purpose: "beslutningsart", model: "deepseek-v4-flash", prompt_tokens: null, ok: 0, fallback: 0 },
      { purpose: "beslutningsart", model: SAGA_MODEL, prompt_tokens: 1200, ok: 1, fallback: 1 }] });
    // The middle model: for tasks that need a good model but not the best - and the main model when it fails or is not set.
    const mid = { AI_API_KEY: "key", AI_MODEL: SAGA_MODEL, AI_MID_MODEL: "anthropic/claude-haiku-5-5", DB: db } as never;
    models.length = 0;
    await completeAs("dagsorden", "mid")(mid, { fetcher, now }, messages);
    await completeAs("beslutningsart", true)(mid, { fetcher, now }, messages);
    expect(models).toEqual(["anthropic/claude-haiku-5-5", SAGA_MODEL]);
    // Without a cheap model nothing changes: the main model does everything.
    const plain = { AI_API_KEY: "key", AI_MODEL: SAGA_MODEL } as never;
    models.length = 0;
    await completeAs("oversaet-tekster", true)(plain, { fetcher, now }, messages);
    expect(models).toEqual([SAGA_MODEL]);
  });

  it("shows the chair what the calls were for - most tokens first - and what had to fall back", async () => {
    const db = testDatabase();
    const insert = (at: number, purpose: string, model: string, p: number | null, c: number | null, ok = 1, fb = 0) =>
      db.prepare("INSERT INTO ai_usage (at_ms, purpose, model, prompt_tokens, completion_tokens, ok, fallback) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(at, purpose, model, p, c, ok, fb).run();
    const now = 10 * 86_400_000;
    await insert(now - 1000, "spoergsmaal", "main", 80_000, 900);
    await insert(now - 2000, "spoergsmaal", "main", 70_000, 800);
    await insert(now - 3000, "oversaet-tekster", "cheap", 500, 200);
    await insert(now - 4000, "oversaet-tekster", "main", 500, 200, 1, 1);
    await insert(now - 9 * 86_400_000, "gammel", "main", 1, 1);
    const usage = await aiUsage(db, now);
    expect(usage.week.map(r => [r.purpose, r.model, r.calls])).toEqual([["spoergsmaal", "main", 2], ["oversaet-tekster", "cheap", 1], ["oversaet-tekster", "main", 1]]);
    expect(usage.day).toMatchObject({ calls: 4, tokens: 153_100 });
    const page = adminsPage("", "Jacob Hauge", { cockpit: [], area: [], nowMs: now, usage });
    expect(page).toContain("<h2>AI-forbrug<span class=\"count\">seneste døgn: 4 kald, 153 t. tokens · i dag ca. $");
    expect(page.indexOf("spoergsmaal")).toBeLessThan(page.indexOf("oversaet-tekster"));
    expect(page).toContain("1 gange skiftet til hovedmodellen");
  });
});

// Requested: "find en plan for, hvordan vi kan nedbringe forbruget til cirka en dollar om dagen".
describe("keeping Saga to about a dollar a day", () => {
  const reply = async () => new Response(JSON.stringify({ choices: [{ message: { content: "Hej" } }] }));
  it("prices the day's calls, and past the budget sends the main model's work to the middle one", async () => {
    const db = testDatabase();
    const NOW = Date.parse("2026-10-12T10:00:00Z");
    expect(costUsd("vertex/claude-sonnet-5-5@eu", 100_000, 10_000)).toBeCloseTo(0.45);
    expect(costUsd("anthropic/claude-haiku-5-5", 100_000, 10_000)).toBeCloseTo(0.15);
    const models: string[] = [];
    const fetcher: typeof fetch = async (_input, init) => { models.push(String(JSON.parse(String(init?.body)).model)); return reply(); };
    const env = { DB: db, AI_API_KEY: "key", AI_MODEL: SAGA_MODEL, AI_MID_MODEL: "anthropic/claude-haiku-5-5" } as never;
    await complete(env, { fetcher, now: () => NOW }, [{ role: "user", content: "Hej" }]);
    await db.prepare("INSERT INTO ai_usage (at_ms, purpose, model, prompt_tokens, completion_tokens, ok, fallback) VALUES (?, 'x', ?, 300000, 10000, 1, 0)").bind(NOW - 60_000, SAGA_MODEL).run();
    expect(await spentToday(db, NOW)).toBeGreaterThan(DAILY_BUDGET_USD);
    await complete(env, { fetcher, now: () => NOW }, [{ role: "user", content: "Hej" }]);
    expect(models).toEqual([SAGA_MODEL, "anthropic/claude-haiku-5-5"]);
  });

  it("marks a long system message for the prompt cache, and sends it plain when the router will not take the mark", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let first = true;
    const fetcher: typeof fetch = async (_input, init) => { bodies.push(JSON.parse(String(init?.body))); if (first) { first = false; return new Response("{}", { status: 400 }); } return reply(); };
    const long = "x".repeat(5000);
    await complete({ AI_API_KEY: "key", AI_MODEL: SAGA_MODEL } as never, { fetcher, now: () => 0 }, [{ role: "system", content: long }, { role: "user", content: "Hej" }]);
    expect(bodies[0]!.messages).toEqual([{ role: "system", content: [{ type: "text", text: long, cache_control: { type: "ephemeral" } }] }, { role: "user", content: "Hej" }]);
    expect(bodies[1]!.messages).toEqual([{ role: "system", content: long }, { role: "user", content: "Hej" }]);
  });
});
