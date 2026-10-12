import type { SagaDeps, SagaEnv } from "./env.js";
import { setServiceStatus } from "./store.js";

export type ChatPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
/** A user turn may carry a picture (a screenshot Saga reads), as OpenAI-compatible content parts. */
export type ChatMessage = { role: "system" | "assistant"; content: string } | { role: "user"; content: string | ChatPart[] };

/** Requested: "Saga skal bruge Requesty API fremover". Requesty's EU router (OpenAI-compatible chat
 * completions) is the default; AI_BASE_URL only overrides it. The provider stays behind this one function. */
export const REQUESTY_EU = "https://router.eu.requesty.ai/v1";
/** Requested: "Vi skal bruge en bedre model end Deep seek" - "Claude Sonnet 5.5 er standard". Requesty
 * has no Bedrock Frankfurt Sonnet 5.5; this one runs on Google Cloud in the EU, so the board's data stays there. */
export const SAGA_MODEL = "vertex/claude-sonnet-5-5@eu";
export const isClaude = (model: string) => /(?:^|\/)claude-/i.test(model);
export type CompleteOptions = { purpose?: string; /** `true`: a simple task (sorting, translation) - the cheap model does it when one is set. `"mid"`: a task that needs a good model but not the best - the middle model. The main model answers when the other fails or is not set. */ cheap?: boolean | "mid";
  /** The longest answer the task needs (tokens). Requested: "nedbringe forbruget til cirka en dollar om dagen" - an answer may no longer run to 16 000 tokens by default. */
  maxTokens?: number };

/** Requested: "find en plan for, hvordan vi kan nedbringe forbruget til cirka en dollar om dagen". Dollars per million tokens
 * (input, output) by model family - an estimate from ai_usage, close enough to steer by. */
const PRICES: Array<[RegExp, number, number]> = [[/sonnet/i, 3, 15], [/opus/i, 15, 75], [/haiku/i, 1, 5], [/deepseek/i, 0.3, 1.2]];
export const DEFAULT_MAX_TOKENS = 4000;
export const DAILY_BUDGET_USD = 1;
export function costUsd(model: string, promptTokens: number, completionTokens: number): number {
  const [, input, output] = PRICES.find(([re]) => re.test(model)) ?? [/./, 3, 15];
  return (promptTokens * input + completionTokens * output) / 1_000_000;
}
/** Today's estimated spend (Copenhagen day), from the tokens ai_usage kept. */
export async function spentToday(db: NonNullable<SagaEnv["DB"]>, nowMs: number): Promise<number> {
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(nowMs);
  const from = nowMs - 36 * 3_600_000;
  const rows = (await db.prepare("SELECT at_ms, model, prompt_tokens, completion_tokens FROM ai_usage WHERE at_ms >= ?").bind(from)
    .all<{ at_ms: number; model: string; prompt_tokens: number | null; completion_tokens: number | null }>().catch(() => ({ results: [] }))).results ?? [];
  return rows.filter(r => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(r.at_ms) === day)
    .reduce((sum, r) => sum + costUsd(r.model, r.prompt_tokens ?? 0, r.completion_tokens ?? 0), 0);
}

/** The long, fixed part of a call (the system message) marked for Anthropic's prompt cache, so a repeat within minutes costs a tenth. */
function cached(messages: ChatMessage[]): unknown[] {
  return messages.map((m, i) => i === 0 && m.role === "system" && m.content.length > 4000
    ? { role: "system", content: [{ type: "text", text: m.content, cache_control: { type: "ephemeral" } }] } : m);
}

async function ask(env: SagaEnv, deps: SagaDeps, model: string, messages: ChatMessage[], maxTokens = DEFAULT_MAX_TOKENS): Promise<{ text: string; promptTokens: number | null; completionTokens: number | null }> {
  const base = (env.AI_BASE_URL || REQUESTY_EU).replace(/\/+$/, "");
  const send = (body: unknown) => deps.fetcher(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.AI_API_KEY}` },
    body: JSON.stringify(body)
  });
  // Claude takes no sampling settings (Sonnet 5.5 refuses them); its long system message goes to the prompt cache.
  let response = await send(isClaude(model) ? { model, messages: cached(messages), max_tokens: maxTokens } : { model, messages, max_tokens: maxTokens, temperature: 0.2 });
  // A router that will not take the cache mark gets the plain messages.
  if (response.status === 400 && isClaude(model)) response = await send({ model, messages, max_tokens: maxTokens });
  const data = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } | string; usage?: { prompt_tokens?: number; completion_tokens?: number } } | null;
  const text = data?.choices?.[0]?.message?.content?.trim();
  // The chair's page shows whether Saga's AI answers, and what the provider said when it did not.
  const said = typeof data?.error === "string" ? data.error : data?.error?.message ?? "";
  if (env.DB) await setServiceStatus(env.DB, "ai", Boolean(response.ok && text), response.ok && text ? "" : `${response.status} ${said}`.trim(), deps.now());
  if (!response.ok || !text) throw new Error(`ai_request_failed: ${response.status}`);
  return { text, promptTokens: typeof data?.usage?.prompt_tokens === "number" ? data.usage.prompt_tokens : null, completionTokens: typeof data?.usage?.completion_tokens === "number" ? data.usage.completion_tokens : null };
}

/** Requested: "We spend around $3 to $4 each day on AI calls ... save money" - "brug gerne den billige deep seek model hvorend det giver mening": every call says what it is for (`ai_usage` keeps what it cost in tokens),
 * and a simple one (`cheap`) goes to AI_CHEAP_MODEL when one is set - and to the main model when the cheap one fails, so nothing breaks on a wrong model name. */
export async function complete(env: SagaEnv, deps: SagaDeps, messages: ChatMessage[], options: CompleteOptions = {}): Promise<string> {
  if (!env.AI_API_KEY || !env.AI_MODEL) throw new Error("ai_not_configured");
  const purpose = options.purpose ?? "andet";
  const record = async (model: string, ok: boolean, fallback: boolean, tokens?: { promptTokens: number | null; completionTokens: number | null }) => {
    if (!env.DB) return;
    await env.DB.prepare("INSERT INTO ai_usage (at_ms, purpose, model, prompt_tokens, completion_tokens, ok, fallback) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(deps.now(), purpose, model, tokens?.promptTokens ?? null, tokens?.completionTokens ?? null, ok ? 1 : 0, fallback ? 1 : 0).run().catch(() => undefined);
  };
  let fallback = false;
  // Past the day's budget, what would go to the main model goes to the middle one - the main model stays the last resort.
  const overBudget = !options.cheap && env.DB && env.AI_MID_MODEL ? await spentToday(env.DB, deps.now()) >= DAILY_BUDGET_USD : false;
  const tier = overBudget ? "mid" : options.cheap;
  const lighter = tier === "mid" ? env.AI_MID_MODEL : tier ? env.AI_CHEAP_MODEL : undefined;
  if (lighter && lighter !== env.AI_MODEL) {
    try {
      const answer = await ask(env, deps, lighter, messages, options.maxTokens);
      await record(lighter, true, false, answer);
      return answer.text;
    } catch { await record(lighter, false, false); fallback = true; }
  }
  try {
    const answer = await ask(env, deps, env.AI_MODEL, messages, options.maxTokens);
    await record(env.AI_MODEL, true, fallback, answer);
    return answer.text;
  } catch (error) { await record(env.AI_MODEL, false, fallback); throw error; }
}

/** A call with what it is for - `completeAs("oversaet-tekster", true, 8000)(env, deps, messages)`. */
export const completeAs = (purpose: string, cheap: boolean | "mid" = false, maxTokens?: number) => (env: SagaEnv, deps: SagaDeps, messages: ChatMessage[]) =>
  complete(env, deps, messages, { purpose, cheap, ...(maxTokens ? { maxTokens } : {}) });
