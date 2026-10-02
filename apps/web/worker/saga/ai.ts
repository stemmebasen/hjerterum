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
export async function complete(env: SagaEnv, deps: SagaDeps, messages: ChatMessage[]): Promise<string> {
  if (!env.AI_API_KEY || !env.AI_MODEL) throw new Error("ai_not_configured");
  const base = (env.AI_BASE_URL || REQUESTY_EU).replace(/\/+$/, "");
  const response = await deps.fetcher(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.AI_API_KEY}` },
    // Claude takes no sampling settings (Sonnet 5.5 refuses them) and needs room for a whole referat.
    body: JSON.stringify(isClaude(env.AI_MODEL) ? { model: env.AI_MODEL, messages, max_tokens: 16000 } : { model: env.AI_MODEL, messages, temperature: 0.2 })
  });
  const data = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } | string } | null;
  const text = data?.choices?.[0]?.message?.content?.trim();
  // The chair's page shows whether Saga's AI answers, and what the provider said when it did not.
  const said = typeof data?.error === "string" ? data.error : data?.error?.message ?? "";
  if (env.DB) await setServiceStatus(env.DB, "ai", Boolean(response.ok && text), response.ok && text ? "" : `${response.status} ${said}`.trim(), deps.now());
  if (!response.ok || !text) throw new Error(`ai_request_failed: ${response.status}`);
  return text;
}
