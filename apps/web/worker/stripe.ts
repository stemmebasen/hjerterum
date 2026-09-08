const STRIPE_API = "https://api.stripe.com/v1";

export type StripeEvent = {
  id: string;
  type: string;
  data?: {
    object?: Record<string, unknown>;
  };
};

export async function stripeRequest<T>(
  secretKey: string,
  method: "GET" | "POST",
  path: string,
  params: Record<string, string | number | boolean | null | undefined> = {}
): Promise<T> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) body.set(key, String(value));
  }

  const response = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${secretKey}`,
      ...(method === "POST"
        ? { "content-type": "application/x-www-form-urlencoded" }
        : {})
    },
    ...(method === "POST" ? { body: body.toString() } : {})
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const stripeError = payload.error as Record<string, unknown> | undefined;
    const message =
      typeof stripeError?.message === "string"
        ? stripeError.message
        : `Stripe request failed with ${response.status}`;
    throw new Error(`stripe_request_failed:${message}`);
  }
  return payload as T;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyStripeWebhook(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string,
  toleranceSeconds = 300
): Promise<StripeEvent> {
  if (!signatureHeader) throw new Error("stripe_signature_missing");

  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const [key, value] = part.trim().split("=", 2);
    if (key === "t" && value) timestamp = Number(value);
    if (key === "v1" && value) signatures.push(value);
  }

  if (!Number.isFinite(timestamp) || signatures.length === 0) {
    throw new Error("stripe_signature_invalid");
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - (timestamp as number)) > toleranceSeconds) {
    throw new Error("stripe_signature_stale");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`)
  );
  const expected = bufferToHex(digest);
  if (!signatures.some((candidate) => constantTimeEqual(candidate, expected))) {
    throw new Error("stripe_signature_invalid");
  }

  const event = JSON.parse(rawBody) as StripeEvent;
  if (!event.id || !event.type) throw new Error("stripe_event_invalid");
  return event;
}
