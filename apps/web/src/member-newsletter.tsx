import { useEffect, useState } from "react";
import { apiFetch, type ClerkBrowser } from "./clerk";

/** Requested: "Jeg vil gerne have at alle modtagere gemmes samlet i vores Mailchimp konto" - "Alt med samtykke i én liste". In Min profil the member
 * turns "Månedens events" on or off; on puts them in Hjerterum's Mailchimp list with the tag "Medlem" (worker/mailchimp-sync.ts). */
export function MemberNewsletter({ clerk }: { clerk: ClerkBrowser }) {
  const [state, setState] = useState<{ subscribed: boolean; connected: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    apiFetch(clerk, "/api/members/me/newsletter").then(async r => { if (active && r.ok) setState(await r.json() as { subscribed: boolean; connected: boolean }); }).catch(() => undefined);
    return () => { active = false; };
  }, [clerk]);
  if (!state) return null;
  const change = async (subscribe: boolean) => {
    setBusy(true); setError("");
    const r = await apiFetch(clerk, "/api/members/me/newsletter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subscribe }) }).catch(() => null);
    if (r?.ok) setState({ ...state, subscribed: subscribe });
    else setError("Det kunne ikke ændres lige nu. Prøv igen om lidt.");
    setBusy(false);
  };
  return <section className="profile-newsletter" aria-label="Nyhedsbrev">
    <div><p className="kicker">Nyhedsbrev</p><h3>Månedens events</h3>
      <p>Én mail om måneden med det, der sker i Hjerterum.{state.subscribed ? " Du får den." : ""}</p></div>
    <label className="profile-newsletter-switch"><input id="newsletter-switch" type="checkbox" checked={state.subscribed} disabled={busy} onChange={e => void change(e.target.checked)} />
      <span>{state.subscribed ? "Til" : "Fra"}</span></label>
    {error && <p className="profile-newsletter-error" role="alert">{error}</p>}
  </section>;
}
