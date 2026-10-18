import { describe, expect, it } from "vitest";
import { checkCode, sendCode, type CodeLoginClerk, type SignInAttempt } from "./code-login";

// The member area's sign-in with a code by e-mail.

function fakeClerk(options: { known?: boolean; code?: string } = {}) {
  const calls: string[] = [];
  let active: string | null = null;
  const attempt: SignInAttempt = {
    status: "needs_first_factor", createdSessionId: null,
    supportedFirstFactors: [{ strategy: "password" }, { strategy: "email_code", emailAddressId: "idn_1" }],
    async prepareFirstFactor(p) { calls.push(`prepare ${p.strategy} ${p.emailAddressId}`); return attempt; },
    async attemptFirstFactor(p) {
      calls.push(`attempt ${p.code}`);
      if (p.code !== (options.code ?? "123456")) throw { errors: [{ code: "form_code_incorrect" }] };
      return { ...attempt, status: "complete", createdSessionId: "sess_1" };
    }
  };
  const clerk: CodeLoginClerk = {
    client: { signIn: { async create(p) { calls.push(`create ${p.identifier}`); if (options.known === false) throw { errors: [{ code: "form_identifier_not_found" }] }; return attempt; } } },
    async setActive(p) { active = p.session; }
  };
  return { clerk, calls, active: () => active };
}

describe("signing in with a code", () => {
  it("sends a code to the e-mail, and signs in with the right code", async () => {
    const { clerk, calls, active } = fakeClerk();
    const sent = await sendCode(clerk, " jacob@example.dk ");
    expect(sent.ok).toBe(true);
    expect(calls).toEqual(["create jacob@example.dk", "prepare email_code idn_1"]);
    const wrong = await checkCode(clerk, (sent as { attempt: SignInAttempt }).attempt, "654321");
    expect(wrong).toEqual({ ok: false, message: "Koden passer ikke. Tjek den, og prøv igen." });
    expect(active()).toBeNull();
    const right = await checkCode(clerk, (sent as { attempt: SignInAttempt }).attempt, "123 456");
    expect(right.ok).toBe(true);
    expect(active()).toBe("sess_1");
  });

  it("lets a member who is already signed in go on, and names any other error's code", async () => {
    const already: CodeLoginClerk = { client: { signIn: { async create() { throw { errors: [{ code: "session_exists" }] }; } } }, async setActive() {} };
    expect(await sendCode(already, "jacob@example.dk")).toEqual({ ok: false, message: "Du er allerede logget ind.", signedIn: true });
    const odd: CodeLoginClerk = { client: { signIn: { async create() { throw { errors: [{ code: "strange_thing" }] }; } } }, async setActive() {} };
    expect(await sendCode(odd, "jacob@example.dk")).toEqual({ ok: false, message: "Det gik ikke (strange_thing). Prøv igen om lidt, eller log ind med adgangskode." });
  });

  it("says what to do when the e-mail is unknown, wrongly written, or the code is short", async () => {
    expect(await sendCode(fakeClerk({ known: false }).clerk, "ny@example.dk")).toEqual({ ok: false, message: "Vi kan ikke finde en konto med den e-mail. Er du ny i Hjerterum, så opret dig først." });
    expect(await sendCode(fakeClerk().clerk, "ikke en mail")).toEqual({ ok: false, message: "Skriv en gyldig e-mail." });
    const { clerk } = fakeClerk();
    const sent = await sendCode(clerk, "jacob@example.dk");
    expect(await checkCode(clerk, (sent as { attempt: SignInAttempt }).attempt, "123")).toEqual({ ok: false, message: "Koden har 6 cifre." });
  });
});
