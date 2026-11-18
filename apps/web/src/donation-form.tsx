import { useEffect, useState } from "react";

/** Douglas (13 Nov 2026), for the board: "a donation page ... Plus an email that gets sent as a receipt" (worker/donations.ts). A card donation
 * once Stripe is connected; MobilePay and the bank stand in the page's text in any case. */
const AMOUNTS = [100, 250, 500, 1000];

export function DonationForm() {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(250);
  const [other, setOther] = useState("");
  const [state, setState] = useState<{ busy?: boolean; error?: string }>({});
  const thanks = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tak") === "1";
  useEffect(() => {
    let active = true;
    fetch("/api/client-config", { headers: { accept: "application/json" } }).then(r => r.json()).then((c: { donations?: boolean }) => { if (active) setOpen(c.donations === true); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  if (thanks) return <div className="donation-form" role="status"><h3>Tusind tak for din donation ♡</h3><p>Kvitteringen er sendt til din e-mail.</p></div>;
  if (!open) return null;
  const chosen = other.trim() ? Math.round(Number(other.replace(",", "."))) : amount;
  const submit = async (form: HTMLFormElement) => {
    const data = new FormData(form);
    setState({ busy: true });
    const r = await fetch("/api/donations", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: data.get("name"), email: data.get("email"), message: data.get("message"), amountKr: chosen }) }).catch(() => null);
    const body = r ? await r.json().catch(() => ({})) as { checkoutUrl?: string; error?: string } : {};
    if (r?.ok && body.checkoutUrl) { window.location.assign(body.checkoutUrl); return; }
    setState({ error: body.error === "invalid_amount" ? "Beløbet skal være mellem 20 og 50.000 kr." : body.error === "missing_fields" ? "Skriv dit navn og en gyldig e-mail." : "Donationen kunne ikke startes lige nu. Prøv igen om lidt." });
  };
  return <form className="donation-form" onSubmit={e => { e.preventDefault(); void submit(e.currentTarget); }}>
    <h3>Giv en donation med kort</h3>
    <div className="donation-amounts" role="radiogroup" aria-label="Beløb">
      {AMOUNTS.map(a => <button type="button" key={a} className={!other && a === amount ? "is-on" : ""} aria-pressed={!other && a === amount} onClick={() => { setAmount(a); setOther(""); }}>{a.toLocaleString("da-DK")} kr.</button>)}
      <label>Andet beløb<input inputMode="numeric" value={other} onChange={e => setOther(e.target.value)} placeholder="kr." /></label>
    </div>
    <label>Navn<input name="name" required maxLength={120} autoComplete="name" /></label>
    <label>E-mail (til kvitteringen)<input name="email" type="email" required maxLength={200} autoComplete="email" /></label>
    <label>En hilsen (valgfri)<textarea name="message" rows={2} maxLength={500} /></label>
    {state.error && <p className="event-guest-error" role="alert">{state.error}</p>}
    <button className="lys-btn" disabled={state.busy || !Number.isFinite(chosen) || chosen < 20}>{state.busy ? "Åbner betalingen …" : `Donér ${Number.isFinite(chosen) ? chosen.toLocaleString("da-DK") : ""} kr.`}</button>
    <small>Du betaler sikkert med kort hos Stripe og får en kvittering på mail.</small>
  </form>;
}
