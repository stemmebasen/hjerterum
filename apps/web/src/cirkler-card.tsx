import { useEffect, useState } from "react";
import { apiFetch, type ClerkBrowser } from "./clerk";

/** Requested: "På medlemssiden skal der stå et vindue: CIRKLER - Du er endnu ikke med i en cirkel - opret profil her /
 * Du er med i cirklen, <navn> - gå til CIRKLER". Hjerterum spørger CIRKLER live; intet gemmes hos Hjerterum. */
type Status = { profile: boolean; circle: string | null };

export async function openCirklerHandoff(clerk: ClerkBrowser): Promise<string | null> {
  try {
    const response = await apiFetch(clerk, "/api/integrations/cirkler/handoff", { method: "POST" });
    const body = await response.json().catch(() => ({})) as { url?: string; error?: string };
    if (response.ok && body.url) { window.location.assign(body.url); return null; }
    return body.error === "active_membership_required"
      ? "Gratis CIRKLER kræver et aktivt medlemskab med medlemsgoder. Du kan stadig tilmelde dig direkte på cirkler.net."
      : "Vi kunne ikke åbne CIRKLER lige nu. Prøv igen om lidt.";
  } catch {
    return "Vi kunne ikke åbne CIRKLER lige nu. Prøv igen om lidt.";
  }
}

export function CirklerCard({ clerk }: { clerk: ClerkBrowser }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    apiFetch(clerk, "/api/integrations/cirkler/status")
      .then(async (response) => { if (active && response.ok) setStatus(await response.json() as Status); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [clerk]);
  if (!status) return null;
  const open = async () => { setOpening(true); setProblem(await openCirklerHandoff(clerk)); setOpening(false); };
  return (
    <article className="lys-card cirkler-card">
      {/* Requested: "Brug logoet her til Cirkler i rette farve i et hjørne af kortet" - CIRKLER's own gold (#D9B35A). */}
      <span className="cirkler-logo" aria-hidden="true" />
      <p className="lys-kicker">CIRKLER</p>
      {status.circle ? <>
        <h2>Du er med i cirklen {status.circle}</h2>
        <p className="member-overview-more"><a className="lys-btn" href="https://cirkler.net" target="_blank" rel="noopener">Gå til CIRKLER</a></p>
      </> : status.profile ? <>
        <h2>Du har en profil og venter på en cirkel</h2>
        <p className="member-overview-more"><a className="lys-link" href="https://cirkler.net" target="_blank" rel="noopener">Gå til CIRKLER →</a></p>
      </> : <>
        <h2>Du er endnu ikke med i en cirkel</h2>
        <p className="lys-sub">Små, faste fællesskaber - gratis for medlemmer.</p>
        <p className="member-overview-more"><button className="lys-btn" onClick={() => void open()} disabled={opening}>{opening ? "Åbner CIRKLER …" : "Opret profil her"}</button></p>
      </>}
      {problem && <p className="lys-sub" role="alert">{problem}</p>}
    </article>
  );
}
