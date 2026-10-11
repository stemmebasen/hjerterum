import { useEffect, useState, type ReactNode } from "react";

/** Requested: "Prøv at fetche event detaljer automatisk så vi ikke sender folk til en anden hjemmeside." /events/<id>: an event
 * from the membership system's calendar on hjerterum.info (worker/event-detail.ts). Signing up happens in Hjerterum's own system. */
type EventDetail = {
  id: string; title: string; startsAt: string; endsAt: string | null; host: string | null; category: string | null;
  imageUrl: string | null; address: string | null; paragraphs: string[]; tickets: string[]; capacity: number | null; signUpUrl: string | null;
};

const TZ = "Europe/Copenhagen";
const DAY = new Intl.DateTimeFormat("da-DK", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const CLOCK = new Intl.DateTimeFormat("da-DK", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const clock = (iso: string) => CLOCK.format(new Date(iso)).replace(":", ".");
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The event's page address on hjerterum.info, for an event from MembershipWorks' feed (its id is "SF" + the event id). */
export const eventPagePath = (id: string): string | null => { const m = /^SF([0-9a-f]{24})$/.exec(id); return m ? `/events/${m[1]}` : null; };

/** One line of the description: "---" a divider, a short line ending in ":" a small heading, web addresses as links. */
function Line({ text }: { text: string }) {
  if (/^[-–—_*\s]{3,}$/.test(text)) return <hr className="event-rule" />;
  if (text.length <= 48 && /:$/.test(text)) return <h3 className="event-subhead">{text.slice(0, -1)}</h3>;
  const parts = text.split(/(https?:\/\/[^\s<>"]+)/g);
  return <p className={text.startsWith("• ") ? "event-bullet" : undefined}>
    {parts.map((part, i) => /^https?:\/\//.test(part) ? <a key={i} href={part} target="_blank" rel="noreferrer nofollow">{part.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a> : part)}
  </p>;
}

export function EventPage({ id, header, footer }: { id: string; header: ReactNode; footer: ReactNode }) {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  useEffect(() => {
    let active = true;
    fetch(`/api/events/external/${id}`).then(async (r) => {
      if (!active) return;
      if (!r.ok) { setState("missing"); return; }
      setEvent(await r.json() as EventDetail); setState("ready");
    }).catch(() => { if (active) setState("missing"); });
    return () => { active = false; };
  }, [id]);
  useEffect(() => {
    if (!event) return;
    document.title = `${event.title} · Hjerterum`;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (meta) meta.content = (event.paragraphs.join(" ").slice(0, 160)) || event.title;
  }, [event]);
  const past = event ? Date.parse(event.endsAt ?? event.startsAt) < Date.now() : false;
  return <main className="page-shell site-page event-page">
    {header}
    {state === "loading" ? <section className="lys-intro site-intro"><p className="lys-sub" role="status">Henter eventet …</p></section>
      : !event ? <section className="lys-intro site-intro"><div><p className="lys-kicker">Events</p><h1 className="lys-title">Eventet findes<em>ikke længere</em></h1></div>
          <div className="site-intro-side"><p><a className="lys-link" href="/events">← Se kalenderen</a></p></div></section>
      : <>
        <section className="lys-intro site-intro">
          <div>
            <a className="site-back" href="/events">← Kalenderen</a>
            {event.category && <p className="lys-kicker">{event.category}</p>}
            <h1 className="lys-title event-page-title">{event.title}</h1>
          </div>
          <div className="site-intro-side">
            <dl className="event-facts">
              <div><dt>Hvornår</dt><dd>{capital(DAY.format(new Date(event.startsAt)))}<br />kl. {clock(event.startsAt)}{event.endsAt ? `–${clock(event.endsAt)}` : ""}</dd></div>
              {event.host && <div><dt>Med</dt><dd>{event.host}</dd></div>}
              <div><dt>Hvor</dt><dd>Hjerterum{event.address ? `, ${event.address}` : ""}</dd></div>
              {event.capacity && <div><dt>Pladser</dt><dd>{event.capacity}</dd></div>}
            </dl>
            {/* Requested: "når vi starter med at bruge den nye side vil alt tilmeldinge ske i vores eget system". */}
            {!past && <p className="event-signup"><a className="lys-btn" href="/member-portal/kalender">Tilmeld dig</a></p>}
            {past && <p className="lys-sub">Eventet er afholdt.</p>}
          </div>
        </section>
        {event.imageUrl && <img className="event-page-image" src={event.imageUrl} alt="" />}
        <section className="site-body event-page-body">
          {event.paragraphs.map((line, i) => <Line key={i} text={line} />)}
          {event.tickets.length > 0 && <>
            <h2>Billetter</h2>
            <ul className="event-tickets">{event.tickets.map((t) => <li key={t}>{t}</li>)}</ul>
          </>}
        </section>
      </>}
    {footer}
  </main>;
}
