import { useEffect, useState } from "react";
import { apiFetch, type ClerkBrowser } from "./clerk";

/** Requested: "Saga løbende vurderer, at der ikke kommer for mange af samme type events i kalenderen" - and "Ja" to: say it to the
 * organiser at once, with better days; keeping the date is allowed, then the board looks at it (worker/event-variety.ts). */
export function EventVarietyNote({ clerk, title, description, startsAt, endsAt, bookingId }: {
  clerk: ClerkBrowser; title: string; description: () => string; startsAt: string | null; endsAt: string | null; bookingId: number | null;
}) {
  const [check, setCheck] = useState<{ label: string; problems: string[]; alternatives: string[] } | null>(null);
  useEffect(() => {
    if (!title.trim() || !startsAt) { setCheck(null); return; }
    let live = true;
    const timer = window.setTimeout(() => {
      void apiFetch(clerk, "/api/members/event-variety", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, description: description(), startsAt, endsAt, bookingId }) })
        .then(async r => { if (live && r.ok) setCheck(await r.json()); }).catch(() => undefined);
    }, 600);
    return () => { live = false; window.clearTimeout(timer); };
  }, [clerk, title, startsAt, endsAt, bookingId, description]);
  if (!check?.problems.length) return null;
  return <div className="event-variety" role="status">
    <p className="lys-kicker">Variation i kalenderen · {check.label}</p>
    {check.problems.map(p => <p key={p}>{p}</p>)}
    {check.alternatives.length > 0 && <p>Ledige dage med mindre {check.label}: <b>{check.alternatives.join(" · ")}</b></p>}
    <small>Du kan godt beholde datoen - så ser bestyrelsen på eventet, før det kommer online.</small>
  </div>;
}
