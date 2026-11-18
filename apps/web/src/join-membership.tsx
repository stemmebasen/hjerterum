import { useEffect, useState, type ReactNode } from "react";
import { MEMBERSHIP_TIERS, membershipPlans, membershipPrice, type MembershipTier } from "../membership";
import { apiFetch, type ClerkBrowser, type ClerkUser } from "./clerk";

/** Douglas (13 Nov 2026), for the board: "When a new member signs up, is there somewhere on the form where they click to accept the conditions or
 * terms?" Joining here: the membership and how often to pay, the trial, the terms to accept, then the card at Stripe. Shown once Stripe is
 * connected (/api/client-config membershipCheckout); until then `fallback` - the way into the old system - is shown as before. */
export function JoinMembership({ clerk, user, fallback }: { clerk: ClerkBrowser; user: ClerkUser; fallback: ReactNode }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const [tier, setTier] = useState<MembershipTier>("standard");
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [accepted, setAccepted] = useState(false);
  const [state, setState] = useState<{ busy?: boolean; error?: string }>({});
  useEffect(() => {
    let active = true;
    fetch("/api/client-config", { headers: { accept: "application/json" } }).then(r => r.json()).then((c: { membershipCheckout?: boolean }) => { if (active) setOpen(c.membershipCheckout === true); }).catch(() => { if (active) setOpen(false); });
    return () => { active = false; };
  }, []);
  if (open === null) return null;
  if (!open) return <>{fallback}</>;
  const plan = membershipPlans[tier];
  const join = async () => {
    if (!accepted) { setState({ error: "Sæt kryds ved vilkårene for at fortsætte." }); return; }
    setState({ busy: true });
    const response = await apiFetch(clerk, "/api/members/checkout", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tier, interval, acceptedTerms: true, fullName: user.fullName || [user.firstName, user.lastName].filter(Boolean).join(" ") || "Medlem", email: user.primaryEmailAddress?.emailAddress ?? "" }) }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) as { checkoutUrl?: string } : {};
    if (response?.ok && body.checkoutUrl) { window.location.assign(body.checkoutUrl); return; }
    setState({ error: "Indmeldelsen kunne ikke startes lige nu. Prøv igen om lidt, eller skriv til os." });
  };
  return <section className="workspace-section member-page join-membership">
    <p className="kicker">Bliv medlem</p><h2>Vælg dit medlemskab</h2>
    <div className="join-plans" role="radiogroup" aria-label="Medlemskab">
      {MEMBERSHIP_TIERS.map(t => { const p = membershipPlans[t]; return <label key={t} className={"join-plan" + (t === tier ? " is-on" : "")}>
        <input type="radio" name="tier" checked={t === tier} onChange={() => setTier(t)} />
        <b>{p.name}</b><span>{membershipPrice(p.month)} pr. måned · {membershipPrice(p.year)} pr. år</span><small>{p.description}</small>
      </label>; })}
    </div>
    <div className="join-interval" role="radiogroup" aria-label="Betaling">
      <label><input type="radio" name="interval" checked={interval === "month"} onChange={() => setInterval("month")} /> Hver måned ({membershipPrice(plan.month)})</label>
      <label><input type="radio" name="interval" checked={interval === "year"} onChange={() => setInterval("year")} /> Hvert år ({membershipPrice(plan.year)}{plan.month * 12 > plan.year ? `, spar ${membershipPrice(plan.month * 12 - plan.year)}` : ""})</label>
    </div>
    {plan.trialDays > 0 && <p className="join-trial">De første {plan.trialDays} dage er gratis, hvis du melder dig ind for første gang.</p>}
    <label className="join-terms"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />
      <span>Jeg har læst og accepterer <a href="https://www.hjerterum.info/medlemskab/vilkaar" target="_blank" rel="noreferrer">vilkårene for medlemskab</a> og <a href="https://www.hjerterum.info/handelsbetingelser" target="_blank" rel="noreferrer">handelsbetingelserne</a>.</span></label>
    {state.error && <p className="workspace-message" role="alert">{state.error}</p>}
    <button type="button" className="pill-button dark" disabled={state.busy || !accepted} onClick={() => void join()}>{state.busy ? "Åbner betalingen …" : "Fortsæt til betaling"}</button>
  </section>;
}
