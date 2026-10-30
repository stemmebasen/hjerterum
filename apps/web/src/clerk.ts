import { CLERK_LOCALIZATION } from "./clerk-localization";
import type { CodeLoginClerk } from "./code-login";

export type ClerkSession = {
  getToken(options?: { skipCache?: boolean }): Promise<string | null>;
};

export type ClerkUser = {
  id: string;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** False when the member has not uploaded a photo, so Clerk shows its generated placeholder. */
  hasImage?: boolean;
  primaryEmailAddress?: { emailAddress?: string | null } | null;
};

export type ClerkState = {
  session?: ClerkSession | null;
  user?: ClerkUser | null;
};

export type ClerkBrowser = CodeLoginClerk & {
  load(options?: Record<string, unknown>): Promise<void>;
  session?: ClerkSession | null;
  user?: ClerkUser | null;
  isSignedIn?: boolean;
  addListener(callback: (state: ClerkState) => void): () => void;
  mountSignIn(node: HTMLDivElement, props?: Record<string, unknown>): void;
  unmountSignIn(node: HTMLDivElement): void;
  mountSignUp(node: HTMLDivElement, props?: Record<string, unknown>): void;
  unmountSignUp(node: HTMLDivElement): void;
  mountUserButton(node: HTMLDivElement, props?: Record<string, unknown>): void;
  unmountUserButton(node: HTMLDivElement): void;
};

declare global {
  interface Window {
    Clerk?: ClerkBrowser;
    __internal_ClerkUICtor?: unknown;
  }
}

type ClientConfig = {
  clerkPublishableKey?: string;
};

let clerkPromise: Promise<ClerkBrowser | null> | null = null;

function loadScript(src: string, attributes: Record<string, string> = {}): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing?.dataset.loaded === "true") return Promise.resolve();

  return new Promise((resolve, reject) => {
    const script = existing ?? document.createElement("script");
    if (!existing) {
      script.src = src;
      script.async = true;
      script.crossOrigin = "anonymous";
      for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
      document.head.appendChild(script);
    }
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => reject(new Error("clerk_script_failed")), { once: true });
  });
}

function clerkDomainFromPublishableKey(publishableKey: string): string {
  const encoded = publishableKey.split("_")[2];
  if (!encoded) throw new Error("clerk_publishable_key_invalid");
  const decoded = atob(encoded);
  const domain = decoded.endsWith("$") ? decoded.slice(0, -1) : decoded;
  if (!domain || domain.includes("/") || domain.includes(" ")) {
    throw new Error("clerk_publishable_key_invalid");
  }
  return domain;
}

async function initializeClerk(): Promise<ClerkBrowser | null> {
  const configResponse = await fetch("/api/client-config", { headers: { accept: "application/json" } });
  if (!configResponse.ok) return null;
  const config = (await configResponse.json()) as ClientConfig;
  if (!config.clerkPublishableKey) return null;

  const domain = clerkDomainFromPublishableKey(config.clerkPublishableKey);
  await loadScript(`https://${domain}/npm/@clerk/ui@1/dist/ui.browser.js`);
  await loadScript(
    `https://${domain}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`,
    { "data-clerk-publishable-key": config.clerkPublishableKey }
  );

  if (!window.Clerk) throw new Error("clerk_global_missing");
  await window.Clerk.load({
    ui: { ClerkUI: window.__internal_ClerkUICtor },
    localization: CLERK_LOCALIZATION,
    appearance: { variables: {
      // The login card's own type and fields (lys-spa.css .code-signin), so Clerk's forms look like the code login.
      fontFamily: "var(--lys-sans, Inter, system-ui, sans-serif)",
      colorPrimary: "var(--profile-button)",
      colorPrimaryForeground: "var(--profile-button-ink)",
      colorBackground: "var(--profile-surface)",
      colorForeground: "var(--ink)",
      colorMutedForeground: "var(--muted)",
      colorInput: "var(--lys-bg, var(--profile-surface))",
      colorInputForeground: "var(--ink)",
      colorBorder: "var(--profile-line)",
      borderRadius: "0.75rem"
    } },
    signInUrl: "/sign-in",
    signUpUrl: "/sign-up",
    signInFallbackRedirectUrl: "/member-portal/",
    signUpFallbackRedirectUrl: "/member-portal/"
  });
  return window.Clerk;
}

export function loadClerk(): Promise<ClerkBrowser | null> {
  clerkPromise ??= initializeClerk();
  return clerkPromise;
}

export async function apiFetch(
  clerk: ClerkBrowser | null,
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const token = await clerk?.session?.getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
