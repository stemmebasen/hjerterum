import type { SagaDeps, SagaEnv } from "./env.js";
import { setServiceStatus } from "./store.js";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** Requested: "Saga skal bruge Requesty API fremover". Requesty's EU router (OpenAI-compatible chat
 * completions) is the default; AI_BASE_URL only overrides it. The provider stays behind this one function. */
export const REQUESTY_EU = "https://router.eu.requesty.ai/v1";
export async function complete(env: SagaEnv, deps: SagaDeps, messages: ChatMessage[]): Promise<string> {
  if (!env.AI_API_KEY || !env.AI_MODEL) throw new Error("ai_not_configured");
  const base = (env.AI_BASE_URL || REQUESTY_EU).replace(/\/+$/, "");
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
