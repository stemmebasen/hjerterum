import { useState, type ReactNode } from "react";

export function calendarText(value: string): string {
  const decoder = document.createElement("textarea");
  decoder.innerHTML = value.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return decoder.value.replace(/\s+/g, " ").trim();
}

export function calendarMonth(value: string): string {
  return new Intl.DateTimeFormat("da-DK", { month: "long", year: "numeric", timeZone: "Europe/Copenhagen" }).format(new Date(value));
}

export function CalendarImage({ src, startsAt, partner = null }: { src: string | null; startsAt: string; partner?: string | null | undefined }) {
  const [failed, setFailed] = useState(false);
  const date = new Date(startsAt);
  const day = new Intl.DateTimeFormat("da-DK", {day:"numeric", timeZone:"Europe/Copenhagen"}).format(date);
  const month = new Intl.DateTimeFormat("da-DK", {month:"short", timeZone:"Europe/Copenhagen"}).format(date);
  return <div className={"member-event-visual" + (!src || failed ? " calendar-no-image" : "") + (partner ? " calendar-partner-visual" : "")}>
    {src && !failed ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <div className={"calendar-placeholder" + (partner ? " calendar-placeholder-partner" : "")} aria-hidden="true">{partner
      ? <><span>{partner}</span><strong>Fællesskab<br />på tværs.</strong></>
      : <><span>Hjerterum</span><strong>Rum til<br />at mødes.</strong></>}</div>}
    <div className="calendar-date" aria-hidden="true"><strong>{day}</strong><span>{month}</span></div>
  </div>;
}


export function EventCard({ title, description, startsAt, endsAt, host, location, imageUrl, category, attending = false, expandDescription = false, allDay = false, partner = null, children }: {
  title: string; description: string | null; startsAt: string; endsAt: string | null;
  host: string | null; location: string | null; imageUrl: string | null; category?: string | null | undefined;
  attending?: boolean | undefined; expandDescription?: boolean; allDay?: boolean | undefined; partner?: string | null | undefined; children: ReactNode;
}) {
  const text = calendarText(description ?? "");
  const short = text.length > 190 ? text.slice(0, 187).replace(/\s+\S*$/, "") + "…" : text;
  const date = new Intl.DateTimeFormat("da-DK", allDay ? {weekday:"long", day:"numeric", month:"long", timeZone:"Europe/Copenhagen"} : {weekday:"long", day:"numeric", month:"long", hour:"2-digit", minute:"2-digit", timeZone:"Europe/Copenhagen"}).format(new Date(startsAt));
  const end = endsAt && !allDay ? new Intl.DateTimeFormat("da-DK", {hour:"2-digit", minute:"2-digit", timeZone:"Europe/Copenhagen"}).format(new Date(endsAt)) : null;
  return <article className={"member-event-card" + (partner ? " partner-event-card" : "")}>
    <CalendarImage src={imageUrl} startsAt={startsAt} partner={partner} />
    <div className="member-event-content">
      <div className="member-event-eyebrow">{partner && <span className="calendar-partner">Partner-event</span>}<span>{calendarText(category || "I fællesskab")}</span>{attending && <span className="calendar-attending">Du er tilmeldt</span>}</div>
      <h3>{calendarText(title)}</h3>
      <time dateTime={startsAt}>{date}{end ? " – " + end : ""}</time>
      <p className="member-event-host">{calendarText([host, location || (partner ? null : "Hjerterum")].filter(Boolean).join(" · "))}</p>
      {short && <p className="member-event-summary">{short}</p>}
      {expandDescription && text.length > 190 && <details className="calendar-description"><summary>Læs hele præsentationen</summary><p>{text}</p></details>}
      <div className="member-event-footer">{children}</div>
    </div>
  </article>;
}

/** Partnerplanen, fase 1: a partner's event in Hjerterum's calendar. Signup and payment are at the partner. */
export type PartnerEvent = {
  id: number; partnerName: string; title: string; description: string | null; startsAt: string; endsAt: string | null; allDay: boolean;
  location: string | null; imageUrl: string | null; category: string | null; price: string | null; memberPrice: string | null; discount: string;
  link: string | null; redemption?: string;
};

export function PartnerBenefit({ event, member }: { event: PartnerEvent; member: boolean }) {
  return <>
    <p className="member-event-price partner-price">
      {event.price && event.memberPrice ? <>{member ? "Din medlemspris" : "Hjerterum-medlemmer"}: {event.memberPrice}<small>Normalpris {event.price} · {event.discount}</small></>
        : event.price === "Gratis" ? <>Gratis<small>Arrangeret af {event.partnerName}</small></>
        : <>{event.discount}<small>Prisen står hos {event.partnerName}</small></>}
    </p>
    {member && event.redemption && <p className="partner-redemption"><strong>Sådan får du rabatten</strong>{event.redemption}</p>}
    {event.link ? <a className="text-link" href={event.link} target="_blank" rel="noreferrer">{member ? "Tilmeld hos " : "Læs mere og tilmeld hos "}{event.partnerName} ↗</a>
      : <p>Kontakt {event.partnerName} for tilmelding.</p>}
    {!member && event.price !== "Gratis" && <a className="text-link partner-join" href="/bliv-medlem">Bliv medlem af Hjerterum og få rabatten →</a>}
  </>;
}
