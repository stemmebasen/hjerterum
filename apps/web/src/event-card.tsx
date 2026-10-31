import { useState, type ReactNode } from "react";
import { EventPhoto } from "./event-photo";

export function calendarText(value: string): string {
  const decoder = document.createElement("textarea");
  decoder.innerHTML = value.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return decoder.value.replace(/\s+/g, " ").trim();
}

export function calendarMonth(value: string): string {
  return new Intl.DateTimeFormat("da-DK", { month: "long", year: "numeric", timeZone: "Europe/Copenhagen" }).format(new Date(value));
}

export function CalendarImage({ src, startsAt }: { src: string | null; startsAt: string }) {
  const [failed, setFailed] = useState(false);
  const date = new Date(startsAt);
  const day = new Intl.DateTimeFormat("da-DK", {day:"numeric", timeZone:"Europe/Copenhagen"}).format(date);
  const month = new Intl.DateTimeFormat("da-DK", {month:"short", timeZone:"Europe/Copenhagen"}).format(date);
  return <div className={"member-event-visual" + (!src || failed ? " calendar-no-image" : "")}>
    {src && !failed ? <EventPhoto src={src} onError={() => setFailed(true)} /> : <div className="calendar-placeholder" aria-hidden="true"><span>Hjerterum</span><strong>Rum til<br />at mødes.</strong></div>}
    <div className="calendar-date" aria-hidden="true"><strong>{day}</strong><span>{month}</span></div>
  </div>;
}


export function EventCard({ title, description, startsAt, endsAt, host, location, imageUrl, category, attending = false, expandDescription = false, children }: {
  title: string; description: string | null; startsAt: string; endsAt: string | null;
  host: string | null; location: string | null; imageUrl: string | null; category?: string | null | undefined;
  attending?: boolean | undefined; expandDescription?: boolean; children: ReactNode;
}) {
  const text = calendarText(description ?? "");
  const short = text.length > 190 ? text.slice(0, 187).replace(/\s+\S*$/, "") + "…" : text;
  const date = new Intl.DateTimeFormat("da-DK", {weekday:"long", day:"numeric", month:"long", hour:"2-digit", minute:"2-digit", timeZone:"Europe/Copenhagen"}).format(new Date(startsAt));
  const end = endsAt ? new Intl.DateTimeFormat("da-DK", {hour:"2-digit", minute:"2-digit", timeZone:"Europe/Copenhagen"}).format(new Date(endsAt)) : null;
  return <article className="member-event-card">
    <CalendarImage src={imageUrl} startsAt={startsAt} />
    <div className="member-event-content">
      <div className="member-event-eyebrow"><span>{calendarText(category || "I fællesskab")}</span>{attending && <span className="calendar-attending">Du er tilmeldt</span>}</div>
      <h3>{calendarText(title)}</h3>
      <time dateTime={startsAt}>{date}{end ? " – " + end : ""}</time>
      <p className="member-event-host">{calendarText([host, location || "Hjerterum"].filter(Boolean).join(" · "))}</p>
      {short && <p className="member-event-summary">{short}</p>}
      {expandDescription && text.length > 190 && <details className="calendar-description"><summary>Læs hele præsentationen</summary><p>{text}</p></details>}
      <div className="member-event-footer">{children}</div>
    </div>
  </article>;
}
