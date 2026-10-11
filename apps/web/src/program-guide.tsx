import { useEffect, useState } from "react";

/** Requested: "I morgen i Hjerterum" - Saga's words about tomorrow (worker/program.ts) under that heading.
 * Earlier: "når jeg siger tv-program mener jeg ikke en programoversigt, men en continuity speaker der fortæller hvad der er på vej" +
 * "fem eventfotos". Saga's words about the next two events, beside the five photos. */
type Item = { key: string; title: string; startsAt: string; endsAt: string | null; host: string | null; imageUrl: string | null; link: string | null };

const TZ = "Europe/Copenhagen";
const day = (iso: string) => new Intl.DateTimeFormat("da-DK", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
const shortDay = (iso: string) => new Intl.DateTimeFormat("da-DK", { timeZone: TZ, weekday: "short" }).format(new Date(iso)).replace(".", "");
const time = (iso: string) => new Intl.DateTimeFormat("da-DK", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(":", ".");
const firstName = (host: string | null) => (host ?? "").replace(/^(med|ved)\s+/i, "").split(/\s*(?:,| og |&)\s*/)[0]?.split(/\s+/)[0] ?? "";

export function ProgramGuide() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [intro, setIntro] = useState<string | null>(null);
  const [heading, setHeading] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/events/program").then(async (r) => {
      const body = r.ok ? await r.json() as { intro: string | null; heading?: string | null; items: Item[] } : { intro: null, items: [] };
      if (active) { setItems(body.items); setIntro(body.intro); setHeading(body.heading ?? null); }
    }).catch(() => { if (active) setItems([]); });
    return () => { active = false; };
  }, []);
  if (!items) return null;
  if (!items.length) return <article className="lys-card program-guide"><p className="lys-kicker">I morgen i Hjerterum</p><p className="lys-sub">Der er stille i kalenderen lige nu - kig forbi snart.</p></article>;
  const nowMs = Date.now();
  const next = items.find((i) => Date.parse(i.endsAt ?? i.startsAt) > nowMs) ?? items[0]!;
  // Until Saga has written today's words: a plain line about the next event.
  const words = intro ?? `Næste gang i huset: ${next.title}${firstName(next.host) ? ` med ${firstName(next.host)}` : ""}, ${day(next.startsAt)} kl. ${time(next.startsAt)}.`;
  const open = (i: Item) => i.link ?? "/member-portal/kalender";
  return (
    <article className="lys-card program-guide">
      <div className="program-head">
        <p className="lys-kicker">{heading ?? "I morgen i Hjerterum"}</p>
        <a className="lys-link" href="/member-portal/kalender">Hele kalenderen →</a>
      </div>
      <p className="program-intro">{words}</p>
      <div className="program-strip">
        {items.map((i) => (
          <a key={i.key} href={open(i)} target={i.link?.startsWith("http") ? "_blank" : undefined} rel="noopener" className="program-tile">
            <span className="program-photo">{i.imageUrl ? <img src={i.imageUrl} alt="" loading="lazy" /> : <span className="program-photo-empty" aria-hidden="true">◎</span>}
              {i.key === next.key && <span className="program-next">Næste</span>}</span>
            <span className="program-when">{shortDay(i.startsAt)} {time(i.startsAt)}</span>
            <strong className="program-title">{i.title}</strong>
          </a>
        ))}
      </div>
    </article>
  );
}

/** Requested: "samt på hjemmesiden" - the same words, quietly, above the website's calendar. */
export function SpeakerLine({ withHeading = true }: { withHeading?: boolean }) {
  const [said, setSaid] = useState<{ intro: string | null; heading?: string | null } | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/events/program").then(async (r) => { if (active && r.ok) setSaid(await r.json() as { intro: string | null; heading?: string | null }); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  return said?.intro ? <p className="speaker-line">{withHeading && said.heading && <strong>{said.heading}. </strong>}{said.intro}</p> : null;
}
