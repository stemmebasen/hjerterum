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
  params: Record<string, string | number | boolean | null | undefined> = {},
  options: { idempotencyKey?: string; connectedAccount?: string } = {}
): Promise<T> {
  const encoded = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) encoded.set(key, String(value));
  }

  const url = method === "GET" && encoded.size > 0
    ? `${STRIPE_API}${path}?${encoded.toString()}`
    : `${STRIPE_API}${path}`;

  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${secretKey}`,
      ...(method === "POST"
        ? { "content-type": "application/x-www-form-urlencoded" }
        : {}),
      ...(options.idempotencyKey
        ? { "idempotency-key": options.idempotencyKey }
        : {}),
      ...(options.connectedAccount
        ? { "stripe-account": options.connectedAccount }
        : {})
    },
    ...(method === "POST" ? { body: encoded.toString() } : {})
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

export async function stripeV2Request<T>(
  secretKey: string,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
  options: { idempotencyKey?: string } = {}
): Promise<T> {
  const response = await fetch(`https://api.stripe.com/v2${path}`, {
    method,
    headers: {
      authorization: `Bearer ${secretKey}`,
      "stripe-version": "2026-08-26.dahlia",
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
      ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {})
    },
    ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {})
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const error = payload.error as Record<string, unknown> | undefined;
    const message = typeof error?.message === "string"
      ? error.message
      : `Stripe v2 request failed with ${response.status}`;
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
