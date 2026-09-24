import type { SagaDeps, SagaEnv } from "./env.js";
import { setServiceStatus } from "./store.js";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** OpenAI-compatible chat completions - the provider stays behind this one function. */
export async function complete(env: SagaEnv, deps: SagaDeps, messages: ChatMessage[]): Promise<string> {
  if (!env.AI_API_KEY || !env.AI_MODEL) throw new Error("ai_not_configured");
  const base = (env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const response = await deps.fetcher(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.AI_API_KEY}` },
    body: JSON.stringify({ model: env.AI_MODEL, messages, temperature: 0.2 })
  });
  const data = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } | string } | null;
  const text = data?.choices?.[0]?.message?.content?.trim();
  // The chair's page shows whether Saga's AI answers, and what the provider said when it did not.
  const said = typeof data?.error === "string" ? data.error : data?.error?.message ?? "";
  if (env.DB) await setServiceStatus(env.DB, "ai", Boolean(response.ok && text), response.ok && text ? "" : `${response.status} ${said}`.trim(), deps.now());
  if (!response.ok || !text) throw new Error(`ai_request_failed: ${response.status}`);
  return text;
}
