import { useRef, useState, type FormEvent } from "react";
import { checkCode, sendCode, type CodeLoginClerk, type SignInAttempt } from "./code-login";

/** The member area's sign-in: the e-mail, then the code that arrives by mail (code-login.ts). */
export function CodeSignIn({ clerk, signedIn, redirectUrl, onPassword }: { clerk: CodeLoginClerk; signedIn: boolean; redirectUrl?: string | undefined; onPassword: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [attempt, setAttempt] = useState<SignInAttempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newHere, setNewHere] = useState(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const target = redirectUrl ?? "/member-portal";

  if (signedIn) return <div className="code-signin">
    <p className="lys-kicker">Medlemsområde</p>
    <h1>Du er logget ind</h1>
    <p className="code-signin-lead">Gå videre til medlemsområdet.</p>
    <a className="lys-btn code-signin-btn" href={target}>Åbn medlemsområdet</a>
  </div>;

  const ask = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    const sent = await sendCode(clerk, email);
    if (!sent.ok && sent.signedIn) return window.location.assign(target);
    setBusy(false);
    setNewHere(!sent.ok && sent.notFound === true);
    if (!sent.ok) return setError(sent.message);
    setAttempt(sent.attempt);
    setCode("");
    if (attempt) setNotice("Vi har sendt en ny kode.");
    requestAnimationFrame(() => codeInput.current?.focus());
  };

  const check = async (value: string) => {
    if (!attempt || busy) return;
    setBusy(true); setError("");
    const done = await checkCode(clerk, attempt, value);
    if (!done.ok && done.signedIn) return window.location.assign(target);
    if (!done.ok) { setBusy(false); setError(done.message); return; }
    window.location.assign(target);
  };

  if (!attempt) return <form className="code-signin" onSubmit={ask} noValidate>
    <p className="lys-kicker">Medlemsområde</p>
    <h1>Log ind</h1>
    <p className="code-signin-lead">Skriv din e-mail, så sender vi dig en kode. Du skal ikke bruge en adgangskode.</p>
    <label className="code-signin-field">E-mail
      <input id="code-signin-email" type="email" inputMode="email" autoComplete="email" autoFocus required value={email} onChange={event => setEmail(event.target.value)} placeholder="din@mail.dk" />
    </label>
    {error && <p className="code-signin-error" role="alert">{error}</p>}
    {/* Reported: Gitta, a member, got "Vi kan ikke finde en konto med den e-mail" - members from MembershipWorks have no login here until they create one. */}
    {newHere && <a className="lys-btn code-signin-btn" href={`/sign-up?email=${encodeURIComponent(email.trim())}`}>Opret dig med {email.trim()}</a>}
    <button className={"lys-btn code-signin-btn" + (newHere ? " ghost" : "")} type="submit" disabled={busy}>{busy ? "Sender …" : "Send mig en kode"}</button>
    <p className="code-signin-foot">
      <button type="button" className="code-signin-link" onClick={onPassword}>Log ind med adgangskode</button>
      <a className="code-signin-link" href="/sign-up">Ny her? Opret dig</a>
    </p>
  </form>;

  return <form className="code-signin" onSubmit={event => { event.preventDefault(); void check(code); }} noValidate>
    <p className="lys-kicker">Medlemsområde</p>
    <h1>Tjek din mail</h1>
    <p className="code-signin-lead">Vi har sendt en kode til <b>{email.trim()}</b>. Skriv den her.</p>
    <label className="code-signin-field">Kode
      <input id="code-signin-code" ref={codeInput} className="code-signin-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} placeholder="••••••"
        onChange={event => {
          const value = event.target.value.replace(/\D/g, "").slice(0, 6);
          setCode(value);
          if (value.length === 6) void check(value);
        }} />
    </label>
    {error && <p className="code-signin-error" role="alert">{error}</p>}
    {notice && !error && <p className="code-signin-notice" role="status">{notice}</p>}
    <button className="lys-btn code-signin-btn" type="submit" disabled={busy || code.length !== 6}>{busy ? "Logger ind …" : "Log ind"}</button>
    <p className="code-signin-foot">
      <button type="button" className="code-signin-link" onClick={() => void ask()} disabled={busy}>Send en ny kode</button>
      <button type="button" className="code-signin-link" onClick={() => { setAttempt(null); setError(""); setNotice(""); }}>Brug en anden e-mail</button>
    </p>
    <p className="code-signin-hint">Kan du ikke finde mailen? Kig i spam, eller <button type="button" className="code-signin-link" onClick={onPassword}>log ind med adgangskode</button>.</p>
  </form>;
}
