import { useEffect, useState, type ReactNode } from "react";
import { journeyUrl, mapUrl } from "./event-way";

/** Requested: "Prøv at fetche event detaljer automatisk så vi ikke sender folk til en anden hjemmeside." /events/<id>: an event
 * from the membership system's calendar on hjerterum.info (worker/event-detail.ts). Signing up happens in Hjerterum's own system. */
type EventDetail = {
  id: string; title: string; startsAt: string; endsAt: string | null; host: string | null; category: string | null;
  imageUrl: string | null; address: string | null; lat: number; lon: number; paragraphs: string[]; tickets: string[]; capacity: number | null; signUpUrl: string | null;
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

/** Requested: "Vis også de samme sociale links samt et kort og en rejseplan-integration". */
const FACEBOOK = "https://www.facebook.com/holistiskcenter";
function Share({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? "" : window.location.href;
  const share = async () => {
    try { if (navigator.share) { await navigator.share({ title, url }); return; } } catch { return; }
    try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* nothing to do */ }
  };
  return <div className="event-share" aria-label="Del og følg">
    <span className="lys-kicker">Del eventet</span>
    <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer">Facebook</a>
    <a href={`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}`}>Mail</a>
    <button type="button" onClick={() => void share()}>{copied ? "Linket er kopieret" : "Kopiér link"}</button>
    <a href={FACEBOOK} target="_blank" rel="noreferrer">Følg Hjerterum på Facebook</a>
  </div>;
}

function FindWay({ event }: { event: EventDetail }) {
  const address = !event.address || /guldsmedgade\s*26/i.test(event.address) ? "Guldsmedgade 26B, 8000 Aarhus C" : event.address;
  const map = mapUrl(event.lat, event.lon);
  return <section className="event-way" aria-label="Find vej">
    <div className="event-way-text">
      <h2>Find vej</h2>
      <p>Hjerterum, {address}. Ring på dørtelefonen ved gitterlågen i Guldsmedgade, så lukker værten dig ind.</p>
      <p className="event-way-links">
        <a className="lys-btn" href={journeyUrl(address, event.startsAt)} target="_blank" rel="noreferrer">Find rejse med Rejseplanen</a>
        <a className="lys-btn ghost" href={map.open} target="_blank" rel="noreferrer">Åbn kortet</a>
      </p>
      <small>Rejseplanen åbner med Hjerterum som mål og ankomst et kvarter før start - skriv bare, hvor du rejser fra.</small>
    </div>
    {/* Requested: "Kan du finde et kort layout der passer til den øvrige design stil" - the map toned to the house's colours, still, with
        Hjerterum's own pin; a tap opens the full map. */}
    <a className="event-map-card" href={map.open} target="_blank" rel="noreferrer" aria-label="Åbn kortet over Hjerterum, Guldsmedgade 26B">
      <iframe title="Kort over Hjerterum" src={map.embed} loading="lazy" referrerPolicy="no-referrer" tabIndex={-1} aria-hidden="true" />
      <span className="event-map-pin" aria-hidden="true"><span /></span>
      <span className="event-map-label">Hjerterum · Guldsmedgade 26B</span>
    </a>
  </section>;
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
          <Share title={event.title} />
        </section>
        <FindWay event={event} />
      </>}
    {footer}
  </main>;
}
