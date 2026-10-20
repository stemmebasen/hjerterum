/** Requested: "Cant we make it more simple and beautiful" - "Maybe just with a code". Signing in to the member area with a code
 * by e-mail and nothing else: the e-mail, then the code. Hjerterum's login (Clerk) already sends such codes; this only asks for
 * one and checks it, and the usual login with a password stays one click away. */

export type SignInAttempt = {
  status: string | null;
  createdSessionId: string | null;
  supportedFirstFactors?: Array<{ strategy: string; emailAddressId?: string }> | null;
  prepareFirstFactor(params: { strategy: "email_code"; emailAddressId: string }): Promise<SignInAttempt>;
  attemptFirstFactor(params: { strategy: "email_code"; code: string }): Promise<SignInAttempt>;
};

export type CodeLoginClerk = {
  client?: { signIn: { create(params: { identifier: string }): Promise<SignInAttempt> } } | null;
  setActive(params: { session: string | null }): Promise<void>;
};

/** signedIn: the browser already has a session (Clerk says "session_exists"), so the member can simply go on. */
/** notFound: there is no account with the e-mail yet - the member is offered to create one with it. */
export type Step = { ok: true; attempt: SignInAttempt } | { ok: false; message: string; signedIn?: true; notFound?: true };

/** Clerk's error codes, in plain words with what to do next. */
const MESSAGES: Record<string, string> = {
  form_identifier_not_found: "Der er endnu ingen bruger med den e-mail. Første gang opretter du dig - også hvis du allerede er medlem.",
  form_param_format_invalid: "Skriv en gyldig e-mail.",
  form_code_incorrect: "Koden passer ikke. Tjek den, og prøv igen.",
  verification_expired: "Koden er udløbet. Send en ny kode.",
  verification_failed: "Koden er prøvet for mange gange. Send en ny kode.",
  too_many_requests: "For mange forsøg lige nu. Vent et øjeblik, og prøv igen."
};

const errorCode = (error: unknown) => (error as { errors?: Array<{ code?: string }> } | null)?.errors?.[0]?.code;

/** A known code in plain words; any other with its code, so a screenshot says what went wrong. */
export function messageFor(error: unknown): string {
  const code = errorCode(error);
  if (code && MESSAGES[code]) return MESSAGES[code]!;
  console.warn("code_login_failed", error);
  return `Det gik ikke${code ? ` (${code})` : ""}. Prøv igen om lidt, eller log ind med adgangskode.`;
}

const failure = (error: unknown): Step => errorCode(error) === "session_exists"
  ? { ok: false, message: "Du er allerede logget ind.", signedIn: true }
  : errorCode(error) === "form_identifier_not_found" ? { ok: false, message: messageFor(error), notFound: true }
  : { ok: false, message: messageFor(error) };

export const looksLikeEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

/** Asks Clerk to send a code to the e-mail. */
export async function sendCode(clerk: CodeLoginClerk, email: string): Promise<Step> {
  if (!looksLikeEmail(email)) return { ok: false, message: MESSAGES.form_param_format_invalid! };
  const signIn = clerk.client?.signIn;
  if (!signIn) return { ok: false, message: "Login er ikke klar endnu. Genindlæs siden." };
  try {
    const attempt = await signIn.create({ identifier: email.trim() });
    const factor = attempt.supportedFirstFactors?.find(f => f.strategy === "email_code" && f.emailAddressId);
    if (!factor?.emailAddressId) return { ok: false, message: "Din konto kan ikke logge ind med en kode. Log ind med adgangskode i stedet." };
    return { ok: true, attempt: await attempt.prepareFirstFactor({ strategy: "email_code", emailAddressId: factor.emailAddressId }) };
  } catch (error) {
    return failure(error);
  }
}

/** Checks the code and, when it is right, signs the member in on this device. */
export async function checkCode(clerk: CodeLoginClerk, attempt: SignInAttempt, code: string): Promise<Step> {
  const digits = code.replace(/\D/g, "");
  if (digits.length !== 6) return { ok: false, message: "Koden har 6 cifre." };
  try {
    const done = await attempt.attemptFirstFactor({ strategy: "email_code", code: digits });
    if (done.status !== "complete" || !done.createdSessionId) return { ok: false, message: "Login kunne ikke gøres færdigt. Log ind med adgangskode i stedet." };
    await clerk.setActive({ session: done.createdSessionId });
    return { ok: true, attempt: done };
  } catch (error) {
    return failure(error);
  }
}
