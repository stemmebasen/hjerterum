import { useEffect, useState } from "react";
import { membershipName, membershipPlans, membershipPrice, type MembershipTier } from "../membership";
import { apiFetch, type ClerkBrowser } from "./clerk";

/** Douglas (13 Nov 2026), for the board: only the paid levels are offered (never the free one), and the change happens at the next renewal
 * (worker/membership-change.ts). */
export function ChangePlan({ clerk }: { clerk: ClerkBrowser }) {
  const [data, setData] = useState<{ current: string | null; pending: string | null; options: MembershipTier[] } | null>(null);
  const [choice, setChoice] = useState<MembershipTier | "">("");
  const [state, setState] = useState<{ busy?: boolean; text?: string }>({});
  useEffect(() => {
    let active = true;
    apiFetch(clerk, "/api/members/me/plan").then(async r => { if (active && r.ok) setData(await r.json()); }).catch(() => undefined);
    return () => { active = false; };
  }, [clerk]);
  if (!data || !data.options.length) return null;
  const change = async () => {
    if (!choice) return;
    setState({ busy: true });
    const r = await apiFetch(clerk, "/api/members/me/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tier: choice }) }).catch(() => null);
    const body = r ? await r.json().catch(() => ({})) as { via?: string } : {};
    if (r?.ok) {
      setData({ ...data, pending: choice });
      setState({ text: body.via === "card" ? `Du skifter til ${membershipName(choice)} fra din næste fornyelse.` : `Tak - dit ønske om at skifte til ${membershipName(choice)} er sendt til os. Skiftet sker fra din næste fornyelse, og du får svar på mail.` });
    } else setState({ text: "Skiftet kunne ikke gennemføres lige nu. Prøv igen om lidt, eller skriv til os." });
  };
  return <div className="workspace-card change-plan">
    <h2>Skift medlemskab</h2>
    {data.pending && <p className="lys-chip clay">Skifter til {membershipName(data.pending)} fra næste fornyelse</p>}
    <p>Skiftet sker fra din næste fornyelse - indtil da fortsætter dit nuværende medlemskab.</p>
    <label>Nyt medlemskab<select value={choice} onChange={e => setChoice(e.target.value as MembershipTier)}>
      <option value="">Vælg …</option>
      {data.options.map(t => <option key={t} value={t}>{membershipPlans[t].name} - {membershipPrice(membershipPlans[t].month)}/md. eller {membershipPrice(membershipPlans[t].year)}/år</option>)}
    </select></label>
    <div className="workspace-actions"><button type="button" className="pill-button dark" disabled={!choice || state.busy} onClick={() => void change()}>{state.busy ? "Gemmer …" : "Skift fra næste fornyelse"}</button></div>
    {state.text && <p className="workspace-message" role="status">{state.text}</p>}
  </div>;
}
