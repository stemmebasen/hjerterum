import { useEffect, useState, type ReactNode } from "react";
import { teacherFor, type SiteProfile } from "./public-profiles";
import { journeyUrl, mapUrl } from "./event-way";
import { EventPhoto } from "./event-photo";

/** Requested: "Prøv at fetche event detaljer automatisk så vi ikke sender folk til en anden hjemmeside." /events/<id>: an event
 * from the membership system's calendar on hjerterum.info (worker/event-detail.ts). Signing up happens in Hjerterum's own system. */
type EventDetail = {
  id: string; title: string; startsAt: string; endsAt: string | null; host: string | null; category: string | null;
  imageUrl: string | null; address: string | null; lat: number; lon: number; paragraphs: string[]; tickets: string[]; capacity: number | null; signUpUrl: string | null;
  /** An event in the house's own system (/events/h<id>): guests sign up here (worker/guest-signup.ts). */
  own?: { id: number; seatsLeft: number | null; nonMemberPriceKr: number; memberPriceKr: number };
};

type OwnEvent = { id: number; title: string; description: string | null; teacherName: string; startsAt: string; endsAt: string; imageUrl: string | null;
  maxAttendees: number | null; seatsLeft: number | null; memberPriceKr: number; nonMemberPriceKr: number };
const HOUSE = { address: "Guldsmedgade 26B, 8000 Aarhus C", lat: 56.1593182, lon: 10.2078481 };
const kr = (n: number) => `${n.toLocaleString("da-DK")} kr.`;

function ownDetail(e: OwnEvent): EventDetail {
  return { id: `h${e.id}`, title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, host: e.teacherName, category: null, imageUrl: e.imageUrl, ...HOUSE,
    paragraphs: (e.description ?? "").split(/\n+/).map(line => line.trim()).filter(Boolean),
    tickets: e.memberPriceKr || e.nonMemberPriceKr ? [`Medlemmer: ${e.memberPriceKr ? kr(e.memberPriceKr) : "gratis"}`, `Ikke-medlemmer: ${e.nonMemberPriceKr ? kr(e.nonMemberPriceKr) : "gratis"}`] : ["Gratis"],
    capacity: e.maxAttendees, signUpUrl: null, own: { id: e.id, seatsLeft: e.seatsLeft, nonMemberPriceKr: e.nonMemberPriceKr, memberPriceKr: e.memberPriceKr } };
}

const GUEST_ERRORS: Record<string, string> = {
  missing_fields: "Skriv dit navn og en gyldig e-mail.", already_attending: "Du er allerede tilmeldt med den e-mail.", booking_full: "Eventet er desværre fuldt booket.",
  booking_full_or_pending: "Eventet er desværre fuldt booket.", booking_started: "Eventet er begyndt.", too_many: "Der er sendt mange tilmeldinger fra den e-mail. Prøv igen om en time.",
  non_member_payment_unavailable: "Tilmelding med betaling for ikke-medlemmer åbner snart. Er du medlem, kan du logge ind og tilmelde dig."
};

/** Douglas' notes: "Do they have to be a member to book an event?" - "Som gæst uden login". On an event of the house's own: name and e-mail, and
 * you are signed up (members can still log in for their price). On an event from the old calendar: its own sign-up, until the move. */
function SignUp({ event }: { event: EventDetail }) {
  const [open, setOpen] = useState(false);
  const [opened] = useState(() => Date.now());
  const [state, setState] = useState<{ busy?: boolean; done?: boolean; error?: string }>({});
  const own = event.own;
  if (!own) {
    const external = Boolean(event.signUpUrl);
    return <p className="event-signup"><a className="lys-btn" href={event.signUpUrl ?? "/member-portal/kalender"} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>Tilmeld dig{external ? " ↗" : ""}</a></p>;
  }
  const memberLink = <a className="lys-link" href="/member-portal/kalender">Medlem? Log ind og tilmeld →</a>;
  if (own.seatsLeft === 0) return <div className="event-signup"><p className="lys-sub">Eventet er fuldt booket.</p></div>;
  if (own.nonMemberPriceKr > 0) return <div className="event-signup"><small>{GUEST_ERRORS.non_member_payment_unavailable}</small>{memberLink}</div>;
  if (state.done) return <div className="event-signup" role="status"><b>Tak – du er tilmeldt.</b><small>Vi har sendt en bekræftelse til din e-mail.</small></div>;
  if (!open) return <div className="event-signup"><button type="button" className="lys-btn" onClick={() => setOpen(true)}>Tilmeld dig</button>
    <small>Du behøver ikke være medlem.{own.seatsLeft !== null ? ` ${own.seatsLeft} ${own.seatsLeft === 1 ? "plads" : "pladser"} tilbage.` : ""}</small>{memberLink}</div>;
  const submit = async (form: HTMLFormElement) => {
    const data = new FormData(form);
    setState({ busy: true });
    const response = await fetch(`/api/room-bookings/${own.id}/guest`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: data.get("name"), email: data.get("email"), newsletter: data.get("newsletter") === "on", website: data.get("website"), started: opened }) }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) as { ok?: boolean; error?: string } : {};
    setState(response?.ok && body.ok ? { done: true } : { error: GUEST_ERRORS[body.error ?? ""] ?? "Tilmeldingen gik ikke igennem. Prøv igen om lidt." });
  };
  return <form className="event-signup event-guest" onSubmit={e => { e.preventDefault(); void submit(e.currentTarget); }}>
    <label>Navn<input name="name" required maxLength={120} autoComplete="name" /></label>
    <label>E-mail<input type="email" name="email" required maxLength={200} autoComplete="email" /></label>
    <label className="event-guest-check"><input type="checkbox" name="newsletter" /> Ja tak til nyhedsbrevet Månedens events (én mail om måneden)</label>
    <div aria-hidden="true" className="site-honeypot"><input type="text" name="website" tabIndex={-1} defaultValue="" /></div>
    {state.error && <p className="event-guest-error" role="alert">{state.error}</p>}
    <p className="event-guest-actions"><button className="lys-btn" disabled={state.busy}>{state.busy ? "Tilmelder …" : "Tilmeld mig"}</button>
      <button type="button" className="lys-btn ghost" onClick={() => setOpen(false)}>Annullér</button></p>
    {memberLink}
  </form>;
}

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
// Said by the chair: "Hjerterums facebook-side hedder https://www.facebook.com/hjerterumaarhus".
const FACEBOOK = "https://www.facebook.com/hjerterumaarhus";
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
    {/* Reported: "Man kan i øvrigt lave et opslag til instagram med forskellige layouts. Det er en fejl - disse layout muligheder er jo ikke til den
        almindelige bruger". The posters (/plakat/<id>) are for the organiser, from their own event in the member area - not on the public page. */}
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
    const own = /^h(\d+)$/.exec(id);
    fetch(own ? `/api/room-bookings/public/${own[1]}` : `/api/events/external/${id}`).then(async (r) => {
      if (!active) return;
      if (!r.ok) { setState("missing"); return; }
      setEvent(own ? ownDetail(await r.json() as OwnEvent) : await r.json() as EventDetail); setState("ready");
    }).catch(() => { if (active) setState("missing"); });
    return () => { active = false; };
  }, [id]);
  useEffect(() => {
    if (!event) return;
    document.title = `${event.title} · Hjerterum`;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (meta) meta.content = (event.paragraphs.join(" ").slice(0, 160)) || event.title;
  }, [event]);
  // The host's own page, when they have a published visit card.
  const [profiles, setProfiles] = useState<SiteProfile[]>([]);
  useEffect(() => {
    if (!event?.host) return;
    let active = true;
    fetch("/api/public-profiles").then(async r => { if (r.ok && active) setProfiles(await r.json() as SiteProfile[]); }).catch(() => undefined);
    return () => { active = false; };
  }, [event?.host]);
  const teacher = event?.host ? teacherFor(event.host, profiles) : null;
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
              {event.host && <div><dt>Med</dt><dd>{teacher ? <a href={teacher.href}>{event.host}</a> : event.host}</dd></div>}
              <div><dt>Hvor</dt><dd>Hjerterum{event.address ? `, ${event.address}` : ""}</dd></div>
              {event.capacity && <div><dt>Pladser</dt><dd>{event.capacity}</dd></div>}
            </dl>
            {/* Requested: "når vi starter med at bruge den nye side vil alt tilmeldinge ske i vores eget system". */}
            {!past && <SignUp event={event} />}
            {past && <p className="lys-sub">Eventet er afholdt.</p>}
          </div>
        </section>
        {event.imageUrl && <EventPhoto className="event-page-image" src={event.imageUrl} />}
        <section className="site-body event-page-body">
          {event.paragraphs.map((line, i) => <Line key={i} text={line} />)}
          {event.tickets.length > 0 && <>
            <h2>Billetter</h2>
            <ul className="event-tickets">{event.tickets.map((t) => <li key={t}>{t}</li>)}</ul>
          </>}
          {/* Douglas' notes: "'Tilmeld dig' maybe at the bottom as well". */}
          {!past && <div className="event-signup-end"><SignUp event={event} /></div>}
          {/* Requested: "Under hvert Hjerterum event skal der diskret stå: Inviter din CIRKEL med" (cirkel-invite.tsx, in the member area). */}
          {!past && <p className="event-cirkel"><a href={`/member-portal/cirkel?event=${encodeURIComponent(event.id)}`}><span className="event-cirkel-mark" aria-hidden="true" />Inviter din CIRKEL med</a>
            <small>Del eventet i din cirkels chat i CIRKLER</small></p>}
          <Share title={event.title} />
        </section>
        <FindWay event={event} />
      </>}
    {footer}
  </main>;
}
