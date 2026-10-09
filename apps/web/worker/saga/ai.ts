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
export type CompleteOptions = { purpose?: string; /** The task is simple (sorting, labels, translation): the cheap model does it when one is set, the main model when it fails. */ cheap?: boolean };

async function ask(env: SagaEnv, deps: SagaDeps, model: string, messages: ChatMessage[]): Promise<{ text: string; promptTokens: number | null; completionTokens: number | null }> {
  const base = (env.AI_BASE_URL || REQUESTY_EU).replace(/\/+$/, "");
  const response = await deps.fetcher(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.AI_API_KEY}` },
    // Claude takes no sampling settings (Sonnet 5.5 refuses them) and needs room for a whole referat.
    body: JSON.stringify(isClaude(model) ? { model, messages, max_tokens: 16000 } : { model, messages, temperature: 0.2 })
  });
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
  if (options.cheap && env.AI_CHEAP_MODEL && env.AI_CHEAP_MODEL !== env.AI_MODEL) {
    try {
      const answer = await ask(env, deps, env.AI_CHEAP_MODEL, messages);
      await record(env.AI_CHEAP_MODEL, true, false, answer);
      return answer.text;
    } catch { await record(env.AI_CHEAP_MODEL, false, false); fallback = true; }
  }
  try {
    const answer = await ask(env, deps, env.AI_MODEL, messages);
    await record(env.AI_MODEL, true, fallback, answer);
    return answer.text;
  } catch (error) { await record(env.AI_MODEL, false, fallback); throw error; }
}

/** A call with what it is for - `completeAs("oversaet-tekster", true)(env, deps, messages)`. */
export const completeAs = (purpose: string, cheap = false) => (env: SagaEnv, deps: SagaDeps, messages: ChatMessage[]) => complete(env, deps, messages, { purpose, cheap });
