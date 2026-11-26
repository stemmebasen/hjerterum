import { useEffect, useMemo, useState } from "react";
import { EVENTS_PER_PAGE, RowDate, RowPhoto, RowText } from "./event-row";
import { matchesPast } from "./past-search";

/** Douglas (forslag #3, 26 Nov 2026): "Show past events in the website and Min side calendars" - "finding a teacher or event again to check on some
 * detail". Under both calendars: a switch that shows the events that have been held, newest first, greyed and without sign-up, each opening its
 * own page (which says "Eventet er afholdt"), with a search on the title or the teacher. From /api/events/past (worker/past-events.ts). */
export type PastEvent = { key: string; title: string; startsAt: string; endsAt: string | null; host: string | null; category: string | null; imageUrl: string | null; page: string | null };


export function PastEvents() {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<PastEvent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [count, setCount] = useState(EVENTS_PER_PAGE);
  useEffect(() => {
    if (!open || events) return;
    let active = true;
    fetch("/api/events/past").then(r => r.ok ? r.json() as Promise<PastEvent[]> : Promise.reject(new Error("past_unavailable")))
      .then(list => { if (active) setEvents(list); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [open, events]);
  const found = useMemo(() => (events ?? []).filter(e => matchesPast(e, query)), [events, query]);
  return <section className="past-events" id="tidligere-events">
    <button type="button" className="pill-button subtle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Skjul tidligere events" : "Vis tidligere events"}</button>
    {open && <>
      <h2>Tidligere events</h2>
      <input type="search" className="past-search" placeholder="Søg på titel eller underviser" aria-label="Søg i tidligere events" value={query}
        onChange={e => { setQuery(e.target.value); setCount(EVENTS_PER_PAGE); }} />
      {failed ? <p className="calendar-empty">De tidligere events kunne ikke hentes lige nu. Prøv igen om lidt.</p>
        : !events ? <p className="calendar-empty">Henter tidligere events …</p>
        : !found.length ? <p className="calendar-empty">{query ? "Ingen tidligere events passer på søgningen." : "Der er ingen tidligere events endnu."}</p>
        : <>
          <ol className="event-rows past-event-rows">{found.slice(0, count).map(event => <li className="event-row is-past" key={event.key}>
            {event.page ? <a href={event.page}><PastRow event={event} /><span className="event-row-more" aria-hidden="true">Se detaljer →</span></a>
              : <div className="event-row-body"><PastRow event={event} /></div>}
          </li>)}</ol>
          {found.length > count && <p className="past-more"><button type="button" className="pill-button subtle" onClick={() => setCount(count + EVENTS_PER_PAGE * 2)}>Vis flere tidligere events</button></p>}
        </>}
    </>}
  </section>;
}

function PastRow({ event }: { event: PastEvent }) {
  return <>
    <RowDate startsAt={event.startsAt} withYear />
    <RowPhoto src={event.imageUrl} />
    <RowText category={event.category} title={event.title} startsAt={event.startsAt} endsAt={event.endsAt} host={event.host} />
  </>;
}
