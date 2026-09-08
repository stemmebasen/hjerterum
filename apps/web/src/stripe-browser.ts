export type StripeElement = {
  mount(selectorOrElement: string | HTMLElement): void;
  destroy(): void;
};

export type StripeElements = {
  create(type: "payment", options?: Record<string, unknown>): StripeElement;
  submit(): Promise<{ error?: { message?: string } }>;
};

export type StripeClient = {
  elements(options: { clientSecret: string; appearance?: Record<string, unknown> }): StripeElements;
  confirmSetup(options: {
    elements: StripeElements;
    confirmParams: { return_url: string };
    redirect?: "always" | "if_required";
  }): Promise<{
    error?: { message?: string };
    setupIntent?: { status?: string };
  }>;
};

declare global {
  interface Window {
    Stripe?: (publishableKey: string) => StripeClient;
  }
}

let stripeScriptPromise: Promise<void> | null = null;

function ensureStripeScript(): Promise<void> {
  if (window.Stripe) return Promise.resolve();
  stripeScriptPromise ??= new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://js.stripe.com/v3/"]');
    const script = existing ?? document.createElement("script");
    if (!existing) {
      script.src = "https://js.stripe.com/v3/";
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("stripe_script_failed")), { once: true });
  });
  return stripeScriptPromise;
}

export async function loadStripeClient(publishableKey: string): Promise<StripeClient> {
  await ensureStripeScript();
  if (!window.Stripe) throw new Error("stripe_global_missing");
  return window.Stripe(publishableKey);
}
