import { useEffect, useState, type ReactNode } from "react";
import { apiFetch, type ClerkBrowser } from "./clerk";
import { openCirklerHandoff } from "./cirkler-card";

/** Requested (2 November 2026): under every event in the hall - "Inviter din CIRKEL med". Member of a circle: a box with the event, the circle's
 * name and a field to write in; the message lands in the circle's chat in CIRKLER with the event's picture, short description and link
 * (worker/cirkler-integration.ts → cirkler.net). Not in a circle yet: "Du er ikke medlem af en CIRKEL endnu - klik her for at blive det". */

type Shown = { title: string; startsAt: string; imageUrl: string | null; url: string };
type Status = { profile: boolean; circle: string | null };
const WHEN = new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

async function loadEvent(id: string): Promise<Shown | null> {
  const own = /^h(\d+)$/.exec(id);
  if (!own && !/^[0-9a-f]{24}$/.test(id)) return null;
  const r = await fetch(own ? `/api/room-bookings/public/${own[1]}` : `/api/events/external/${id}`).catch(() => null);
  if (!r?.ok) return null;
  const e = await r.json() as { title: string; startsAt: string; imageUrl?: string | null };
  return { title: e.title, startsAt: e.startsAt, imageUrl: e.imageUrl ?? null, url: `https://www.hjerterum.info/events/${id}` };
}

export function CirkelInvite({ clerk }: { clerk: ClerkBrowser }) {
  const id = new URLSearchParams(window.location.search).get("event") ?? "";
  const [event, setEvent] = useState<Shown | null | undefined>(undefined);
  const [status, setStatus] = useState<Status | "member_only" | "unavailable" | null>(null);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<{ busy?: boolean; sent?: string; error?: string }>({});
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void loadEvent(id).then(e => { if (active) setEvent(e); });
    apiFetch(clerk, "/api/integrations/cirkler/status").then(async r => {
      if (!active) return;
      if (r.status === 403) setStatus("member_only");
      else if (r.ok) setStatus(await r.json() as Status);
      else setStatus("unavailable");
    }).catch(() => { if (active) setStatus("unavailable"); });
    return () => { active = false; };
  }, [clerk, id]);

  const send = async () => {
    setState({ busy: true });
    const r = await apiFetch(clerk, "/api/integrations/cirkler/invite", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: id, message }) }).catch(() => null);
    const body = r ? await r.json().catch(() => ({})) as { circle?: string | null; error?: string } : {};
    if (r?.ok) setState({ sent: body.circle || (typeof status === "object" && status?.circle) || "din cirkel" });
    else setState({ error: body.error === "no_circle" || body.error === "no_profile" ? "Du er ikke med i en cirkel lige nu." : body.error === "event_not_found" ? "Eventet findes ikke længere eller er allerede begyndt." : "Beskeden kunne ikke sendes lige nu. Prøv igen om lidt." });
  };

  const back = event ? <a className="lys-link" href={event.url}>← Tilbage til eventet</a> : <a className="lys-link" href="https://www.hjerterum.info/events">← Kalenderen</a>;
  const card = event && <div className="cirkel-invite-event">
    {event.imageUrl && <img src={event.imageUrl} alt="" />}
    <div><p className="kicker">{WHEN.format(new Date(event.startsAt)).replace(/(\d{2})[.:](\d{2})$/, "kl. $1.$2")}</p><h2>{event.title}</h2></div>
  </div>;
  let content: ReactNode;
  if (event === null) content = <p>Eventet findes ikke længere.</p>;
  else if (!status || event === undefined) content = <p className="muted">Henter …</p>;
  else if (status === "member_only") content = <p>CIRKLER er for medlemmer af Hjerterum. <a className="lys-link" href="https://www.hjerterum.info/medlemskab">Bliv medlem →</a></p>;
  else if (status === "unavailable") content = <p>CIRKLER svarer ikke lige nu. Prøv igen om lidt.</p>;
  else if (!status.circle) content = <div className="cirkel-invite-none"><p>Du er ikke medlem af en CIRKEL endnu.</p>
    <button type="button" className="pill-button dark" onClick={() => void openCirklerHandoff(clerk).then(setProblem)}>Klik her for at blive det</button>{problem && <p className="muted">{problem}</p>}</div>;
  else if (state.sent) content = <div className="cirkel-invite-sent" role="status"><b>Sendt til {state.sent}.</b><p>Beskeden og eventet ligger nu i jeres chat i CIRKLER.</p></div>;
  else content = <form className="cirkel-invite-form" onSubmit={e => { e.preventDefault(); void send(); }}>
    <p className="cirkel-invite-to">Til: <b>{status.circle}</b> <span className="muted">· cirklens chat i CIRKLER</span></p>
    <label htmlFor="cirkel-message">Din besked</label>
    <textarea id="cirkel-message" rows={4} maxLength={1200} value={message} onChange={e => setMessage(e.target.value)} placeholder="Fx: Skal vi tage med til det her sammen? Jeg har lyst!" />
    <p className="muted small">Beskeden lander i cirklens chat med eventets billede, en kort beskrivelse og et link.</p>
    {state.error && <p className="cirkel-invite-error" role="alert">{state.error}</p>}
    <button className="pill-button dark" disabled={state.busy}>{state.busy ? "Sender …" : `Send til ${status.circle}`}</button>
  </form>;
  return <section className="workspace-section member-page workspace-narrow cirkel-invite">
    <p>{back}</p>
    <p className="kicker">CIRKLER</p><h1>Inviter din CIRKEL med</h1>
    {card}
    {content}
  </section>;
}
